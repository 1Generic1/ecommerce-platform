-- AlterTable
ALTER TABLE "products" ADD COLUMN     "minPriceMinor" INTEGER;

-- CreateIndex
CREATE INDEX "products_minPriceMinor_idx" ON "products"("minPriceMinor");
