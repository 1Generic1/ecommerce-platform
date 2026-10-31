import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class AddWishlistItemDto {
  @IsUUID()
  variantId: string;
}

export class MoveToCartDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  quantity?: number = 1;
}

// A wishlist is legitimately long, so it pages rather than being capped at
// a small number. WishlistService still enforces a generous ceiling.
export class WishlistQueryDto extends PaginationDto {}
