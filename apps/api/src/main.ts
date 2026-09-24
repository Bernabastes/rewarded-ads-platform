import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { AppConfig } from './config/app-config';
import { buildOpenApiDocument } from './swagger';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  configureApp(app);

  const document = buildOpenApiDocument(app);
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs-json',
    swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
    customSiteTitle: 'Rewarded Ads Platform API',
  });

  const config = app.get(AppConfig);
  await app.listen(config.env.PORT, '0.0.0.0');
  const logger = app.get(Logger);
  logger.log(`API listening on ${config.env.API_PUBLIC_URL} (docs: ${config.env.API_PUBLIC_URL}/api/docs)`);
  logger.log(
    `Mocks -> sms:${config.mocks.sms} payouts:${config.mocks.payouts} paymentGateway:${config.mocks.paymentGateway} push:${config.mocks.push}`,
  );
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
