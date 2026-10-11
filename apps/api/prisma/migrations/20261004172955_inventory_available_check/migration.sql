-- Backfill before the constraint goes on, so existing rows satisfy it.
UPDATE "inventory" SET "available" = "quantity" - "reserved";

ALTER TABLE "inventory" ADD CONSTRAINT "inventory_available_check"
CHECK ("available" = "quantity" - "reserved");