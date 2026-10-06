/**
 * Exports the OpenAPI document to docs/openapi.json WITHOUT connecting to Postgres/Redis
 * (Prisma and ioredis connect lazily; queues are disabled via QUEUES_ENABLED=false).
 *
 *   pnpm --filter api openapi:export
 */
import { loadDotenv } from './config/dotenv';

loadDotenv();
process.env.QUEUES_ENABLED = 'false';
process.env.RECONCILIATION_ENABLED = 'false';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'warn';

import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { buildOpenApiDocument } from './swagger';

async function main() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn'], bodyParser: false });
  configureApp(app);
  await app.init();
  const document = buildOpenApiDocument(app);
  const target = process.argv[2] ?? path.resolve(__dirname, '..', '..', '..', 'docs', 'openapi.json');
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(document, null, 2) + '\n');
  const pathCount = Object.keys(document.paths).length;
  const opCount = Object.values(document.paths).reduce((n, p) => n + Object.keys(p as object).length, 0);
  console.log(`OpenAPI written to ${target} (${pathCount} paths, ${opCount} operations)`);
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
