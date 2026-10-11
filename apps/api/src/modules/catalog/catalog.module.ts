import { Module } from '@nestjs/common';
import { CatalogAdminController } from './catalog-admin.controller';
import { CatalogAdminService } from './catalog-admin.service';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

@Module({
  controllers: [CatalogController, CatalogAdminController],
  providers: [CatalogService, CatalogAdminService],
  exports: [CatalogService],
})
export class CatalogModule {}
