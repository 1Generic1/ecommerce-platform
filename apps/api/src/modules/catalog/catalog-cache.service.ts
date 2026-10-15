import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../../prisma/prisma.service';

// TTLs in milliseconds.
export const CATEGORY_TREE_TTL = 60 * 60 * 1000; // 1 hour — changes rarely
export const PRODUCT_DETAIL_TTL = 60 * 1000; // 60s — caps the sold-out window
export const PRODUCT_LIST_TTL = 90 * 1000; // 90s — no targeted invalidation

export const CATEGORY_TREE_KEY = 'catalog:categories:tree';

export const productKey = (slug: string) => `catalog:product:${slug}`;
export const categoryKey = (slug: string) => `catalog:category:${slug}`;

@Injectable()
export class CatalogCacheService {
  private readonly logger = new Logger(CatalogCacheService.name);

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly prisma: PrismaService,
  ) {}

  // Every method here swallows its own errors: a cache failure must never
  // fail the write it follows. The cost of a missed invalidation is bounded
  // by the TTL.
  private async del(...keys: string[]): Promise<void> {
    try {
      await Promise.all(keys.map((k) => this.cache.del(k)));
    } catch (error) {
      this.logger.error(
        `Cache invalidation failed for ${keys.join(', ')}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async invalidateProduct(productId: string): Promise<void> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { slug: true },
    });
    if (product) {
      await this.del(productKey(product.slug));
    }
  }

  // Stock and variant writes identify a variant, not a product, so the
  // product has to be resolved before its key can be dropped. Without this,
  // restocking would leave a stale "out of stock" page for the full TTL.
  async invalidateByVariant(variantId: string): Promise<void> {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      select: { product: { select: { slug: true } } },
    });
    if (variant) {
      await this.del(productKey(variant.product.slug));
    }
  }

  async invalidateCategories(slug?: string): Promise<void> {
    await this.del(
      CATEGORY_TREE_KEY,
      ...(slug ? [categoryKey(slug)] : []),
    );
  }
}
