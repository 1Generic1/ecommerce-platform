import { IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  // 72 is bcrypt's limit; anything beyond it is silently truncated, so
  // reject rather than accept a password where the tail does not count.
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword: string;
}
