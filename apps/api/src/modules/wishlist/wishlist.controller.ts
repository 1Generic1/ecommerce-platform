import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  AddWishlistItemDto,
  MoveToCartDto,
  WishlistQueryDto,
} from './dto/wishlist.dto';
import { WishlistService } from './wishlist.service';

// Strict guard, unlike the cart: there is no guest wishlist.
@Controller('wishlist')
@UseGuards(JwtAuthGuard)
export class WishlistController {
  constructor(private readonly wishlist: WishlistService) {}

  @Get()
  list(
    @CurrentUser('id') userId: string,
    @Query() query: WishlistQueryDto,
  ) {
    return this.wishlist.list(userId, query);
  }

  @Post('items')
  add(@CurrentUser('id') userId: string, @Body() dto: AddWishlistItemDto) {
    return this.wishlist.add(userId, dto.variantId);
  }

  @Delete('items/:variantId')
  remove(
    @CurrentUser('id') userId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
  ) {
    return this.wishlist.remove(userId, variantId);
  }

  @Post('items/:variantId/move-to-cart')
  @HttpCode(HttpStatus.OK)
  moveToCart(
    @CurrentUser('id') userId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: MoveToCartDto,
  ) {
    return this.wishlist.moveToCart(userId, variantId, dto.quantity ?? 1);
  }
}
