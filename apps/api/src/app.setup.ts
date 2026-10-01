import { HttpStatus, ValidationPipe } from '@nestjs/common';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { ErrorCode } from '@rap/shared';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppException } from './common/errors/app.exception';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { SerializeInterceptor } from './common/interceptors/serialize.interceptor';
import { AppConfig } from './config/app-config';

export const GLOBAL_PREFIX = 'api/v1';

/**
 * Applies the middleware/pipes/filters shared by the real server, the OpenAPI exporter and e2e tests.
 * Does NOT call listen().
 */
export function configureApp(app: NestExpressApplication): NestExpressApplication {
  const config = app.get(AppConfig);

  app.useLogger(app.get(Logger));
  // Security audit #3: only the configured number of proxy hops may set the client IP (0 = none, the default for
  // the direct-exposure docker compose setup). Behind one load balancer / reverse proxy set TRUST_PROXY_HOPS=1.
  app.set('trust proxy', config.env.TRUST_PROXY_HOPS);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  // Keep the raw body for webhook signature verification.
  app.use(
    json({
      limit: '1mb',
      verify: (req, _res, buf) => ((req as { rawBody?: Buffer }).rawBody = Buffer.from(buf)),
    }),
  );
  app.use(urlencoded({ extended: true, limit: '1mb' }));
  app.enableCors({
    origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Device-Fingerprint', 'X-Device-Id', 'Idempotency-Key'],
    exposedHeaders: ['Idempotent-Replayed'],
  });
  app.setGlobalPrefix(GLOBAL_PREFIX, { exclude: ['health', 'health/ready'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: false,
      transformOptions: { enableImplicitConversion: false },
      exceptionFactory: (errors) =>
        new AppException(
          ErrorCode.VALIDATION_ERROR,
          'Validation failed',
          HttpStatus.BAD_REQUEST,
          flattenValidationErrors(errors),
        ),
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new SerializeInterceptor());
  app.enableShutdownHooks();
  return app;
}

interface ValidationErrorLike {
  property: string;
  constraints?: Record<string, string>;
  children?: ValidationErrorLike[];
}

export function flattenValidationErrors(
  errors: ValidationErrorLike[],
  parent = '',
): Array<{ field: string; messages: string[] }> {
  const out: Array<{ field: string; messages: string[] }> = [];
  for (const e of errors) {
    const field = parent ? `${parent}.${e.property}` : e.property;
    if (e.constraints) out.push({ field, messages: Object.values(e.constraints) });
    if (e.children?.length) out.push(...flattenValidationErrors(e.children, field));
  }
  return out;
}
