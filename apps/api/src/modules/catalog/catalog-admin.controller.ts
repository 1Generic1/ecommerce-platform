import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthUser } from '../auth/types/auth-user';
import { CatalogAdminService } from './catalog-admin.service';
import {
  CreateCategoryDto,
  UpdateCategoryDto,
} from './dto/create-category.dto';
import { CreateProductDto, CreateVariantDto } from './dto/create-product.dto';
import { UpdateProductDto, UpdateVariantDto } from './dto/update-product.dto';
import { UpdateStockDto } from './dto/update-stock.dto';
import { Throttle } from '@nestjs/throttler';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.STAFF)
export class CatalogAdminController {
  constructor(private readonly admin: CatalogAdminService) {}

  @Post('products')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  createProduct(@Body() dto: CreateProductDto) {
    return this.admin.createProduct(dto);
  }

  @Patch('products/:id')
  updateProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.admin.updateProduct(id, dto);
  }

  @Patch('products/:id/publish')
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.admin.setProductActive(id, true, user);
  }

  @Patch('products/:id/unpublish')
  unpublish(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.admin.setProductActive(id, false, user);
  }

  @Post('products/:id/variants')
  addVariant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateVariantDto,
  ) {
    return this.admin.addVariant(id, dto);
  }

  @Patch('variants/:id')
  updateVariant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVariantDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.admin.updateVariant(id, dto, user);
  }

  @Patch('variants/:id/activate')
  activateVariant(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.admin.setVariantActive(id, true, user);
  }

  @Patch('variants/:id/deactivate')
  deactivateVariant(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.admin.setVariantActive(id, false, user);
  }

  @Patch('variants/:id/stock')
  updateStock(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStockDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.admin.updateStock(id, dto, user);
  }

  @Post('categories')
  createCategory(
    @Body() dto: CreateCategoryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.admin.createCategory(dto, user);
  }

  @Patch('categories/:id')
  updateCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.admin.updateCategory(id, dto, user);
  }

  @Post('catalog/reconcile-prices')
  @Roles(Role.ADMIN)
  // A full catalogue scan. Admin-only and rarely needed by hand, since the
  // real caller will be a scheduled job — one per five minutes is generous.
  @Throttle({ default: { limit: 1, ttl: 300000 } })
  reconcilePrices() {
    return this.admin.reconcileMinPrices();
  }
}
