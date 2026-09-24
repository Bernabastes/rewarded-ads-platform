import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config';

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface PushResult {
  token: string;
  ok: boolean;
  error?: string;
  /** Token is permanently invalid and should be deleted. */
  invalidToken?: boolean;
}

export interface PushAdapter {
  readonly name: string;
  readonly isMock: boolean;
  send(tokens: string[], message: PushMessage): Promise<PushResult[]>;
}

export const PUSH_ADAPTER = Symbol('PUSH_ADAPTER');

/** MOCK push adapter: logs instead of calling FCM. */
@Injectable()
export class MockPushAdapter implements PushAdapter {
  readonly name = 'mock-fcm';
  readonly isMock = true;
  private readonly logger = new Logger('MockPushAdapter');

  async send(tokens: string[], message: PushMessage): Promise<PushResult[]> {
    this.logger.log(`[MOCK PUSH] tokens=${tokens.length} title="${message.title}"`);
    return tokens.map((token) => ({ token, ok: true }));
  }
}

/**
 * Firebase Cloud Messaging HTTP v1 adapter. Uses a service-account JSON (FCM_SERVICE_ACCOUNT_JSON) to mint
 * an OAuth2 token and POSTs to the v1 send endpoint per token. No SDK dependency to keep the image small.
 */
@Injectable()
export class FcmPushAdapter implements PushAdapter {
  readonly name = 'fcm';
  readonly isMock = false;
  private readonly logger = new Logger('FcmPushAdapter');
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly projectId: string,
    private readonly serviceAccount: { client_email: string; private_key: string },
  ) {}

  async send(tokens: string[], message: PushMessage): Promise<PushResult[]> {
    const token = await this.getAccessToken();
    const results: PushResult[] = [];
    for (const deviceToken of tokens) {
      try {
        const res = await fetch(`https://fcm.googleapis.com/v1/projects/${this.projectId}/messages:send`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: {
              token: deviceToken,
              notification: { title: message.title, body: message.body },
              data: message.data,
            },
          }),
        });
        if (res.ok) {
          results.push({ token: deviceToken, ok: true });
        } else {
          const text = await res.text();
          results.push({ token: deviceToken, ok: false, error: text, invalidToken: res.status === 404 });
        }
      } catch (err) {
        results.push({ token: deviceToken, ok: false, error: (err as Error).message });
      }
    }
    return results;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) return this.accessToken.value;
    const { createSign } = await import('node:crypto');
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        iss: this.serviceAccount.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      }),
    ).toString('base64url');
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${payload}`);
    const signature = signer.sign(this.serviceAccount.private_key).toString('base64url');
    const assertion = `${header}.${payload}.${signature}`;
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    });
    if (!res.ok) throw new Error(`FCM token exchange failed: ${res.status}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.accessToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    this.logger.debug('Obtained FCM access token');
    return json.access_token;
  }
}

@Global()
@Module({
  providers: [
    {
      provide: PUSH_ADAPTER,
      inject: [AppConfig],
      useFactory: (config: AppConfig): PushAdapter => {
        const json = config.env.FCM_SERVICE_ACCOUNT_JSON;
        if (json && config.env.FCM_PROJECT_ID) {
          try {
            return new FcmPushAdapter(config.env.FCM_PROJECT_ID, JSON.parse(json));
          } catch {
            new Logger('PushModule').warn(
              'FCM_SERVICE_ACCOUNT_JSON is not valid JSON; using mock push adapter',
            );
          }
        }
        return new MockPushAdapter();
      },
    },
  ],
  exports: [PUSH_ADAPTER],
})
export class PushModule {}
