import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateVariantDto {
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9._-]+$/, {
    message: 'sku may contain only letters, numbers, dot, underscore, hyphen',
  })
  sku: string;

  @IsString()
  @MaxLength(120)
  name: string;

  // Kobo. 250000 = NGN 2,500.00
  @IsInt()
  @Min(0)
  priceMinor: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  compareAtMinor?: number;

  @IsOptional()
  @IsObject()
  options?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(0)
  weightGrams?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  quantity?: number = 0;
}

export class CreateProductDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsString()
  @MaxLength(200)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase words separated by hyphens',
  })
  slug: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  brand?: string;

  @IsUUID()
  categoryId: string;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean = false;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateVariantDto)
  variants: CreateVariantDto[];
}
