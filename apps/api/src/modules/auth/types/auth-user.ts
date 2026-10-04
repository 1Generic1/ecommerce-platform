import { Prisma } from '@prisma/client';

// Single source of truth for what an authenticated request carries.
// The strategy selects exactly these fields, and AuthUser is derived
// from the same object, so the two can never drift apart.
export const authUserSelect = {
  id: true,
  email: true,
  role: true,
  isActive: true,
  firstName: true,
  lastName: true,
} satisfies Prisma.UserSelect;

export type AuthUser = Prisma.UserGetPayload<{
  select: typeof authUserSelect;
}>;
