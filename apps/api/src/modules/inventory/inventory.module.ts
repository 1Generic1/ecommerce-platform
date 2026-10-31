import { Global, Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';

// Global: cart, orders and the reservation-expiry job all need it, and
// routing every stock write through one service is the point.
@Global()
@Module({
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
