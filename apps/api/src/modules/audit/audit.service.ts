import { Injectable, Logger } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

// Stored as plain strings in the database, so adding an action is one line
// here and no migration. Typed so a typo fails to compile rather than
// silently writing a row nobody will ever find by querying.
export type AuditAction =
  | 'product.publish'
  | 'product.unpublish'
  | 'variant.price_change'
  | 'variant.activate'
  | 'variant.deactivate'
  | 'stock.update'
  | 'category.create'
  | 'category.update';

export type AuditEntityType = 'Product' | 'ProductVariant' | 'Category';

export interface AuditEntry {
  actorId?: string | null;
  actorEmail?: string | null;
  actorRole?: Role | null;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Contract: this method NEVER throws. Audit failures are logged, not
  // propagated, so a failed audit write cannot roll back or block the
  // business operation it describes. Callers must not wrap it in try/catch.
  //
  // A failure is logged at error level, since a silent gap in the trail is
  // worse than a noisy one. Nothing watches that log stream yet — see the
  // deployment checklist in docs/inventory-invariants.md.
  //
  // before/after are assumed JSON-safe. In practice they come from DTO
  // fields (already JSON) or Prisma reads (JSON-safe), so the cast holds.
  // A future caller passing a Date or class instance would fail at
  // serialization time.
  //
  // Pass tx to record inside an existing transaction, when the audit entry
  // should disappear along with a rolled-back operation.
  async record(
    entry: AuditEntry,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;

    try {
      await client.auditLog.create({
        data: {
          actorId: entry.actorId ?? null,
          actorEmail: entry.actorEmail ?? null,
          actorRole: entry.actorRole ?? null,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          before: (entry.before ?? null) as Prisma.InputJsonValue,
          after: (entry.after ?? null) as Prisma.InputJsonValue,
          ipAddress: entry.ipAddress ?? null,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to write audit entry ${entry.action} on ${entry.entityType}:${entry.entityId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  // Returns the most recent entries only. Add cursor pagination when the
  // admin dashboard needs to page through long histories.
  async findForEntity(
    entityType: AuditEntityType,
    entityId: string,
    limit = 50,
  ) {
    return this.prisma.auditLog.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
