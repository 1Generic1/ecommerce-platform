import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAddressDto, UpdateAddressDto } from './dto/address.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

// Never select passwordHash into a response shape.
const profileSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  role: true,
  emailVerifiedAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  // Caps per user: no legitimate customer needs more, and it bounds the
  // damage from a client bug looping on the create endpoint.
  private static readonly MAX_ADDRESSES = 20;

  constructor(private readonly prisma: PrismaService) {}

  // ---------- profile ----------

  async getProfile(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: profileSelect,
    });
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data: dto,
      select: profileSelect,
    });
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true },
    });

    const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!valid) {
      // 401 rather than 400: the credential was wrong, not the request shape.
      throw new UnauthorizedException('Current password is incorrect');
    }

    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(
        'New password must be different from the current one',
      );
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 12);

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });

    // TODO: once refresh tokens exist, revoke the user's other sessions
    // here — a password change should log out whoever else holds a token.
    // Until then, an existing access token stays valid until it expires.
    return { success: true };
  }

  // ---------- addresses ----------

  async listAddresses(userId: string) {
    return this.prisma.address.findMany({
      where: { userId },
      // Default first, then newest. id breaks ties so ordering is stable
      // across requests.
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
    });
  }

  async createAddress(userId: string, dto: CreateAddressDto) {
    return this.prisma.$transaction(async (tx) => {
      const [total, defaults] = await Promise.all([
        tx.address.count({ where: { userId } }),
        tx.address.count({ where: { userId, isDefault: true } }),
      ]);

      if (total >= UsersService.MAX_ADDRESSES) {
        throw new BadRequestException(
          `You can save at most ${UsersService.MAX_ADDRESSES} addresses`,
        );
      }

      // Checking for a default rather than for any address covers both the
      // first-address case and self-heals a user who somehow has addresses
      // but no default — a state every path here prevents, but seed data,
      // a manual fix or a bulk import could create. Without a default,
      // checkout has nothing to preselect.
      const isDefault = defaults === 0 ? true : (dto.isDefault ?? false);

      if (isDefault && defaults > 0) {
        await tx.address.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.address.create({ data: { ...dto, userId, isDefault } });
    });
  }

  async updateAddress(userId: string, id: string, dto: UpdateAddressDto) {
    await this.assertOwnsAddress(userId, id);

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault === true) {
        await tx.address.updateMany({
          where: { userId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }

      // Clearing the default on the only default would leave the user with
      // none. Refuse; the way to change it is to promote another address.
      //
      // Re-read inside the transaction rather than trusting the guard's
      // value: another request could have changed isDefault in between.
      // The isDefault === true branch above needs no such read, because
      // setting a default does not depend on the current state.
      if (dto.isDefault === false) {
        const current = await tx.address.findUniqueOrThrow({
          where: { id },
          select: { isDefault: true },
        });
        if (current.isDefault) {
          throw new BadRequestException(
            'Set another address as default instead of clearing this one',
          );
        }
      }

      return tx.address.update({ where: { id }, data: dto });
    });
  }

  async setDefaultAddress(userId: string, id: string) {
    await this.assertOwnsAddress(userId, id);

    return this.prisma.$transaction(async (tx) => {
      await tx.address.updateMany({
        where: { userId, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });

      return tx.address.update({ where: { id }, data: { isDefault: true } });
    });
  }

  // Hard delete is safe: orders snapshot the shipping address as JSON, so
  // removing an address never affects order history. The trade-off is that
  // a "reorder to this address" flow cannot offer a deleted address.
  async deleteAddress(userId: string, id: string) {
    const address = await this.assertOwnsAddress(userId, id);

    return this.prisma.$transaction(async (tx) => {
      await tx.address.delete({ where: { id } });

      // Promote the next-newest address so the user is never left with
      // addresses but no default.
      if (address.isDefault) {
        const next = await tx.address.findFirst({
          where: { userId },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          select: { id: true },
        });
        if (next) {
          await tx.address.update({
            where: { id: next.id },
            data: { isDefault: true },
          });
        }
      }

      return { success: true };
    });
  }

  // 404 rather than 403 for someone else's address: a 403 would confirm the
  // id exists, which leaks the existence of other users' records. Apply the
  // same pattern to any future per-user resource (orders, reviews).
  private async assertOwnsAddress(userId: string, id: string) {
    const address = await this.prisma.address.findUnique({
      where: { id },
      select: { id: true, userId: true, isDefault: true },
    });

    if (!address || address.userId !== userId) {
      throw new NotFoundException('Address not found');
    }

    return address;
  }
}
