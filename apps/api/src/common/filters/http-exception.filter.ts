import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { type ApiErrorEnvelope, ErrorCode } from '@rap/shared';
import type { Request, Response } from 'express';
import { AppException } from '../errors/app.exception';

/**
 * Converts every error into the stable envelope { statusCode, code, message, details? }.
 * Unknown errors never leak internals (generic message, no details) but are logged.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const envelope = this.toEnvelope(exception);

    if (envelope.statusCode >= 500) {
      this.logger.error(
        {
          err:
            exception instanceof Error ? { message: exception.message, stack: exception.stack } : exception,
        },
        `Unhandled error on ${req.method} ${req.url}`,
      );
    }

    res.status(envelope.statusCode).json(envelope);
  }

  toEnvelope(exception: unknown): ApiErrorEnvelope {
    if (exception instanceof AppException) {
      return {
        statusCode: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        ...(exception.details !== undefined ? { details: exception.details } : {}),
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const bodyObj = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
      const rawMessage = bodyObj.message ?? exception.message;
      const message = Array.isArray(rawMessage) ? 'Validation failed' : String(rawMessage);
      const details = Array.isArray(rawMessage) ? rawMessage : bodyObj.details;
      const code = (bodyObj.code as ErrorCode | undefined) ?? HttpExceptionFilter.codeFromStatus(status);
      return { statusCode: status, code, message, ...(details !== undefined ? { details } : {}) };
    }

    const maybePrisma = exception as { code?: string; meta?: unknown; name?: string };
    if (maybePrisma?.name === 'PrismaClientKnownRequestError') {
      if (maybePrisma.code === 'P2002') {
        return {
          statusCode: 409,
          code: ErrorCode.CONFLICT,
          message: 'Duplicate value',
          details: maybePrisma.meta,
        };
      }
      if (maybePrisma.code === 'P2025') {
        return { statusCode: 404, code: ErrorCode.NOT_FOUND, message: 'Resource not found' };
      }
    }

    return { statusCode: 500, code: ErrorCode.INTERNAL_ERROR, message: 'Internal server error' };
  }

  static codeFromStatus(status: number): ErrorCode {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.VALIDATION_ERROR;
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.UNAUTHORIZED;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ErrorCode.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ErrorCode.CONFLICT;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ErrorCode.RATE_LIMITED;
      case HttpStatus.SERVICE_UNAVAILABLE:
        return ErrorCode.SERVICE_UNAVAILABLE;
      default:
        return status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.VALIDATION_ERROR;
    }
  }
}
