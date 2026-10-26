import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { QueryFailedError } from 'typeorm';

export interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
  /** Structured detail from deliberate HTTP exceptions, e.g. which dependency a health check found down. */
  details?: Record<string, unknown>;
}

/** Postgres error codes that are the client's fault, not ours. */
const PG_CLIENT_ERRORS: Record<string, { status: HttpStatus; message: string }> = {
  '23505': { status: HttpStatus.CONFLICT, message: 'Resource already exists' },
  '23503': {
    status: HttpStatus.CONFLICT,
    message: 'Referenced resource does not exist or is still in use',
  },
  '22P02': { status: HttpStatus.BAD_REQUEST, message: 'Invalid identifier format' },
};

/**
 * Every error leaves the API in the same JSON shape. Unexpected errors are logged
 * with their stack but never leak internals (SQL, stack traces) to the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    // WebSocket and other non-HTTP contexts handle their own errors.
    if (host.getType() !== 'http') throw exception;

    const { httpAdapter } = this.adapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<unknown>();
    const { status, message, details } = this.resolve(exception);

    const body: ErrorResponseBody = {
      statusCode: status,
      error: HttpStatus[status] ?? 'ERROR',
      message,
      path: String(httpAdapter.getRequestUrl(request)),
      timestamp: new Date().toISOString(),
      ...(details && { details }),
    };

    // Deliberate HttpExceptions (e.g. an unhealthy readiness probe) are expected; only log real failures.
    if (status >= 500 && !(exception instanceof HttpException)) {
      this.logger.error(
        `${httpAdapter.getRequestMethod(request)} ${body.path} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    httpAdapter.reply(ctx.getResponse(), body, status);
  }

  private resolve(exception: unknown): {
    status: number;
    message: string | string[];
    details?: Record<string, unknown>;
  } {
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      if (typeof res === 'object' && res !== null && 'message' in res) {
        // Extra fields (e.g. retryAfterSeconds on a 429) travel as details.
        const {
          message,
          statusCode: _s,
          error: _e,
          ...extra
        } = res as {
          message: string | string[];
        } & Record<string, unknown>;
        return {
          status: exception.getStatus(),
          message,
          ...(Object.keys(extra).length > 0 && { details: extra }),
        };
      }
      const details =
        typeof res === 'object' && res !== null ? (res as Record<string, unknown>) : undefined;
      return { status: exception.getStatus(), message: exception.message, details };
    }
    if (exception instanceof QueryFailedError) {
      const code = (exception.driverError as { code?: string } | undefined)?.code;
      const known = code ? PG_CLIENT_ERRORS[code] : undefined;
      if (known) return { status: known.status, message: known.message };
    }
    return { status: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Internal server error' };
  }
}
