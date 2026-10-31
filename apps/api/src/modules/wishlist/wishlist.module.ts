import { Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module';
import { CatalogModule } from '../catalog/catalog.module';
import { WishlistController } from './wishlist.controller';
import { WishlistService } from './wishlist.service';

@Module({
  imports: [CatalogModule, CartModule],
  controllers: [WishlistController],
  providers: [WishlistService],
})
export class WishlistModule {}
