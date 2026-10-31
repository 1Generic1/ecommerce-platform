import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type Tx = Prisma.TransactionClient;

// The single owner of the inventory invariants. Nothing else should write
// the inventory table directly.
//
// The table carries a DB check constraint available = quantity - reserved,
// so any statement changing quantity or reserved must set available in the
// same statement or Postgres rejects it. Keeping that knowledge here means
// cart, orders and the expiry job cannot each get it subtly wrong.
//
// See docs/inventory-invariants.md
@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Buyable units per variant. Returns a map so a cart with many lines
  // costs one query rather than one per line.
  async getAvailable(variantIds: string[]): Promise<Map<string, number>> {
    if (variantIds.length === 0) {
      return new Map();
    }

    const rows = await this.prisma.inventory.findMany({
      where: { variantId: { in: variantIds } },
      select: { variantId: true, available: true },
    });

    return new Map(rows.map((r) => [r.variantId, r.available]));
  }

  // Claims qty units. Returns false when there is not enough stock.
  //
  // The guard lives in the WHERE clause on purpose. A prior SELECT to
  // "check stock" leaves a window where two concurrent requests both see
  // enough and both proceed; here the check and the claim are one
  // statement, so the loser simply affects zero rows.
  //
  // NEVER replace this with a read followed by a write.
  async reserve(variantId: string, qty: number, tx?: Tx): Promise<boolean> {
    const client = tx ?? this.prisma;

    const affected = await client.$executeRaw(Prisma.sql`
      UPDATE inventory
      SET reserved  = reserved + ${qty},
          available = quantity - (reserved + ${qty})
      WHERE "variantId" = ${variantId}
        AND quantity - reserved >= ${qty}
    `);

    return affected === 1;
  }

  // Returns qty units to the pool — an abandoned checkout, a cancelled
  // order, an expired reservation.
  //
  // Returns false when the release could not be applied, which means the
  // units were already released. That is a bug worth seeing rather than
  // swallowing: releasing twice would inflate available stock.
  async release(variantId: string, qty: number, tx?: Tx): Promise<boolean> {
    const client = tx ?? this.prisma;

    const affected = await client.$executeRaw(Prisma.sql`
      UPDATE inventory
      SET reserved  = reserved - ${qty},
          available = quantity - (reserved - ${qty})
      WHERE "variantId" = ${variantId}
        AND reserved >= ${qty}
    `);

    if (affected !== 1) {
      this.logger.error(
        `Failed to release ${qty} units of variant ${variantId}: reserved is lower than the amount being released`,
      );
      return false;
    }

    return true;
  }

  // Converts a reservation into a sale: the units leave both quantity and
  // reserved, so available is unchanged. Called when an order is paid.
  async commit(variantId: string, qty: number, tx?: Tx): Promise<boolean> {
    const client = tx ?? this.prisma;

    const affected = await client.$executeRaw(Prisma.sql`
      UPDATE inventory
      SET quantity  = quantity - ${qty},
          reserved  = reserved - ${qty},
          available = (quantity - ${qty}) - (reserved - ${qty})
      WHERE "variantId" = ${variantId}
        AND reserved >= ${qty}
        AND quantity >= ${qty}
    `);

    if (affected !== 1) {
      this.logger.error(
        `Failed to commit ${qty} units of variant ${variantId}: insufficient quantity or reserved`,
      );
      return false;
    }

    return true;
  }
}
