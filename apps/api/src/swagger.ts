import { type INestApplication } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { API_BASE_PATH } from '@rap/shared';

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Rewarded Ads Platform API')
    .setDescription(
      [
        'REST API for the Rewarded Advertising Platform (Ethiopia).',
        '',
        `All routes are prefixed with \`${API_BASE_PATH}\` (except /health).`,
        'Errors use the envelope `{ statusCode, code, message, details? }` where `code` is a stable value from `@rap/shared` `ErrorCode`.',
        'List endpoints accept `?page&limit` and return `{ data, meta: { page, limit, total } }`.',
        'Timestamps are ISO-8601 UTC; ids are UUIDs; ETB amounts are numbers with 2 decimals; coins are integers.',
      ].join('\n'),
    )
    .setVersion(process.env.APP_VERSION ?? '0.1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .addTag('health')
    .addTag('auth', 'OTP login for users, email/password for advertisers and admins, token rotation')
    .addTag('users', 'Profile, balance, ledger, notifications, ad reports (user tokens)')
    .addTag('ads', 'Feed, watch sessions and server-verified completions (user tokens)')
    .addTag('offers', 'Surveys and app-install offers (user tokens)')
    .addTag('advertisers', 'Advertiser profile and preferences (advertiser tokens)')
    .addTag('campaigns', 'Advertiser campaign management, creatives and analytics (advertiser tokens)')
    .addTag('billing', 'Advertiser wallet, top-ups, payments, invoices')
    .addTag('withdrawals', 'User withdrawal requests and status (user tokens)')
    .addTag('admin', 'Admin dashboard endpoints (admin tokens, role-based)')
    .addTag('fraud', 'Internal fraud flag endpoints (admin tokens)')
    .build();

  return SwaggerModule.createDocument(app, config, { operationIdFactory: (_c, method) => method });
}
