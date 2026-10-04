-- This is an empty migration.-- A cart belongs to exactly one owner: a user OR a session, never both, never neither
ALTER TABLE "carts"
ADD CONSTRAINT "carts_owner_check"
CHECK (
  ("userId" IS NOT NULL AND "sessionId" IS NULL)
  OR
  ("userId" IS NULL AND "sessionId" IS NOT NULL)
);

-- Cart quantities must be positive; a zero-quantity row should be deleted instead
ALTER TABLE "cart_items"
ADD CONSTRAINT "cart_items_quantity_check"
CHECK ("quantity" > 0);

-- Stock can never go negative, and you can't reserve more than you have
ALTER TABLE "inventory"
ADD CONSTRAINT "inventory_quantity_check"
CHECK ("quantity" >= 0);

ALTER TABLE "inventory"
ADD CONSTRAINT "inventory_reserved_check"
CHECK ("reserved" >= 0 AND "reserved" <= "quantity");

-- Prices can never be negative
ALTER TABLE "product_variants"
ADD CONSTRAINT "product_variants_price_check"
CHECK ("priceMinor" >= 0);

ALTER TABLE "product_variants"
ADD CONSTRAINT "product_variants_compare_at_check"
CHECK ("compareAtMinor" IS NULL OR "compareAtMinor" >= 0);