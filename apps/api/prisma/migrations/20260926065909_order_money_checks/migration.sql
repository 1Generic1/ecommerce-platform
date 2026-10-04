-- This is an empty migration.
ALTER TABLE "orders" ADD CONSTRAINT "orders_totals_check"
CHECK ("subtotalMinor" >= 0 AND "discountMinor" >= 0 AND "shippingMinor" >= 0 AND "totalMinor" >= 0);

ALTER TABLE "order_items" ADD CONSTRAINT "order_items_amounts_check"
CHECK ("quantity" > 0 AND "unitPriceMinor" >= 0 AND "totalMinor" >= 0);

ALTER TABLE "order_items" ADD CONSTRAINT "order_items_total_math_check"
CHECK ("unitPriceMinor" * "quantity" = "totalMinor");

ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_check"
CHECK ("amountMinor" > 0);

ALTER TABLE "refunds" ADD CONSTRAINT "refunds_amount_check"
CHECK ("amountMinor" > 0);