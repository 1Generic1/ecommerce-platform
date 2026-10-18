import { IsInt, Min } from 'class-validator';
import { OptionalNotNull } from '../../../common/decorators/optional-not-null.decorator';

export class UpdateStockDto {
  // Absolute stock on hand, not a delta. Reserved units are untouched.
  @IsInt()
  @Min(0)
  quantity: number;

  // NOT NULL with a default. @IsOptional() would let null through, and
  // updateStock() forwards anything that is not undefined, so null would
  // reach Prisma. See the contract note in update-product.dto.ts.
  @OptionalNotNull()
  @IsInt()
  @Min(0)
  lowStockAt?: number;
}
