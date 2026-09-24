import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@rap/shared';

/**
 * Application exception carrying a stable machine-readable `code` (from @rap/shared ErrorCode).
 * The global HttpExceptionFilter serialises it into { statusCode, code, message, details? }.
 */
export class AppException extends HttpException {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    details?: unknown,
  ) {
    super({ statusCode: status, code, message, details }, status);
    this.code = code;
    this.details = details;
  }

  static notFound(message = 'Resource not found', details?: unknown) {
    return new AppException(ErrorCode.NOT_FOUND, message, HttpStatus.NOT_FOUND, details);
  }

  static forbidden(code: ErrorCode = ErrorCode.FORBIDDEN, message = 'Forbidden', details?: unknown) {
    return new AppException(code, message, HttpStatus.FORBIDDEN, details);
  }

  static unauthorized(code: ErrorCode = ErrorCode.UNAUTHORIZED, message = 'Unauthorized', details?: unknown) {
    return new AppException(code, message, HttpStatus.UNAUTHORIZED, details);
  }

  static conflict(code: ErrorCode = ErrorCode.CONFLICT, message = 'Conflict', details?: unknown) {
    return new AppException(code, message, HttpStatus.CONFLICT, details);
  }

  static badRequest(code: ErrorCode, message: string, details?: unknown) {
    return new AppException(code, message, HttpStatus.BAD_REQUEST, details);
  }

  static unprocessable(code: ErrorCode, message: string, details?: unknown) {
    return new AppException(code, message, HttpStatus.UNPROCESSABLE_ENTITY, details);
  }

  static rateLimited(
    code: ErrorCode = ErrorCode.RATE_LIMITED,
    message = 'Too many requests',
    details?: unknown,
  ) {
    return new AppException(code, message, HttpStatus.TOO_MANY_REQUESTS, details);
  }
}
