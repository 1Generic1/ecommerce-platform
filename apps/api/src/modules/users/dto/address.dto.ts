import {
  IsBoolean,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { OptionalNotNull } from '../../../common/decorators/optional-not-null.decorator';

export class CreateAddressDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  label?: string;

  @IsString()
  @MaxLength(100)
  fullName: string;

  @IsPhoneNumber('NG')
  phone: string;

  @IsString()
  @MaxLength(200)
  line1: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  line2?: string;

  @IsString()
  @MaxLength(100)
  city: string;

  @IsString()
  @MaxLength(100)
  state: string;

  // NOT NULL with a default of "NG", so omitting it is fine on create —
  // Postgres fills it in. ISO 3166-1 alpha-2.
  @IsOptional()
  @IsString()
  @Length(2, 2)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  // NOT NULL with a default of false. createAddress() overrides this when
  // the user has no default address yet.
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

// Written out rather than built with PartialType, because the two groups
// below need different null handling and PartialType cannot express that:
//
//   OptionalNotNull  -> NOT NULL column: omit to leave alone, null is a 400
//   IsOptional       -> nullable column: omit to leave alone, null clears it
//
// Note that a NOT NULL column with a default (country, isDefault) is
// optional on create and non-nullable on update. Those are not in tension:
// on create, omitting means "use the default"; on update there is no default
// to fall back to, only a current value, which undefined already preserves.
//
// Adding a field here means deciding which group it belongs to.
export class UpdateAddressDto {
  // Nullable columns — null clears them.
  @IsOptional()
  @IsString()
  @MaxLength(40)
  label?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  line2?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string | null;

  // NOT NULL columns — null is rejected.
  @OptionalNotNull()
  @IsString()
  @MaxLength(100)
  fullName?: string;

  @OptionalNotNull()
  @IsPhoneNumber('NG')
  phone?: string;

  @OptionalNotNull()
  @IsString()
  @MaxLength(200)
  line1?: string;

  @OptionalNotNull()
  @IsString()
  @MaxLength(100)
  city?: string;

  @OptionalNotNull()
  @IsString()
  @MaxLength(100)
  state?: string;

  @OptionalNotNull()
  @IsString()
  @Length(2, 2)
  country?: string;

  @OptionalNotNull()
  @IsBoolean()
  isDefault?: boolean;
}
