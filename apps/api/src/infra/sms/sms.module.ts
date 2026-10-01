import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config';

export interface SmsProvider {
  readonly name: string;
  readonly isMock: boolean;
  sendOtp(phoneNumber: string, code: string, ttlSeconds: number): Promise<void>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

/**
 * MOCK SMS provider: logs the OTP instead of sending it - DEVELOPMENT ONLY. The env schema refuses
 * SMS_PROVIDER=mock in production, and even then the code is never written to the log outside development
 * (security audit #9: OTPs in application logs let any log reader log in as any phone number).
 */
@Injectable()
export class MockSmsProvider implements SmsProvider {
  readonly name = 'mock';
  readonly isMock = true;
  private readonly logger = new Logger('MockSmsProvider');

  constructor(private readonly revealCodes: boolean) {}

  async sendOtp(phoneNumber: string, code: string, ttlSeconds: number): Promise<void> {
    this.logger.log(`[MOCK SMS] to=${phoneNumber} otp=${this.revealCodes ? code : '[redacted]'} ttl=${ttlSeconds}s`);
  }
}

export interface HttpSmsConfig {
  apiUrl: string;
  apiKey: string;
  senderId?: string;
  timeoutMs: number;
}

/**
 * Generic HTTP SMS gateway: `POST SMS_API_URL` with `Authorization: Bearer SMS_API_KEY` and a JSON body
 * `{ to, message, from? }`. Wire it to your gateway (AfroMessage, GeezSMS, Ethio Telecom SMPP bridge, Twilio...)
 * by adapting `buildRequest()` / `assertAccepted()` - the message text is the only OTP-bearing field and it is
 * never logged. Selected with SMS_PROVIDER=http.
 */
@Injectable()
export class HttpSmsProvider implements SmsProvider {
  readonly name = 'http';
  readonly isMock = false;
  private readonly logger = new Logger('HttpSmsProvider');

  constructor(
    private readonly cfg: HttpSmsConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async sendOtp(phoneNumber: string, code: string, ttlSeconds: number): Promise<void> {
    const minutes = Math.max(1, Math.round(ttlSeconds / 60));
    const message = `${code} is your Gize verification code. It expires in ${minutes} minute${minutes === 1 ? '' : 's'}. Never share it.`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      const res = await this.fetchImpl(this.cfg.apiUrl, { ...this.buildRequest(phoneNumber, message), signal: controller.signal });
      await this.assertAccepted(res);
      this.logger.log(`SMS sent to ${phoneNumber.slice(0, 7)}**** (ttl ${ttlSeconds}s)`);
    } catch (err) {
      // No code, no message text in the error path either.
      this.logger.error(`SMS to ${phoneNumber.slice(0, 7)}**** failed: ${(err as Error).message}`);
      throw new Error('SMS delivery failed');
    } finally {
      clearTimeout(timer);
    }
  }

  /** Adapt to the gateway's request shape here. */
  protected buildRequest(to: string, message: string): RequestInit {
    return {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.cfg.apiKey}` },
      body: JSON.stringify({ to, message, ...(this.cfg.senderId ? { from: this.cfg.senderId } : {}) }),
    };
  }

  /** Adapt to the gateway's response shape here (default: any 2xx = accepted). */
  protected async assertAccepted(res: Response): Promise<void> {
    if (!res.ok) throw new Error(`gateway answered HTTP ${res.status}`);
  }
}

export function createSmsProvider(config: AppConfig, fetchImpl: typeof fetch = fetch): SmsProvider {
  const e = config.env;
  switch (e.SMS_PROVIDER) {
    case 'http':
      return new HttpSmsProvider(
        { apiUrl: e.SMS_API_URL!, apiKey: e.SMS_API_KEY!, senderId: e.SMS_SENDER_ID, timeoutMs: e.SMS_TIMEOUT_MS },
        fetchImpl,
      );
    case 'mock':
    default:
      return new MockSmsProvider(config.isDevelopment);
  }
}

@Global()
@Module({
  providers: [{ provide: SMS_PROVIDER, inject: [AppConfig], useFactory: (config: AppConfig) => createSmsProvider(config) }],
  exports: [SMS_PROVIDER],
})
export class SmsModule {}
