import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CART_SESSION_HEADER = 'x-cart-session';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Reads the guest cart's session id from the X-Cart-Session header.
//
// A session id is effectively a bearer token for a guest cart, so it is
// always generated server-side and only ever used here to LOOK UP an
// existing cart — never to create one. A client sending an id that matches
// nothing gets a fresh, server-generated cart rather than claiming the id
// it asked for, which is what stops someone guessing their way into
// another guest's cart.
//
// Anything that is not a well-formed UUID is treated as absent, so garbage
// never reaches the query.
export const CartSession = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | string[] | undefined> }>();

    const raw = request.headers[CART_SESSION_HEADER];
    const value = Array.isArray(raw) ? raw[0] : raw;

    return value && UUID_V4.test(value) ? value : undefined;
  },
);
