import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

type PrismaError =
  | Prisma.PrismaClientKnownRequestError
  | Prisma.PrismaClientValidationError
  | Prisma.PrismaClientInitializationError
  | Prisma.PrismaClientUnknownRequestError
  | Prisma.PrismaClientRustPanicError;

// Translates Prisma's errors into proper HTTP responses. Without this, a
// unique-constraint race (two admins creating the same slug at once) and any
// client-side Prisma rejection both surface as bare 500s with no logged
// context, even though the pre-checks passed.
//
// Prisma error messages can name tables, columns and schema internals, so
// nothing below returns error.message to the caller. The detail is logged;
// the response says only as much as the client needs.
@Catch(
  Prisma.PrismaClientKnownRequestError,
  Prisma.PrismaClientValidationError,
  Prisma.PrismaClientInitializationError,
  Prisma.PrismaClientUnknownRequestError,
  Prisma.PrismaClientRustPanicError,
)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(error: PrismaError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return this.handleKnown(error, response);
    }

    // Rejected before reaching the database: a bad type, an unknown field,
    // an invalid enum value. The client sent something Prisma cannot build a
    // query from, so it is a 400 — but the message is schema detail.
    if (error instanceof Prisma.PrismaClientValidationError) {
      this.logger.error(`Prisma validation error: ${error.message}`);
      return this.send(response, HttpStatus.BAD_REQUEST, 'Bad Request', 'Invalid request data');
    }

    // Could not connect or authenticate against the database. Not the
    // client's fault and likely transient, so 503 rather than 500 — it tells
    // a caller the request is worth retrying.
    if (error instanceof Prisma.PrismaClientInitializationError) {
      this.logger.error(
        `Prisma failed to initialise: ${error.message}`,
        error.stack,
      );
      return this.send(
        response,
        HttpStatus.SERVICE_UNAVAILABLE,
        'Service Unavailable',
        'The service is temporarily unavailable',
      );
    }

    // Everything left is a Prisma-internal failure. Log loudly with the
    // stack: these are not recoverable by the caller and not diagnosable
    // without it.
    this.logger.error(
      `Prisma internal error (${error.constructor.name}): ${error.message}`,
      error.stack,
    );
    return this.send(
      response,
      HttpStatus.INTERNAL_SERVER_ERROR,
      'Internal Server Error',
      'An unexpected database error occurred',
    );
  }

  private handleKnown(
    error: Prisma.PrismaClientKnownRequestError,
    response: Response,
  ) {
    switch (error.code) {
      // Unique constraint violated
      case 'P2002': {
        // meta.target is an array on most Postgres drivers but a plain
        // string on some versions — handle both.
        const rawTarget = error.meta?.target as string[] | string | undefined;
        const target = Array.isArray(rawTarget)
          ? rawTarget.join(', ')
          : rawTarget;

        return this.send(
          response,
          HttpStatus.CONFLICT,
          'Conflict',
          target
            ? `A record with this ${target} already exists`
            : 'A record with these values already exists',
        );
      }

      // Foreign key constraint failed
      case 'P2003':
        return this.send(
          response,
          HttpStatus.BAD_REQUEST,
          'Bad Request',
          'Referenced record does not exist',
        );

      // Record not found for update/delete
      case 'P2025':
        return this.send(
          response,
          HttpStatus.NOT_FOUND,
          'Not Found',
          'Record not found',
        );

      default:
        // Includes check-constraint violations, which indicate a bug: the
        // service should have rejected the input before this point. 500 is
        // correct — a 400 would blame the caller for our error.
        this.logger.error(
          `Unhandled Prisma error ${error.code}: ${error.message}`,
        );
        return this.send(
          response,
          HttpStatus.INTERNAL_SERVER_ERROR,
          'Internal Server Error',
          'An unexpected database error occurred',
        );
    }
  }

  private send(
    response: Response,
    statusCode: number,
    error: string,
    message: string,
  ) {
    return response.status(statusCode).json({ statusCode, error, message });
  }
}
