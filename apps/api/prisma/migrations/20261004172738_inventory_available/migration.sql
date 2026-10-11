-- AlterTable
ALTER TABLE "inventory" ADD COLUMN     "available" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "inventory_available_idx" ON "inventory"("available");
