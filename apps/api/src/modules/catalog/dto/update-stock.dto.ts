import { IsInt, IsOptional, Min } from 'class-validator';

export class UpdateStockDto {
  // Absolute stock on hand, not a delta. Reserved units are untouched.
  @IsInt()
  @Min(0)
  quantity: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  lowStockAt?: number;
}
