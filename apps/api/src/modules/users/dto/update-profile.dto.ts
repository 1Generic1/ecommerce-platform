import { IsOptional, IsPhoneNumber, IsString, MaxLength } from 'class-validator';

// Every field here is backed by a nullable column, so @IsOptional() is
// correct throughout: omit to leave alone, null to clear. Contrast
// address.dto.ts, which mixes nullable and NOT NULL columns.
//
// Email is deliberately absent: changing it needs a verification flow,
// which belongs with the notifications module.
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  firstName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  lastName?: string | null;

  @IsOptional()
  @IsPhoneNumber('NG')
  phone?: string | null;
}
