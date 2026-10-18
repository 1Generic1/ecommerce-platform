import { applyDecorators } from '@nestjs/common';
import { IsDefined, ValidateIf } from 'class-validator';

// Use INSTEAD OF @IsOptional() on a field that may be omitted but must
// never be null — i.e. one backed by a NOT NULL column.
//
// @IsOptional() skips validation for undefined AND null, so `{"line1": null}`
// passes the DTO, reaches Prisma, and fails as a PrismaClientValidationError.
// That is not a PrismaClientKnownRequestError, so PrismaExceptionFilter does
// not catch it and the caller gets an unmapped 500.
//
// ValidateIf skips validation only for undefined. IsDefined then rejects null
// with a message that names the real problem: without it, null falls through
// to the field's own validators and gets reported as a format or range error
// ("slug must be lowercase words…"), which misdescribes what went wrong.
//
// Nullable columns keep @IsOptional(), because null legitimately means
// "clear it" there — see the partial-update contract in the catalog DTOs.
export const OptionalNotNull = () =>
  applyDecorators(
    ValidateIf((_object, value) => value !== undefined),
    IsDefined({ message: '$property cannot be null; omit it to leave it unchanged' }),
  );
