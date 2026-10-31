import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import {
  AddCartItemDto,
  MAX_QUANTITY_PER_LINE,
  UpdateCartItemDto,
} from './dto/cart-item.dto';

type Tx = Prisma.TransactionClient;

export interface CartOwner {
  userId?: string;
  sessionId?: string;
}

// Nothing here is cached. A cart has exactly one reader, so a cache would
// carry invalidation complexity for almost no saved queries, and a stale
// cart is worse than the query it avoided.
@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  // Distinct lines, not units. Bounds the response size and the cost of the
  // availability lookup.
  private static readonly MAX_LINES = 50;

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  // ---------- reads ----------

  async getCart(owner: CartOwner) {
    const cart = await this.findCart(owner);

    if (!cart) {
      // Deliberately does not create a row. A read should not leave a cart
      // behind for every crawler that hits the endpoint.
      return this.emptyCart();
    }

    return this.present(cart);
  }

  // ---------- writes ----------

  async addItem(owner: CartOwner, dto: AddCartItemDto) {
    const quantity = dto.quantity ?? 1;
    const variant = await this.loadPurchasableVariant(dto.variantId);

    const cart = await this.resolveCart(owner);

    const existing = await this.prisma.cartItem.findUnique({
      where: { cartId_variantId: { cartId: cart.id, variantId: variant.id } },
      select: { id: true, quantity: true },
    });

    if (!existing) {
      const lines = await this.prisma.cartItem.count({
        where: { cartId: cart.id },
      });
      if (lines >= CartService.MAX_LINES) {
        throw new BadRequestException(
          `A cart can hold at most ${CartService.MAX_LINES} different items`,
        );
      }
    }

    // Adding to an existing line increments it, so the check is against the
    // resulting total rather than the amount being added.
    const total = (existing?.quantity ?? 0) + quantity;

    if (total > MAX_QUANTITY_PER_LINE) {
      throw new BadRequestException(
        `You can have at most ${MAX_QUANTITY_PER_LINE} of this item in your cart`,
      );
    }

    await this.assertAvailable(variant.id, total);

    // Read-then-write on the line quantity. Two concurrent adds to the same
    // cart could exceed the per-line cap; a cart has one owner so that is
    // rare, and the consequence is a slightly too-large line rather than an
    // oversell. Stock itself is claimed atomically at checkout.
    await this.prisma.cartItem.upsert({
      where: { cartId_variantId: { cartId: cart.id, variantId: variant.id } },
      create: { cartId: cart.id, variantId: variant.id, quantity },
      update: { quantity: total },
    });

    return this.present(await this.loadCart(cart.id), cart.sessionId);
  }

  async updateItem(owner: CartOwner, itemId: string, dto: UpdateCartItemDto) {
    const { cart, item } = await this.assertOwnsItem(owner, itemId);

    await this.assertAvailable(item.variantId, dto.quantity);

    await this.prisma.cartItem.update({
      where: { id: itemId },
      data: { quantity: dto.quantity },
    });

    return this.present(await this.loadCart(cart.id), cart.sessionId);
  }

  async removeItem(owner: CartOwner, itemId: string) {
    const { cart } = await this.assertOwnsItem(owner, itemId);

    await this.prisma.cartItem.delete({ where: { id: itemId } });

    return this.present(await this.loadCart(cart.id), cart.sessionId);
  }

  async clear(owner: CartOwner) {
    const cart = await this.findCart(owner);
    if (!cart) {
      return this.emptyCart();
    }

    await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });

    return this.present(await this.loadCart(cart.id), cart.sessionId);
  }

  // ---------- merge on login ----------

  // Called by the client immediately after login, with both the access
  // token and the guest session header still in hand.
  async merge(userId: string | undefined, sessionId: string | undefined) {
    if (!userId) {
      throw new UnauthorizedException('Sign in before merging a cart');
    }

    if (!sessionId) {
      // Nothing to merge. Return whatever the user already has rather than
      // treating it as an error — the client cannot always know whether a
      // guest cart existed.
      return this.getCart({ userId });
    }

    return this.prisma.$transaction(async (tx) => {
      const guestCart = await tx.cart.findUnique({
        where: { sessionId },
        include: { items: true },
      });

      if (!guestCart) {
        return this.present(await this.loadCart(undefined, { userId }, tx));
      }

      const userCart = await tx.cart.findUnique({ where: { userId } });

      // With no existing user cart, the guest cart is simply adopted. Both
      // columns move in one statement because carts_owner_check requires
      // exactly one owner — setting userId without clearing sessionId would
      // be rejected.
      if (!userCart) {
        await tx.cart.update({
          where: { id: guestCart.id },
          data: { userId, sessionId: null },
        });
        return this.present(await this.loadCart(guestCart.id, undefined, tx));
      }

      for (const item of guestCart.items) {
        const mine = await tx.cartItem.findUnique({
          where: {
            cartId_variantId: {
              cartId: userCart.id,
              variantId: item.variantId,
            },
          },
          select: { quantity: true },
        });

        // Quantities are summed and clamped to the per-line cap. They are
        // deliberately NOT clamped to current stock: availability is shown
        // on every cart read and enforced atomically at checkout, and
        // silently shrinking a line here would look like data loss.
        const quantity = Math.min(
          (mine?.quantity ?? 0) + item.quantity,
          MAX_QUANTITY_PER_LINE,
        );

        await tx.cartItem.upsert({
          where: {
            cartId_variantId: {
              cartId: userCart.id,
              variantId: item.variantId,
            },
          },
          create: {
            cartId: userCart.id,
            variantId: item.variantId,
            quantity,
          },
          update: { quantity },
        });
      }

      // Cascades to its items.
      await tx.cart.delete({ where: { id: guestCart.id } });

      this.logger.log(
        `Merged guest cart ${guestCart.id} (${guestCart.items.length} items) into user ${userId}`,
      );

      return this.present(await this.loadCart(userCart.id, undefined, tx));
    });
  }

  // ---------- cart resolution ----------

  private async findCart(owner: CartOwner) {
    if (owner.userId) {
      return this.prisma.cart.findUnique({
        where: { userId: owner.userId },
        include: this.itemInclude(),
      });
    }

    if (owner.sessionId) {
      return this.prisma.cart.findUnique({
        where: { sessionId: owner.sessionId },
        include: this.itemInclude(),
      });
    }

    return null;
  }

  // Finds or creates the caller's cart. Only writes call this; reads use
  // findCart so they never create a row.
  private async resolveCart(
    owner: CartOwner,
  ): Promise<{ id: string; sessionId: string | null }> {
    if (owner.userId) {
      const existing = await this.prisma.cart.findUnique({
        where: { userId: owner.userId },
        select: { id: true, sessionId: true },
      });
      if (existing) return existing;

      return this.prisma.cart.create({
        data: { userId: owner.userId },
        select: { id: true, sessionId: true },
      });
    }

    if (owner.sessionId) {
      const existing = await this.prisma.cart.findUnique({
        where: { sessionId: owner.sessionId },
        select: { id: true, sessionId: true },
      });
      if (existing) return existing;
      // Falls through: a session id matching nothing gets a fresh cart with
      // a server-generated id, rather than claiming the id it asked for.
    }

    return this.prisma.cart.create({
      data: { sessionId: randomUUID() },
      select: { id: true, sessionId: true },
    });
  }

  private async loadCart(
    cartId?: string,
    owner?: CartOwner,
    tx?: Tx,
  ): Promise<Awaited<ReturnType<CartService['findCart']>>> {
    const client = tx ?? this.prisma;

    if (cartId) {
      return client.cart.findUniqueOrThrow({
        where: { id: cartId },
        include: this.itemInclude(),
      });
    }

    if (owner?.userId) {
      return client.cart.findUnique({
        where: { userId: owner.userId },
        include: this.itemInclude(),
      });
    }

    return null;
  }

  // Variants are loaded WITHOUT filtering on isActive: an item whose variant
  // was retired must still appear so the customer can see why it cannot be
  // bought and remove it. present() marks it instead of hiding it.
  private itemInclude() {
    return {
      items: {
        orderBy: { createdAt: 'asc' as const },
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
                    orderBy: { position: 'asc' as const },
                    take: 1,
                    select: { url: true },
                  },
                },
              },
            },
          },
        },
      },
    };
  }

  // ---------- presentation ----------

  private async present(
    cart: Awaited<ReturnType<CartService['findCart']>>,
    sessionIdOverride?: string | null,
  ) {
    if (!cart) {
      return this.emptyCart();
    }

    const availability = await this.inventory.getAvailable(
      cart.items.map((i) => i.variantId),
    );

    const items = cart.items.map((item) => {
      const available = availability.get(item.variantId) ?? 0;

      // Purchasable means the same thing here as in the catalog: the
      // variant, its product and its category are all active. If those
      // definitions ever diverge, a customer could hold an item in their
      // cart that the storefront no longer lists.
      const listed =
        item.variant.isActive &&
        item.variant.product.isActive &&
        item.variant.product.category.isActive;

      const unitPriceMinor = item.variant.priceMinor;
      const purchasable = listed && available >= item.quantity;

      return {
        id: item.id,
        variantId: item.variantId,
        quantity: item.quantity,
        // Prices come straight from the variant for now. Once the pricing
        // module exists, flash-sale and coupon prices resolve through it,
        // and this is the line that changes.
        unitPriceMinor,
        lineTotalMinor: unitPriceMinor * item.quantity,
        available,
        purchasable,
        unavailableReason: listed
          ? available >= item.quantity
            ? null
            : available === 0
              ? 'out_of_stock'
              : 'insufficient_stock'
          : 'no_longer_sold',
        variant: {
          id: item.variant.id,
          name: item.variant.name,
          sku: item.variant.sku,
          options: item.variant.options,
        },
        product: {
          id: item.variant.product.id,
          name: item.variant.product.name,
          slug: item.variant.product.slug,
          imageUrl: item.variant.product.images[0]?.url ?? null,
        },
      };
    });

    // Totals cover only purchasable lines, so the figure shown is what the
    // customer can actually pay for.
    const purchasable = items.filter((i) => i.purchasable);

    return {
      id: cart.id,
      // Returned so a guest client can store it and send it back as
      // X-Cart-Session. Null for a signed-in cart.
      sessionId: sessionIdOverride ?? cart.sessionId,
      items,
      itemCount: purchasable.reduce((sum, i) => sum + i.quantity, 0),
      subtotalMinor: purchasable.reduce((sum, i) => sum + i.lineTotalMinor, 0),
      currency: 'NGN',
      hasUnavailableItems: items.some((i) => !i.purchasable),
    };
  }

  private emptyCart() {
    return {
      id: null,
      sessionId: null,
      items: [],
      itemCount: 0,
      subtotalMinor: 0,
      currency: 'NGN',
      hasUnavailableItems: false,
    };
  }

  // ---------- guards ----------

  private async loadPurchasableVariant(variantId: string) {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      select: {
        id: true,
        isActive: true,
        product: {
          select: { isActive: true, category: { select: { isActive: true } } },
        },
      },
    });

    // 404 rather than 400 for an unlisted variant: as far as a customer is
    // concerned it does not exist, and saying otherwise would confirm the
    // existence of unpublished products.
    if (
      !variant ||
      !variant.isActive ||
      !variant.product.isActive ||
      !variant.product.category.isActive
    ) {
      throw new NotFoundException('Item not found');
    }

    return variant;
  }

  private async assertAvailable(variantId: string, quantity: number) {
    const available =
      (await this.inventory.getAvailable([variantId])).get(variantId) ?? 0;

    if (available < quantity) {
      throw new BadRequestException(
        available === 0
          ? 'This item is out of stock'
          : `Only ${available} left in stock`,
      );
    }
  }

  // 404 rather than 403 for an item in someone else's cart, matching the
  // address guard: a 403 confirms the id exists.
  private async assertOwnsItem(owner: CartOwner, itemId: string) {
    const cart = await this.findCart(owner);
    if (!cart) {
      throw new NotFoundException('Cart item not found');
    }

    const item = cart.items.find((i) => i.id === itemId);
    if (!item) {
      throw new NotFoundException('Cart item not found');
    }

    return { cart, item };
  }
}
