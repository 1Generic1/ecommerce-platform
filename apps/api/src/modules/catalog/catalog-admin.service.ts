import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/types/auth-user';
import {
  CreateCategoryDto,
  UpdateCategoryDto,
} from './dto/create-category.dto';
import { CreateProductDto, CreateVariantDto } from './dto/create-product.dto';
import { UpdateProductDto, UpdateVariantDto } from './dto/update-product.dto';
import { UpdateStockDto } from './dto/update-stock.dto';

type Tx = Prisma.TransactionClient;

@Injectable()
export class CatalogAdminService {
  private readonly logger = new Logger(CatalogAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------- products ----------

  async createProduct(dto: CreateProductDto) {
    await this.assertCategoryExists(dto.categoryId);
    await this.assertSlugFree(dto.slug);
    this.assertUniqueSkus(dto.variants);
    dto.variants.forEach((v) =>
      this.assertComparePrice(v.priceMinor, v.compareAtMinor),
    );

    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          description: dto.description,
          brand: dto.brand,
          categoryId: dto.categoryId,
          attributes: dto.attributes as Prisma.InputJsonValue,
          isActive: dto.isActive ?? false,
        },
      });

      for (const v of dto.variants) {
        const variant = await tx.productVariant.create({
          data: {
            productId: product.id,
            sku: v.sku,
            name: v.name,
            priceMinor: v.priceMinor,
            compareAtMinor: v.compareAtMinor,
            options: v.options as Prisma.InputJsonValue,
            weightGrams: v.weightGrams,
          },
        });

        const quantity = v.quantity ?? 0;
        await tx.inventory.create({
          data: {
            variantId: variant.id,
            quantity,
            reserved: 0,
            // available is constrained to quantity - reserved.
            available: quantity,
          },
        });
      }

      await this.recomputeMinPrice(tx, product.id);

      return tx.product.findUniqueOrThrow({
        where: { id: product.id },
        include: { variants: { include: { inventory: true } } },
      });
    });
  }

  async updateProduct(id: string, dto: UpdateProductDto) {
    await this.assertProductExists(id);

    if (dto.categoryId) {
      await this.assertCategoryExists(dto.categoryId);
    }
    if (dto.slug) {
      await this.assertSlugFree(dto.slug, id);
    }

    return this.prisma.product.update({
      where: { id },
      data: {
        ...dto,
        attributes: dto.attributes as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async setProductActive(id: string, isActive: boolean, actor?: AuthUser) {
    await this.assertProductExists(id);

    if (isActive) {
      const activeVariants = await this.prisma.productVariant.count({
        where: { productId: id, isActive: true },
      });
      if (activeVariants === 0) {
        throw new BadRequestException(
          'Cannot publish a product with no active variants',
        );
      }
    }

    const product = await this.prisma.product.update({
      where: { id },
      data: { isActive },
    });

    await this.audit.record({
      actorId: actor?.id,
      actorEmail: actor?.email,
      actorRole: actor?.role,
      action: isActive ? 'product.publish' : 'product.unpublish',
      entityType: 'Product',
      entityId: id,
    });

    return product;
  }

  // ---------- variants ----------

  async addVariant(productId: string, dto: CreateVariantDto) {
    await this.assertProductExists(productId);
    await this.assertSkuFree(dto.sku);
    this.assertComparePrice(dto.priceMinor, dto.compareAtMinor);

    return this.prisma.$transaction(async (tx) => {
      const variant = await tx.productVariant.create({
        data: {
          productId,
          sku: dto.sku,
          name: dto.name,
          priceMinor: dto.priceMinor,
          compareAtMinor: dto.compareAtMinor,
          options: dto.options as Prisma.InputJsonValue,
          weightGrams: dto.weightGrams,
        },
      });

      const quantity = dto.quantity ?? 0;
      await tx.inventory.create({
        data: {
          variantId: variant.id,
          quantity,
          reserved: 0,
          available: quantity,
        },
      });

      await this.recomputeMinPrice(tx, productId);

      return tx.productVariant.findUniqueOrThrow({
        where: { id: variant.id },
        include: { inventory: true },
      });
    });
  }

  async updateVariant(id: string, dto: UpdateVariantDto, actor?: AuthUser) {
    const existing = await this.prisma.productVariant.findUnique({
      where: { id },
      select: {
        id: true,
        productId: true,
        priceMinor: true,
        compareAtMinor: true,
      },
    });
    if (!existing) {
      throw new NotFoundException('Variant not found');
    }
    if (dto.sku) {
      await this.assertSkuFree(dto.sku, id);
    }

    // Either field may be changing; validate the resulting pair, not the
    // input. undefined means "unchanged" here, null means "clear it" —
    // see the contract note in update-product.dto.ts.
    this.assertComparePrice(
      dto.priceMinor ?? existing.priceMinor,
      dto.compareAtMinor !== undefined
        ? dto.compareAtMinor
        : existing.compareAtMinor,
    );

    const variant = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.productVariant.update({
        where: { id },
        data: {
          ...dto,
          options: dto.options as Prisma.InputJsonValue | undefined,
        },
      });

      // Price or active flag may have changed, either of which moves the
      // product's minimum price.
      await this.recomputeMinPrice(tx, existing.productId);

      return updated;
    });

    // Price changes are financially meaningful; other field edits are not
    // worth an audit row.
    const priceChanged =
      (dto.priceMinor !== undefined &&
        dto.priceMinor !== existing.priceMinor) ||
      (dto.compareAtMinor !== undefined &&
        dto.compareAtMinor !== existing.compareAtMinor);

    if (priceChanged) {
      await this.audit.record({
        actorId: actor?.id,
        actorEmail: actor?.email,
        actorRole: actor?.role,
        action: 'variant.price_change',
        entityType: 'ProductVariant',
        entityId: id,
        before: {
          priceMinor: existing.priceMinor,
          compareAtMinor: existing.compareAtMinor,
        },
        after: {
          priceMinor: variant.priceMinor,
          compareAtMinor: variant.compareAtMinor,
        },
      });
    }

    return variant;
  }

  async setVariantActive(id: string, isActive: boolean, actor?: AuthUser) {
    const existing = await this.prisma.productVariant.findUnique({
      where: { id },
      select: { productId: true, isActive: true },
    });
    if (!existing) {
      throw new NotFoundException('Variant not found');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const variant = await tx.productVariant.update({
        where: { id },
        data: { isActive },
      });

      // recomputeMinPrice unpublishes the product if this was the last
      // active variant. TODO: surface productUnpublished in the response
      // so the dashboard can tell the admin why the product went offline.
      const { unpublished } = await this.recomputeMinPrice(
        tx,
        existing.productId,
      );

      return { variant, unpublished };
    });

    await this.audit.record({
      actorId: actor?.id,
      actorEmail: actor?.email,
      actorRole: actor?.role,
      action: isActive ? 'variant.activate' : 'variant.deactivate',
      entityType: 'ProductVariant',
      entityId: id,
      before: { isActive: existing.isActive },
      after: {
        isActive: result.variant.isActive,
        productUnpublished: result.unpublished,
      },
    });

    return result.variant;
  }

  // ---------- stock ----------

  // NOTE: inventory has a DB check constraint available = quantity - reserved.
  // Any write that changes quantity or reserved MUST set available in the same
  // statement, or Postgres rejects it. Prefer reserve()/release() helpers over
  // writing inventory directly once those exist.
  //
  // Also: this method reads reserved, then writes available from the value it
  // read. Safe today because nothing writes reserved yet. Once cart/orders
  // mutate reserved, this becomes a race — fix it then by computing available
  // in one SQL statement (SET quantity = $1, available = $1 - reserved) or by
  // running the read and write inside a single transaction.
  // See docs/inventory-invariants.md
  async updateStock(variantId: string, dto: UpdateStockDto, actor?: AuthUser) {
    // Defence in depth: the DTO validates this, but the service should not
    // trust its caller if the DTO is ever bypassed by a bulk endpoint.
    if (!Number.isInteger(dto.quantity) || dto.quantity < 0) {
      throw new BadRequestException('quantity must be a non-negative integer');
    }

    const inventory = await this.prisma.inventory.findUnique({
      where: { variantId },
      select: { reserved: true, quantity: true, lowStockAt: true },
    });
    if (!inventory) {
      throw new NotFoundException('Variant not found');
    }

    if (dto.quantity < inventory.reserved) {
      throw new BadRequestException(
        `Cannot set quantity below reserved units (${inventory.reserved})`,
      );
    }

    const updated = await this.prisma.inventory.update({
      where: { variantId },
      data: {
        quantity: dto.quantity,
        available: dto.quantity - inventory.reserved,
        ...(dto.lowStockAt !== undefined ? { lowStockAt: dto.lowStockAt } : {}),
      },
    });

    await this.audit.record({
      actorId: actor?.id,
      actorEmail: actor?.email,
      actorRole: actor?.role,
      action: 'stock.update',
      entityType: 'ProductVariant',
      entityId: variantId,
      before: {
        quantity: inventory.quantity,
        lowStockAt: inventory.lowStockAt,
      },
      after: { quantity: updated.quantity, lowStockAt: updated.lowStockAt },
    });

    return updated;
  }

  // ---------- categories ----------

  async createCategory(dto: CreateCategoryDto, actor?: AuthUser) {
    if (dto.parentId) {
      await this.assertCategoryExists(dto.parentId);
    }
    await this.assertCategorySlugFree(dto.slug);

    const category = await this.prisma.category.create({ data: dto });

    await this.audit.record({
      actorId: actor?.id,
      actorEmail: actor?.email,
      actorRole: actor?.role,
      action: 'category.create',
      entityType: 'Category',
      entityId: category.id,
      after: {
        name: category.name,
        slug: category.slug,
        parentId: category.parentId,
      },
    });

    return category;
  }

  async updateCategory(id: string, dto: UpdateCategoryDto, actor?: AuthUser) {
    const existing = await this.prisma.category.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        parentId: true,
        isActive: true,
      },
    });
    if (!existing) {
      throw new NotFoundException('Category not found');
    }

    if (dto.slug) {
      await this.assertCategorySlugFree(dto.slug, id);
    }

    // undefined means "leave the parent alone"; null means "move to top
    // level", which needs no checks. Only a real id is validated.
    if (dto.parentId !== undefined && dto.parentId !== null) {
      if (dto.parentId === id) {
        throw new BadRequestException('A category cannot be its own parent');
      }
      await this.assertCategoryExists(dto.parentId);
      await this.assertNoCycle(id, dto.parentId);
    }

    if (dto.isActive === false) {
      await this.assertNoActiveChildren(id);
    }

    const category = await this.prisma.category.update({
      where: { id },
      data: dto,
    });

    await this.audit.record({
      actorId: actor?.id,
      actorEmail: actor?.email,
      actorRole: actor?.role,
      action: 'category.update',
      entityType: 'Category',
      entityId: id,
      before: {
        name: existing.name,
        slug: existing.slug,
        parentId: existing.parentId,
        isActive: existing.isActive,
      },
      after: {
        name: category.name,
        slug: category.slug,
        parentId: category.parentId,
        isActive: category.isActive,
      },
    });

    return category;
  }

  // ---------- min price maintenance ----------

  // Always recomputes from source; never adjusts incrementally. Callers must
  // pass the variant's CURRENT productId.
  //
  // This method also owns the invariant "an active product has at least one
  // active variant". Putting the unpublish here rather than in one caller
  // means no future code path can leave a published product with nothing to
  // buy. Returns whether it unpublished, so callers can tell the admin.
  private async recomputeMinPrice(
    tx: Tx,
    productId: string,
  ): Promise<{ unpublished: boolean }> {
    const result = await tx.productVariant.aggregate({
      where: { productId, isActive: true },
      _min: { priceMinor: true },
    });

    const minPriceMinor = result._min.priceMinor ?? null;

    const product = await tx.product.update({
      where: { id: productId },
      data: { minPriceMinor },
      select: { isActive: true },
    });

    if (minPriceMinor === null && product.isActive) {
      await tx.product.update({
        where: { id: productId },
        data: { isActive: false },
      });
      this.logger.log(
        `Unpublished product ${productId}: no active variants remain`,
      );
      return { unpublished: true };
    }

    return { unpublished: false };
  }

  // Self-healing pass, keyset-paginated by product id. Ordering by id and
  // advancing a cursor guarantees forward progress: an unordered LIMIT can
  // return the same rows every iteration while others stay drifted forever.
  //
  // WARNING: the SELECT and the UPDATE below each compute the expected
  // minimum independently, and they must stay in agreement. If one changes
  // (the isActive filter, the aggregate, the IS DISTINCT FROM comparison)
  // without the other, the SELECT keeps finding drift the UPDATE will not
  // repair: the loop walks the whole table, logs a warning per product, and
  // reports fixed: 0. A persistent drift count with fixed: 0 is the
  // signature of exactly that mismatch.
  //
  // Both statements must also match recomputeMinPrice()'s definition of the
  // minimum, or the reconciler and the write path will fight each other:
  // a fixed count that never settles toward zero means they have diverged.
  async reconcileMinPrices(): Promise<{ fixed: number }> {
    const BATCH = 500;
    let totalFixed = 0;
    let cursor = '';

    for (;;) {
      const drifted = await this.prisma.$queryRaw<
        Array<{ id: string; stored: number | null; expected: number | null }>
      >(Prisma.sql`
        SELECT p.id,
               p."minPriceMinor" AS stored,
               v.min_price       AS expected
        FROM products p
        LEFT JOIN (
          SELECT "productId", MIN("priceMinor") AS min_price
          FROM product_variants
          WHERE "isActive" = true
          GROUP BY "productId"
        ) v ON v."productId" = p.id
        WHERE p."minPriceMinor" IS DISTINCT FROM v.min_price
          AND p.id > ${cursor}
        ORDER BY p.id
        LIMIT ${BATCH}
      `);

      if (drifted.length === 0) {
        break;
      }

      for (const row of drifted) {
        this.logger.warn(
          `minPriceMinor drift on product ${row.id}: stored ${row.stored}, expected ${row.expected}`,
        );
      }

      const ids = drifted.map((d) => d.id);

      // Zero affected rows here is normal, not an error: a concurrent write
      // may have fixed these between the select and the update. The cursor
      // advances regardless, so the loop still terminates.
      const affected = await this.prisma.$executeRaw(Prisma.sql`
        UPDATE products p
        SET "minPriceMinor" = v.min_price
        FROM (
          SELECT pr.id,
                 (SELECT MIN("priceMinor") FROM product_variants
                  WHERE "productId" = pr.id AND "isActive" = true) AS min_price
          FROM products pr
          WHERE pr.id IN (${Prisma.join(ids)})
        ) v
        WHERE p.id = v.id
          AND p."minPriceMinor" IS DISTINCT FROM v.min_price
      `);

      totalFixed += affected;
      cursor = drifted[drifted.length - 1].id;

      if (drifted.length < BATCH) {
        break;
      }
    }

    return { fixed: totalFixed };
  }

  // ---------- guards ----------

  private assertComparePrice(
    priceMinor: number,
    compareAtMinor?: number | null,
  ) {
    if (compareAtMinor != null && compareAtMinor <= priceMinor) {
      throw new BadRequestException(
        'compareAtMinor is the pre-discount "was" price and must be greater ' +
          'than priceMinor. To clear a discount, set compareAtMinor to null.',
      );
    }
  }

  private async assertProductExists(id: string) {
    const found = await this.prisma.product.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) {
      throw new NotFoundException('Product not found');
    }
  }

  private async assertCategoryExists(id: string) {
    const found = await this.prisma.category.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) {
      throw new NotFoundException('Category not found');
    }
  }

  private async assertNoActiveChildren(categoryId: string) {
    const activeChildren = await this.prisma.category.count({
      where: { parentId: categoryId, isActive: true },
    });

    if (activeChildren > 0) {
      throw new BadRequestException(
        `Cannot deactivate: ${activeChildren} active subcategor${activeChildren === 1 ? 'y' : 'ies'} must be deactivated first`,
      );
    }
  }

  private async assertSlugFree(slug: string, exceptId?: string) {
    const found = await this.prisma.product.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (found && found.id !== exceptId) {
      throw new ConflictException('A product with this slug already exists');
    }
  }

  private async assertCategorySlugFree(slug: string, exceptId?: string) {
    const found = await this.prisma.category.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (found && found.id !== exceptId) {
      throw new ConflictException('A category with this slug already exists');
    }
  }

  // NOTE: SKU uniqueness is case-sensitive, matching the plain text column
  // and its unique index. If sku ever becomes citext, this check and
  // assertUniqueSkus must become case-insensitive too.
  private async assertSkuFree(sku: string, exceptId?: string) {
    const found = await this.prisma.productVariant.findUnique({
      where: { sku },
      select: { id: true },
    });
    if (found && found.id !== exceptId) {
      throw new ConflictException('A variant with this SKU already exists');
    }
  }

  private assertUniqueSkus(variants: CreateVariantDto[]) {
    const seen = new Set<string>();
    for (const v of variants) {
      if (seen.has(v.sku)) {
        throw new BadRequestException(`Duplicate SKU in request: ${v.sku}`);
      }
      seen.add(v.sku);
    }
  }

  private async assertNoCycle(categoryId: string, newParentId: string) {
    let cursor: string | null = newParentId;
    const seen = new Set<string>([categoryId]);

    while (cursor) {
      if (seen.has(cursor)) {
        throw new BadRequestException(
          'That parent would create a category cycle',
        );
      }
      seen.add(cursor);

      const parent: { parentId: string | null } | null =
        await this.prisma.category.findUnique({
          where: { id: cursor },
          select: { parentId: true },
        });
      cursor = parent?.parentId ?? null;
    }
  }
}
