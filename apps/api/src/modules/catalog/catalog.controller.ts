import { Controller, Get, Param, Query } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { ProductQueryDto } from './dto/product-query.dto';

@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('products')
  findProducts(@Query() query: ProductQueryDto) {
    return this.catalog.findProducts(query);
  }

  @Get('products/:slug')
  findProduct(@Param('slug') slug: string) {
    return this.catalog.findProductBySlug(slug);
  }

  @Get('categories')
  findCategories() {
    return this.catalog.findCategories();
  }

  @Get('categories/:slug')
  findCategory(@Param('slug') slug: string) {
    return this.catalog.findCategoryBySlug(slug);
  }
}
