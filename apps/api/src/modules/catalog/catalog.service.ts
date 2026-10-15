import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Cache } from 'cache-manager';
import { paginate } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CATEGORY_TREE_KEY,
  CATEGORY_TREE_TTL,
  PRODUCT_DETAIL_TTL,
  PRODUCT_LIST_TTL,
  categoryKey,
  productKey,
} from './catalog-cache.service';
import { ProductQueryDto, ProductSort } from './dto/product-query.dto';

type CategoryRow = {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  parentId: string | null;
  position: number;
};

type CategoryNode = CategoryRow & { children: CategoryNode[] };

@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  // Reads through the cache, falling back to the loader on a miss OR on any
  // cache error: Redis being down must mean slower responses, never failures.
  // Both catch blocks log the underlying error — without it, a cache problem
  // tells you only which key, not why.
  private async cached<T>(
    key: string,
    ttl: number,
    load: () => Promise<T>,
  ): Promise<T> {
    try {
      const hit = await this.cache.get<T>(key);
      if (hit !== undefined && hit !== null) {
        return hit;
      }
    } catch (error) {
      this.logger.warn(
        `Cache read failed for ${key}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const value = await load();

    try {
      await this.cache.set(key, value, ttl);
    } catch (error) {
      this.logger.warn(
        `Cache write failed for ${key}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return value;
  }

  async findProducts(query: ProductQueryDto) {
    // The key is the full normalised query. limit is capped at 100 by the
    // DTO, so the key space is bounded by what clients actually ask for.
    const key = `catalog:products:${this.queryKey(query)}`;

    return this.cached(key, PRODUCT_LIST_TTL, async () => {
      const where = this.buildProductWhere(query);

      const [data, total] = await this.prisma.$transaction([
        this.prisma.product.findMany({
          where,
          skip: query.skip,
          take: query.take,
          orderBy: this.buildOrderBy(query.sort),
          include: {
            category: { select: { id: true, name: true, slug: true } },
            images: {
              where: { variantId: null },
              orderBy: { position: 'asc' },
              take: 1,
            },
            variants: {
              where: { isActive: true },
              orderBy: { priceMinor: 'asc' },
              select: { id: true, priceMinor: true, compareAtMinor: true },
            },
          },
        }),
        this.prisma.product.count({ where }),
      ]);

      return paginate(data, total, query.page ?? 1, query.take);
    });
  }

  async findProductBySlug(slug: string) {
    // Cached with the stock count included. available can be up to
    // PRODUCT_DETAIL_TTL stale, which is a display concern only: adding to
    // cart checks stock live, and checkout reserves atomically.
    const product = await this.cached(
      productKey(slug),
      PRODUCT_DETAIL_TTL,
      async () => {
        const found = await this.prisma.product.findFirst({
          where: {
            slug,
            isActive: true,
            category: { isActive: true },
            variants: { some: { isActive: true } },
          },
          include: {
            category: { select: { id: true, name: true, slug: true } },
            images: { orderBy: { position: 'asc' } },
            variants: {
              where: { isActive: true },
              orderBy: { priceMinor: 'asc' },
              include: {
                inventory: { select: { available: true } },
                images: { orderBy: { position: 'asc' } },
              },
            },
          },
        });

        if (!found) {
          return null;
        }

        // Expose availability without leaking internal quantity/reserved
        // counts. available is 0 for a sold-out variant; the variant still
        // appears so the storefront can mark it out of stock.
        return {
          ...found,
          variants: found.variants.map(({ inventory, ...variant }) => ({
            ...variant,
            available: inventory?.available ?? 0,
          })),
        };
      },
    );

    // Misses are not cached (cached() treats null as a miss), so a product
    // becoming published appears immediately rather than after a TTL of 404s.
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return product;
  }

  async findCategories() {
    return this.cached(CATEGORY_TREE_KEY, CATEGORY_TREE_TTL, async () => {
      const categories = await this.prisma.category.findMany({
        where: { isActive: true },
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          slug: true,
          imageUrl: true,
          parentId: true,
          position: true,
        },
      });

      return this.buildCategoryTree(categories);
    });
  }

  async findCategoryBySlug(slug: string) {
    // Deliberately one level deep: this powers a category landing page,
    // which shows immediate subcategories as tiles and then products.
    // findCategories() returns the full tree for navigation.
    //
    // Shares the tree's TTL: the TTL tracks how often category data changes,
    // not the shape of the response.
    const category = await this.cached(
      categoryKey(slug),
      CATEGORY_TREE_TTL,
      async () =>
        this.prisma.category.findFirst({
          where: { slug, isActive: true },
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
            imageUrl: true,
            parentId: true,
            children: {
              where: { isActive: true },
              orderBy: [{ position: 'asc' }, { name: 'asc' }],
              select: { id: true, name: true, slug: true, imageUrl: true },
            },
          },
        }),
    );

    // Misses are not cached, same as products above.
    if (!category) {
      throw new NotFoundException('Category not found');
    }

    return category;
  }

  // Stable key regardless of the order the client sent the params in.
  private queryKey(query: ProductQueryDto): string {
    const parts: string[] = [
      `p${query.page ?? 1}`,
      `l${query.take}`,
      `s${query.sort ?? ProductSort.NEWEST}`,
    ];
    if (query.categoryId) parts.push(`cid:${query.categoryId}`);
    if (query.categorySlug) parts.push(`cs:${query.categorySlug}`);
    if (query.brand) parts.push(`b:${query.brand.toLowerCase()}`);
    if (query.search) parts.push(`q:${query.search.toLowerCase()}`);
    if (query.minPrice !== undefined) parts.push(`min:${query.minPrice}`);
    if (query.maxPrice !== undefined) parts.push(`max:${query.maxPrice}`);
    if (query.inStock === 'true') parts.push('instock');
    return parts.join('|');
  }

  private buildProductWhere(query: ProductQueryDto): Prisma.ProductWhereInput {
    // Public visibility requires all three: the product is published, its
    // category is active, and it has something buyable. Deactivating a
    // category hides its products without unpublishing them, so reactivating
    // brings them straight back.
    const and: Prisma.ProductWhereInput[] = [
      { isActive: true },
      { category: { isActive: true } },
      { variants: { some: { isActive: true } } },
    ];

    if (query.categoryId) {
      and.push({ categoryId: query.categoryId });
    }

    if (query.categorySlug) {
      // Exact match only: does not include descendant categories. Including
      // them needs a recursive CTE, which belongs with the search module.
      and.push({ category: { slug: query.categorySlug } });
    }

    if (query.brand) {
      and.push({ brand: { equals: query.brand, mode: 'insensitive' } });
    }

    // Collected into AND rather than set as a top-level OR, so that adding
    // another OR group later cannot silently overwrite this one.
    if (query.search) {
      and.push({
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } },
        ],
      });
    }

    // Price and stock filters apply to variants: a product matches when at
    // least one of its active variants satisfies them.
    const variantWhere: Prisma.ProductVariantWhereInput = { isActive: true };
    let hasVariantFilter = false;

    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      variantWhere.priceMinor = {
        ...(query.minPrice !== undefined ? { gte: query.minPrice } : {}),
        ...(query.maxPrice !== undefined ? { lte: query.maxPrice } : {}),
      };
      hasVariantFilter = true;
    }

    if (query.inStock === 'true') {
      // available = quantity - reserved, enforced by a DB check constraint,
      // so this is true buyable stock rather than stock on hand.
      variantWhere.inventory = { is: { available: { gt: 0 } } };
      hasVariantFilter = true;
    }

    if (hasVariantFilter) {
      and.push({ variants: { some: variantWhere } });
    }

    return { AND: and };
  }

  private buildOrderBy(
    sort?: ProductSort,
  ): Prisma.ProductOrderByWithRelationInput[] {
    // Every sort ends with id so ordering is stable across pages; without a
    // tiebreaker, rows sharing a sort value can repeat or vanish between pages.
    switch (sort) {
      case ProductSort.NAME:
        return [{ name: 'asc' }, { id: 'asc' }];
      case ProductSort.PRICE_ASC:
        // minPriceMinor is the cheapest active variant, maintained by
        // CatalogAdminService. nulls last keeps priceless products out of
        // the way rather than leading the list.
        return [
          { minPriceMinor: { sort: 'asc', nulls: 'last' } },
          { id: 'asc' },
        ];
      case ProductSort.PRICE_DESC:
        return [
          { minPriceMinor: { sort: 'desc', nulls: 'last' } },
          { id: 'asc' },
        ];
      case ProductSort.NEWEST:
      default:
        return [{ createdAt: 'desc' }, { id: 'asc' }];
    }
  }

  private buildCategoryTree(categories: CategoryRow[]): CategoryNode[] {
    const byId = new Map<string, CategoryNode>();
    categories.forEach((c) => byId.set(c.id, { ...c, children: [] }));

    const roots: CategoryNode[] = [];

    byId.forEach((node) => {
      if (!node.parentId) {
        roots.push(node);
        return;
      }

      const parent = byId.get(node.parentId);
      if (!parent) {
        // Parent is missing or inactive. Skip rather than promote: an
        // orphan must not appear as a top-level category in navigation.
        this.logger.warn(
          `Orphan category ${node.id} (parent ${node.parentId} missing or inactive)`,
        );
        return;
      }

      parent.children.push(node);
    });

    // Sort explicitly rather than trusting the query's ordering to survive
    // the restructuring above.
    const sortNodes = (nodes: CategoryNode[]) => {
      nodes.sort(
        (a, b) => a.position - b.position || a.name.localeCompare(b.name),
      );
      nodes.forEach((n) => sortNodes(n.children));
    };
    sortNodes(roots);

    // A cycle (A.parent = B, B.parent = A) leaves both out of roots entirely.
    if (byId.size > 0 && roots.length === 0) {
      this.logger.error('Category tree has no roots — possible parent cycle');
    }

    return roots;
  }
}
