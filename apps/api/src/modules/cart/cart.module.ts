import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';

// CatalogModule for the shared "is this variant publicly listed" check.
// No cycle: CatalogModule does not import CartModule.
@Module({
  imports: [CatalogModule],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}