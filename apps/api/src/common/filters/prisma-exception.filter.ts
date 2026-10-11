import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

// Translates Prisma's database errors into proper HTTP responses. Without
// this, a unique-constraint race (two admins creating the same slug at
// once) surfaces as a 500 even though the pre-checks passed.
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(error: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    switch (error.code) {
      case 'P2002': {
        // meta.target is an array on most Postgres drivers but a plain
        // string on some versions — handle both.
        const rawTarget = error.meta?.target as string[] | string | undefined;
        const target = Array.isArray(rawTarget)
          ? rawTarget.join(', ')
          : rawTarget;

        return response.status(HttpStatus.CONFLICT).json({
          statusCode: HttpStatus.CONFLICT,
          error: 'Conflict',
          message: target
            ? `A record with this ${target} already exists`
            : 'A record with these values already exists',
        });
      }

      case 'P2003':
        return response.status(HttpStatus.BAD_REQUEST).json({
          statusCode: HttpStatus.BAD_REQUEST,
          error: 'Bad Request',
          message: 'Referenced record does not exist',
        });

      case 'P2025':
        return response.status(HttpStatus.NOT_FOUND).json({
          statusCode: HttpStatus.NOT_FOUND,
          error: 'Not Found',
          message: 'Record not found',
        });

      default:
        // Includes check-constraint violations, which indicate a bug: the
        // service should have rejected the input before this point.
        this.logger.error(
          `Unhandled Prisma error ${error.code}: ${error.message}`,
        );
        return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'Internal Server Error',
          message: 'An unexpected database error occurred',
        });
    }
  }
}
