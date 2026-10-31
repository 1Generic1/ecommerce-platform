import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CartSession } from '../../common/decorators/cart-session.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { CartService } from './cart.service';
import { AddCartItemDto, UpdateCartItemDto } from './dto/cart-item.dto';

// Every route serves guests and signed-in users from the same path, which
// is why the guard is optional. A signed-in caller's user cart always wins
// over any session header they happen to still be sending.
@Controller('cart')
@UseGuards(OptionalJwtAuthGuard)
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  getCart(
    @CurrentUser('id') userId: string | undefined,
    @CartSession() sessionId: string | undefined,
  ) {
    return this.cart.getCart({ userId, sessionId });
  }

  @Post('items')
  addItem(
    @CurrentUser('id') userId: string | undefined,
    @CartSession() sessionId: string | undefined,
    @Body() dto: AddCartItemDto,
  ) {
    return this.cart.addItem({ userId, sessionId }, dto);
  }

  @Patch('items/:id')
  updateItem(
    @CurrentUser('id') userId: string | undefined,
    @CartSession() sessionId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cart.updateItem({ userId, sessionId }, id, dto);
  }

  @Delete('items/:id')
  removeItem(
    @CurrentUser('id') userId: string | undefined,
    @CartSession() sessionId: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.cart.removeItem({ userId, sessionId }, id);
  }

  @Delete()
  clear(
    @CurrentUser('id') userId: string | undefined,
    @CartSession() sessionId: string | undefined,
  ) {
    return this.cart.clear({ userId, sessionId });
  }

  // Requires a signed-in caller. Checked in the service rather than with a
  // second guard, so the optional guard above is not run twice.
  @Post('merge')
  @HttpCode(HttpStatus.OK)
  merge(
    @CurrentUser('id') userId: string | undefined,
    @CartSession() sessionId: string | undefined,
  ) {
    return this.cart.merge(userId, sessionId);
  }
}
