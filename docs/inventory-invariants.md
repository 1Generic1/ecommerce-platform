# Invariants, races and deferred work

Notes that outlive the conversation they came from. Each entry says what is
true now, and where something is still owed, what unparks it.

---

## Inventory: the check constraint

`inventory` carries:

    CHECK (available = quantity - reserved)
    CHECK (reserved >= 0 AND reserved <= quantity)

Postgres rejects any statement that changes `quantity` or `reserved` without
setting `available` to match, in the same statement. A violation is a bug in
our code, not bad input — it should surface as a 500 and be loud. The second
constraint is why `available` can never be negative, so clamping a displayed
value with `Math.max(..., 0)` would be concealment rather than protection,
and is not used anywhere.

The constraint is the backstop, not the mechanism. See below.

## Inventory: reservation is atomic — done

`InventoryService` owns every write to the table. `reserve`, `release` and
`commit` each put their guard in the WHERE clause:

    UPDATE inventory
    SET reserved  = reserved + :qty,
        available = quantity - (reserved + :qty)
    WHERE "variantId" = :id
      AND quantity - reserved >= :qty;

Zero rows affected means insufficient stock. NEVER replace this with a
SELECT followed by an UPDATE: a prior read leaves a window where two
concurrent requests both see enough stock and both proceed.

Nothing else should write `inventory` directly. Cart, orders and the
reservation-expiry job all call this service.

## OPEN — the updateStock race

`CatalogAdminService.updateStock` reads `reserved`, then writes `available`
computed from the value it read:

    t1  admin:  findUnique -> reserved = 5
    t2  order:  UPDATE reserved = 7
    t3  admin:  UPDATE quantity = 10, available = 10 - 5 = 5   <- should be 3

Dormant until orders began writing `reserved`. The constraint catches it, so
the admin's save fails loudly rather than persisting a wrong value — but a
failed save is still a bug.

Fix, either:
  - compute in SQL:  SET quantity = $1, available = $1 - reserved
  - or run the read and the write in one transaction with SELECT ... FOR UPDATE

Do this with the orders module, not after it.

## OPEN — reservation expiry

Checkout holds stock for 15 minutes via `Order.reservationExpiresAt`. The
job that releases a lapsed hold does not exist yet, so an abandoned checkout
holds its stock indefinitely. This is the single most load-bearing of the
BullMQ jobs: without it, a flash sale drains to zero on abandoned attempts.

Query it by `(status, reservationExpiresAt)` — the index is already there.

## Idempotency — done, retention open

`IdempotencyInterceptor` acts on routes marked `@Idempotent()`. The key row
is inserted BEFORE the handler runs, so two simultaneous requests collide on
the primary key instead of racing.

Correctness does not depend on a cleanup job: a later request takes over an
in-progress key abandoned for more than 60s, and the takeover is guarded in
the WHERE clause so only one caller wins. But nothing purges the table.

Add to the BullMQ work, hourly:

    DELETE FROM idempotency_keys
    WHERE "createdAt" < NOW() - INTERVAL '24 hours';

`@@index([createdAt])` is already there for it. 24 hours is well past any
client's retry window; deleting a completed key only means a much later
retry would redo the work rather than replay it.

`STALE_AFTER_MS` (60s) is the one number here that causes double work if set
too low. It must comfortably exceed the slowest handler on any `@Idempotent()`
route. A genuinely slow route needs its own threshold, not this one.

## Order numbers

`EC-2026-00147` — one global sequence, `order_number_seq`, with the year
stamped on from the order's own date. The counter does not reset each year.

`nextval` is deliberately outside transaction control, which is what makes
it safe under concurrency: two simultaneous checkouts can never get the same
number. A rolled-back checkout burns a number and leaves a gap. Gaps are
invisible to customers; duplicates would break support and the unique index.

This is an order number, NOT an invoice number. If formal invoices ever need
gapless numbering, give them their own series with a locked counter table —
and check what the relevant tax rules actually require first.

## Variant visibility — one definition

"Publicly listed" means the variant, its product and its category are all
active. Stock is not part of it, which is why a wishlist can hold a sold-out
item.

That rule lives in `CatalogService.isVariantListed`. Cart and wishlist both
call it. If it ever diverges from `buildProductWhere`, a customer can hold an
item the storefront no longer shows.

## minPriceMinor — maintained, reconciler unscheduled

`Product.minPriceMinor` is denormalized for price sorting, recomputed inside
every variant write by `recomputeMinPrice`, which also owns the invariant
"an active product has at least one active variant".

`reconcileMinPrices` self-heals drift from writes that bypass the service
(bulk SQL, seeds, manual fixes). It is currently a manual admin endpoint.
Schedule it nightly with the BullMQ work; an endpoint nobody calls is not a
safety net.

Three places compute the same minimum — the Prisma aggregate in
`recomputeMinPrice`, the SELECT and the UPDATE in the reconciler, and
`prisma/seed.ts`. They must agree. A `fixed` count that never settles toward
zero means they have diverged.

## OPEN — audit log gaps

- `ipAddress` and `userAgent` columns exist but are never filled. Needs an
  interceptor with request access; threading `req` through every service
  method is the wrong shape.
- `before` is read outside the transaction in `updateVariant`, so under
  concurrent edits the recorded before-value can be stale. Fixing it means
  SELECT ... FOR UPDATE on every variant update — not worth the lock
  contention for a rare case with a cosmetic consequence.
- No retention policy. Decide before the table is large: partition by month,
  archive, or purge.
- `AuditService.record` logs at error level on failure but nothing watches
  that stream. Before production, alert on "Failed to write audit entry" — a
  gap in the trail is worth knowing about within minutes.

## OPEN — session revocation

`JwtStrategy.validate` hits the database on every authenticated request. If
that is ever cached (60s Redis, keyed by user id), three things must
invalidate it, and two live in the users module:

  - `changePassword` — a password change should end other sessions
  - role change — a demoted admin would keep admin rights for the TTL
  - deactivation — a banned user would keep shopping for the TTL

The TODO in `changePassword` about revoking sessions is the same piece of
work. Measure before caching: move off the per-request lookup when it
exceeds ~5% of p95, or when the connection pool saturates.

## Cart: deliberate non-guarantees

- Adding to cart does NOT reserve stock. Only checkout does.
- `addItem` reads the line quantity then writes it, so two concurrent adds to
  one cart could exceed the per-line cap of 99. A cart has one owner, so this
  is rare, and the consequence is a slightly large line rather than an
  oversell.
- Guest cart session ids are server-minted UUIDs from `crypto.randomUUID`.
  A client-supplied id is only ever used to LOOK UP a cart; one that matches
  nothing gets a fresh server-generated cart, which is what stops someone
  guessing into another guest's cart.
- Merge on login adopts the guest cart outright when the user has none,
  flipping `userId` and `sessionId` in one statement because
  `carts_owner_check` forbids a cart owned by both.
