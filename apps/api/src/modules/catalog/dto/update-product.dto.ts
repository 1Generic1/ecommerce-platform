import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateProductDto, CreateVariantDto } from './create-product.dto';

// Partial-update contract, uniform across every DTO in this folder:
//   undefined -> field absent, leave the existing value alone
//   null      -> explicitly clear it
//   value     -> set it
// Never collapse undefined and null with `?? null`, a default, or a
// @Transform. The failure is silent: an absent field would start clearing
// values on every unrelated update.

// Variants are managed through their own endpoints, and isActive is
// omitted on purpose: publishing goes through setProductActive(), which
// refuses to publish a product with no active variants and writes an
// audit row. Allowing isActive here would route around both.
export class UpdateProductDto extends PartialType(
  OmitType(CreateProductDto, ['variants', 'isActive'] as const),
) {}

// NOTE: do not add productId here. updateVariant recomputes the min price
// for the variant's existing product only; moving a variant between products
// would leave the old product's minPriceMinor stale. Moving needs its own
// endpoint that recomputes both.
//
// compareAtMinor depends on the contract above: updateVariant uses it when
// validating the merged pair, and Prisma uses it to decide whether to write
// the column at all.
export class UpdateVariantDto extends PartialType(
  OmitType(CreateVariantDto, ['quantity'] as const),
) {}
