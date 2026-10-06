import { loadDotenv } from './config/dotenv';

loadDotenv();

import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { AppConfig } from './config/app-config';
import { buildOpenApiDocument } from './swagger';

async function bootstrap() {
  // Phase 5c (New-3 residual): Nest's default body parsers (json + urlencoded) are NOT registered; configureApp installs
  // the single JSON parser (with raw-body capture for the webhook) - nothing in this API consumes form bodies.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, bodyParser: false });
  configureApp(app);

  const config = app.get(AppConfig);
  // Security audit #16: the interactive docs (full admin route map) are never served in production.
  const swagger = config.env.SWAGGER_ENABLED && !config.isProduction;
  if (swagger) {
    const document = buildOpenApiDocument(app);
    SwaggerModule.setup('api/docs', app, document, {
      jsonDocumentUrl: 'api/docs-json',
      swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
      customSiteTitle: 'Rewarded Ads Platform API',
    });
  }

  await app.listen(config.env.PORT, '0.0.0.0');
  const logger = app.get(Logger);
  logger.log(`API listening on ${config.env.API_PUBLIC_URL}${swagger ? ` (docs: ${config.env.API_PUBLIC_URL}/api/docs)` : ' (docs disabled)'}`);
  logger.log(
    `Mocks -> sms:${config.mocks.sms} payouts:${config.mocks.payouts} paymentGateway:${config.mocks.paymentGateway} push:${config.mocks.push}`,
  );
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
