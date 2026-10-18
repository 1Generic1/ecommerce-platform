import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { OptionalNotNull } from '../../../common/decorators/optional-not-null.decorator';

// Partial-update contract. Every field falls into exactly one group, and
// adding a field means choosing which:
//
//   OptionalNotNull  -> NOT NULL column: omit to leave alone, null is a 400
//   IsOptional       -> nullable column: omit to leave alone, null clears it
//
// These are written out rather than derived with PartialType, because
// PartialType applies @IsOptional() to everything — and @IsOptional() skips
// validation for null as well as undefined. A null on a NOT NULL column then
// passes the DTO and dies in Prisma as a PrismaClientValidationError, which
// PrismaExceptionFilter does not catch, so the caller sees a bare 500.
//
// isActive is absent on purpose: publishing goes through setProductActive(),
// which refuses to publish a product with no active variants and writes an
// audit row. Allowing isActive here would route around both.
// variants are managed through their own endpoints.
export class UpdateProductDto {
  // Nullable columns — null clears them.
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  brand?: string | null;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown> | null;

  // NOT NULL columns — null is rejected.
  @OptionalNotNull()
  @IsString()
  @MaxLength(200)
  name?: string;

  @OptionalNotNull()
  @IsString()
  @MaxLength(200)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase words separated by hyphens',
  })
  slug?: string;

  @OptionalNotNull()
  @IsUUID()
  categoryId?: string;
}

// NOTE: do not add productId here. updateVariant recomputes the min price
// for the variant's existing product only; moving a variant between products
// would leave the old product's minPriceMinor stale. Moving needs its own
// endpoint that recomputes both.
//
// compareAtMinor relies on the contract above: updateVariant uses it when
// validating the merged pair (null clears the discount, absent leaves it
// alone), and Prisma uses it to decide whether to write the column at all.
//
// quantity is absent: stock goes through the dedicated stock endpoint.
// isActive is absent: activation goes through setVariantActive(), which
// recomputes the min price and unpublishes a product left with nothing.
export class UpdateVariantDto {
  // Nullable columns — null clears them.
  @IsOptional()
  @IsInt()
  @Min(0)
  compareAtMinor?: number | null;

  @IsOptional()
  @IsObject()
  options?: Record<string, unknown> | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  weightGrams?: number | null;

  // NOT NULL columns — null is rejected.
  @OptionalNotNull()
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9._-]+$/, {
    message: 'sku may contain only letters, numbers, dot, underscore, hyphen',
  })
  sku?: string;

  @OptionalNotNull()
  @IsString()
  @MaxLength(120)
  name?: string;

  // Kobo. 250000 = NGN 2,500.00
  @OptionalNotNull()
  @IsInt()
  @Min(0)
  priceMinor?: number;
}
