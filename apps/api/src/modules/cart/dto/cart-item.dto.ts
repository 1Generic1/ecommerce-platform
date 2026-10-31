import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

// A per-line ceiling. Nothing about the schema requires it; it exists so a
// typo or a looping client cannot put 10,000 of one item in a cart and make
// every later availability check meaningless.
export const MAX_QUANTITY_PER_LINE = 99;

export class AddCartItemDto {
  @IsUUID()
  variantId: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_QUANTITY_PER_LINE)
  quantity?: number = 1;
}

export class UpdateCartItemDto {
  // Setting a line to zero is a removal, which has its own endpoint. The
  // cart_items_quantity_check constraint would reject it anyway, so this
  // turns a database error into a clear 400.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_QUANTITY_PER_LINE)
  quantity: number;
}
