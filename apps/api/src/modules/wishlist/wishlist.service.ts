import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { paginate } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { CartService } from '../cart/cart.service';
import { CatalogService } from '../catalog/catalog.service';
import { InventoryService } from '../inventory/inventory.service';
import { WishlistQueryDto } from './dto/wishlist.dto';

// Signed-in users only. WishlistItem has no session column, so there is no
// guest wishlist — adding one would need a migration and the same
// merge-on-login handling the cart has.
//
// Not cached: per-user data with one reader.
@Injectable()
export class WishlistService {
  private readonly logger = new Logger(WishlistService.name);

  // Generous, since saving many items is normal. Bounds a looping client
  // rather than shaping the feature.
  private static readonly MAX_ITEMS = 500;

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly inventory: InventoryService,
    private readonly cart: CartService,
  ) {}

  async list(userId: string, query: WishlistQueryDto) {
    const where = { userId };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.wishlistItem.findMany({
        where,
        skip: query.skip,
        take: query.take,
        // Newest first; id breaks ties so paging is stable.
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        include: {
          variant: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  isActive: true,
                  category: { select: { isActive: true } },
                  images: {
                    where: { variantId: null },
                    orderBy: { position: 'asc' },
                    take: 1,
                    select: { url: true },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.wishlistItem.count({ where }),
    ]);

    const availability = await this.inventory.getAvailable(
      rows.map((r) => r.variantId),
    );

    const items = rows.map((row) => {
      const available = availability.get(row.variantId) ?? 0;
      const listed =
        row.variant.isActive &&
        row.variant.product.isActive &&
        row.variant.product.category.isActive;

      return {
        id: row.id,
        variantId: row.variantId,
        addedAt: row.createdAt,
        // Out of stock is the interesting case for a wishlist, so these are
        // reported separately: an unlisted item is gone for good, while a
        // sold-out one is what the customer is waiting for.
        listed,
        available,
        inStock: listed && available > 0,
        unitPriceMinor: row.variant.priceMinor,
        compareAtMinor: row.variant.compareAtMinor,
        variant: {
          id: row.variant.id,
          name: row.variant.name,
          sku: row.variant.sku,
          options: row.variant.options,
        },
        product: {
          id: row.variant.product.id,
          name: row.variant.product.name,
          slug: row.variant.product.slug,
          imageUrl: row.variant.product.images[0]?.url ?? null,
        },
      };
    });

    return paginate(items, total, query.page ?? 1, query.take);
  }

  async add(userId: string, variantId: string) {
    // Stock is deliberately not checked: saving a sold-out item is the
    // point of a wishlist. Only listing matters.
    if (!(await this.catalog.isVariantListed(variantId))) {
      throw new NotFoundException('Item not found');
    }

    const count = await this.prisma.wishlistItem.count({ where: { userId } });
    if (count >= WishlistService.MAX_ITEMS) {
      throw new BadRequestException(
        `You can save at most ${WishlistService.MAX_ITEMS} items`,
      );
    }

    // Upsert rather than create, so a double-tapped heart is idempotent
    // instead of a 409. The empty update is intentional: re-adding should
    // not move the item to the top of the list.
    const item = await this.prisma.wishlistItem.upsert({
      where: { userId_variantId: { userId, variantId } },
      create: { userId, variantId },
      update: {},
    });

    return { id: item.id, variantId: item.variantId, addedAt: item.createdAt };
  }

  // Keyed by variantId, not by the wishlist item's id. A heart toggle on a
  // product page knows the variant it is showing but not the row id, so
  // removing by variant saves the client a lookup. The cart uses item ids
  // because the client is rendering those rows and already has them.
  async remove(userId: string, variantId: string) {
    const deleted = await this.prisma.wishlistItem.deleteMany({
      where: { userId, variantId },
    });

    if (deleted.count === 0) {
      throw new NotFoundException('Item not in your wishlist');
    }

    return { success: true };
  }

  async moveToCart(userId: string, variantId: string, quantity: number) {
    const existing = await this.prisma.wishlistItem.findUnique({
      where: { userId_variantId: { userId, variantId } },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Item not in your wishlist');
    }

    // Cart first. It enforces listing, stock and the per-line cap, and
    // throws if any fails — in which case the wishlist item stays put,
    // which is what the customer would expect.
    //
    // The two writes are not one transaction: addItem runs its own queries
    // and making it transaction-aware is not worth it here, because the
    // only failure mode is the item appearing in both places, which the
    // customer can resolve and which loses nothing.
    const cart = await this.cart.addItem({ userId }, { variantId, quantity });

    await this.prisma.wishlistItem.delete({ where: { id: existing.id } });

    return { cart };
  }
}
