CREATE EXTENSION IF NOT EXISTS citext;

ALTER TABLE "coupons" ALTER COLUMN "code" TYPE citext;

ALTER TABLE "flash_sale_items" ADD CONSTRAINT "flash_sale_items_quantity_check"
CHECK ("totalQuantity" > 0 AND "soldQuantity" >= 0 AND "soldQuantity" <= "totalQuantity");

ALTER TABLE "flash_sale_items" ADD CONSTRAINT "flash_sale_items_price_check"
CHECK ("salePriceMinor" >= 0 AND "perUserLimit" > 0);

ALTER TABLE "flash_sale_items" ADD CONSTRAINT "flash_sale_items_original_price_check"
CHECK ("originalPriceMinor" >= 0 AND "salePriceMinor" <= "originalPriceMinor");

ALTER TABLE "flash_sales" ADD CONSTRAINT "flash_sales_dates_check"
CHECK ("endsAt" > "startsAt");

ALTER TABLE "flash_sale_purchases" ADD CONSTRAINT "flash_sale_purchases_quantity_check"
CHECK ("quantity" > 0);

ALTER TABLE "coupons" ADD CONSTRAINT "coupons_value_check"
CHECK ("discountValue" > 0 AND "usedCount" >= 0 AND "perUserLimit" > 0);

ALTER TABLE "coupons" ADD CONSTRAINT "coupons_percentage_check"
CHECK ("discountType" <> 'PERCENTAGE' OR "discountValue" <= 10000);

ALTER TABLE "coupons" ADD CONSTRAINT "coupons_usage_limit_check"
CHECK ("usageLimit" IS NULL OR "usedCount" <= "usageLimit");

ALTER TABLE "coupons" ADD CONSTRAINT "coupons_dates_check"
CHECK ("startsAt" IS NULL OR "endsAt" IS NULL OR "endsAt" > "startsAt");

ALTER TABLE "coupons" ADD CONSTRAINT "coupons_optional_amounts_check"
CHECK (("minSpendMinor" IS NULL OR "minSpendMinor" >= 0)
   AND ("maxDiscountMinor" IS NULL OR "maxDiscountMinor" > 0));

ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_amount_check"
CHECK ("discountMinor" > 0);

ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rating_check"
CHECK ("rating" >= 1 AND "rating" <= 5);

ALTER TABLE "review_images" ADD CONSTRAINT "review_images_position_check"
CHECK ("position" >= 0);