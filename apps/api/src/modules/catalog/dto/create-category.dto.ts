import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { OptionalNotNull } from '../../../common/decorators/optional-not-null.decorator';

export class CreateCategoryDto {
  @IsString()
  @MaxLength(120)
  name: string;

  @IsString()
  @MaxLength(120)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase words separated by hyphens',
  })
  slug: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsUrl()
  imageUrl?: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// See the partial-update contract note in update-product.dto.ts.
export class UpdateCategoryDto {
  // Nullable columns — null clears them.
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @IsUrl()
  imageUrl?: string | null;

  // Nullable, and null is meaningful here: it moves the category to the top
  // level. updateCategory() checks for a real id before validating a parent,
  // so null skips the cycle and existence checks by design.
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  // NOT NULL columns — null is rejected.
  @OptionalNotNull()
  @IsString()
  @MaxLength(120)
  name?: string;

  @OptionalNotNull()
  @IsString()
  @MaxLength(120)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase words separated by hyphens',
  })
  slug?: string;

  @OptionalNotNull()
  @IsInt()
  @Min(0)
  position?: number;

  @OptionalNotNull()
  @IsBoolean()
  isActive?: boolean;
}
