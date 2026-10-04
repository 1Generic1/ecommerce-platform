import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// Deliberately untyped at this layer: common/ must not depend on any
// module. The call site supplies the type, e.g.
//   @CurrentUser() user: AuthUser
//   @CurrentUser('id') userId: string
export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ user?: Record<string, unknown> }>();
    return data ? request.user?.[data] : request.user;
  },
);