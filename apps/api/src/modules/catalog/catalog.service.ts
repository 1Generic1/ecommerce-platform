import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { paginate } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
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

  constructor(private readonly prisma: PrismaService) {}

  async findProducts(query: ProductQueryDto) {
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
  }

  async findProductBySlug(slug: string) {
    const product = await this.prisma.product.findFirst({
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

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    // Expose availability without leaking internal quantity/reserved counts.
    // available is 0 for a sold-out variant; the variant still appears, so
    // the storefront can show it as out of stock rather than hiding it.
    return {
      ...product,
      variants: product.variants.map(({ inventory, ...variant }) => ({
        ...variant,
        available: inventory?.available ?? 0,
      })),
    };
  }

  async findCategories() {
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
  }

  async findCategoryBySlug(slug: string) {
    // Deliberately one level deep: this powers a category landing page,
    // which shows immediate subcategories as tiles and then products.
    // findCategories() returns the full tree for navigation.
    const category = await this.prisma.category.findFirst({
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
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    return category;
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
