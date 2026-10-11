import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// Prices in kobo: 4_500_000 = NGN 45,000.00
type VariantSeed = {
  sku: string;
  name: string;
  priceMinor: number;
  compareAtMinor?: number;
  options: Record<string, string>;
  quantity: number;
};

type ProductSeed = {
  name: string;
  slug: string;
  description: string;
  brand: string;
  categorySlug: string;
  isActive: boolean;
  variants: VariantSeed[];
};

const categories = [
  { name: 'Electronics', slug: 'electronics', position: 0, parentSlug: null },
  { name: 'Audio', slug: 'audio', position: 0, parentSlug: 'electronics' },
  { name: 'Phones', slug: 'phones', position: 1, parentSlug: 'electronics' },
  { name: 'Fashion', slug: 'fashion', position: 1, parentSlug: null },
  { name: 'Footwear', slug: 'footwear', position: 0, parentSlug: 'fashion' },
];

const products: ProductSeed[] = [
  {
    name: 'Wireless Earbuds Pro',
    slug: 'wireless-earbuds-pro',
    description: 'Noise cancelling, 30 hour battery',
    brand: 'Acme',
    categorySlug: 'audio',
    isActive: true,
    variants: [
      { sku: 'EAR-PRO-BLK', name: 'Black', priceMinor: 4_500_000, compareAtMinor: 5_500_000, options: { color: 'Black' }, quantity: 12 },
      { sku: 'EAR-PRO-WHT', name: 'White', priceMinor: 4_800_000, options: { color: 'White' }, quantity: 5 },
    ],
  },
  {
    name: 'Studio Headphones',
    slug: 'studio-headphones',
    description: 'Over-ear, wired, flat response',
    brand: 'Acme',
    categorySlug: 'audio',
    isActive: true,
    variants: [
      { sku: 'HPH-STD-BLK', name: 'Black', priceMinor: 8_900_000, options: { color: 'Black' }, quantity: 3 },
    ],
  },
  {
    name: 'Bluetooth Speaker Mini',
    slug: 'bluetooth-speaker-mini',
    description: 'Pocket sized, waterproof',
    brand: 'Boomly',
    categorySlug: 'audio',
    isActive: true,
    variants: [
      { sku: 'SPK-MIN-RED', name: 'Red', priceMinor: 1_750_000, options: { color: 'Red' }, quantity: 40 },
      { sku: 'SPK-MIN-BLU', name: 'Blue', priceMinor: 1_750_000, options: { color: 'Blue' }, quantity: 0 },
    ],
  },
  {
    name: 'Smartphone X12',
    slug: 'smartphone-x12',
    description: '6.5 inch display, dual camera',
    brand: 'Nova',
    categorySlug: 'phones',
    isActive: true,
    variants: [
      { sku: 'PHN-X12-128', name: '128GB', priceMinor: 32_000_000, options: { storage: '128GB' }, quantity: 7 },
      { sku: 'PHN-X12-256', name: '256GB', priceMinor: 38_000_000, compareAtMinor: 42_000_000, options: { storage: '256GB' }, quantity: 2 },
    ],
  },
  {
    name: 'Smartphone A3 Lite',
    slug: 'smartphone-a3-lite',
    description: 'Budget friendly, long battery',
    brand: 'Nova',
    categorySlug: 'phones',
    isActive: true,
    variants: [
      { sku: 'PHN-A3-064', name: '64GB', priceMinor: 11_500_000, options: { storage: '64GB' }, quantity: 25 },
    ],
  },
  {
    name: 'Running Shoes Flux',
    slug: 'running-shoes-flux',
    description: 'Lightweight trainer, breathable mesh',
    brand: 'Stride',
    categorySlug: 'footwear',
    isActive: true,
    variants: [
      { sku: 'SHO-FLX-41', name: 'EU 41', priceMinor: 6_200_000, options: { size: '41' }, quantity: 8 },
      { sku: 'SHO-FLX-42', name: 'EU 42', priceMinor: 6_200_000, options: { size: '42' }, quantity: 0 },
      { sku: 'SHO-FLX-43', name: 'EU 43', priceMinor: 6_200_000, options: { size: '43' }, quantity: 4 },
    ],
  },
  {
    name: 'Canvas Sneakers Classic',
    slug: 'canvas-sneakers-classic',
    description: 'Everyday low-top',
    brand: 'Stride',
    categorySlug: 'footwear',
    isActive: true,
    variants: [
      { sku: 'SHO-CNV-40', name: 'EU 40', priceMinor: 2_400_000, compareAtMinor: 3_000_000, options: { size: '40' }, quantity: 15 },
      { sku: 'SHO-CNV-42', name: 'EU 42', priceMinor: 2_400_000, options: { size: '42' }, quantity: 11 },
    ],
  },
  {
    name: 'Noise Cancelling Headset',
    slug: 'noise-cancelling-headset',
    description: 'Draft listing, not yet published',
    brand: 'Acme',
    categorySlug: 'audio',
    isActive: false,
    variants: [
      { sku: 'HPH-NCH-BLK', name: 'Black', priceMinor: 12_000_000, options: { color: 'Black' }, quantity: 0 },
    ],
  },
];

async function main() {
  console.log('Seeding...');

  const categoryIds = new Map<string, string>();

  // Parents first, so children can resolve parentId.
  for (const c of [...categories].sort((a, b) =>
    a.parentSlug === null ? -1 : b.parentSlug === null ? 1 : 0,
  )) {
    const category = await prisma.category.upsert({
      where: { slug: c.slug },
      update: {},
      create: {
        name: c.name,
        slug: c.slug,
        position: c.position,
        isActive: true,
        parentId: c.parentSlug ? categoryIds.get(c.parentSlug) : null,
      },
    });
    categoryIds.set(c.slug, category.id);
  }

  console.log(`  ${categoryIds.size} categories`);

  let created = 0;

  for (const p of products) {
    const existing = await prisma.product.findUnique({
      where: { slug: p.slug },
      select: { id: true },
    });
    if (existing) continue;

    const categoryId = categoryIds.get(p.categorySlug);
    if (!categoryId) throw new Error(`Unknown category ${p.categorySlug}`);

    await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          name: p.name,
          slug: p.slug,
          description: p.description,
          brand: p.brand,
          categoryId,
          isActive: p.isActive,
        },
      });

      for (const v of p.variants) {
        const variant = await tx.productVariant.create({
          data: {
            productId: product.id,
            sku: v.sku,
            name: v.name,
            priceMinor: v.priceMinor,
            compareAtMinor: v.compareAtMinor,
            options: v.options,
          },
        });

        // available must equal quantity - reserved (DB check constraint).
        await tx.inventory.create({
          data: {
            variantId: variant.id,
            quantity: v.quantity,
            reserved: 0,
            available: v.quantity,
          },
        });
      }

      // Mirrors CatalogAdminService.recomputeMinPrice(). If that definition
      // changes, change this too, or the reconciler will "repair" every
      // seeded product on its next run.
      const min = await tx.productVariant.aggregate({
        where: { productId: product.id, isActive: true },
        _min: { priceMinor: true },
      });
      await tx.product.update({
        where: { id: product.id },
        data: { minPriceMinor: min._min.priceMinor ?? null },
      });
    });

    created += 1;
  }

  console.log(`  ${created} products created (${products.length - created} already existed)`);
  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
