import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Populates request.user when a valid token is present and lets the request
// through when it is not. For routes that serve guests and signed-in users
// from the same path, such as the cart.
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  // A missing token is obviously fine here. An invalid or expired one is
  // also treated as "no user" rather than a 401: a stale token left in a
  // browser should not break the cart, and the client learns its token is
  // dead from the endpoints that genuinely require one.
  handleRequest<TUser>(_err: unknown, user: TUser): TUser | undefined {
    return user ?? undefined;
  }
}
