import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config';

export interface SmsProvider {
  readonly name: string;
  readonly isMock: boolean;
  sendOtp(phoneNumber: string, code: string, ttlSeconds: number): Promise<void>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

/**
 * MOCK SMS provider: logs the OTP instead of sending it. Swap for a real Ethiopian SMS gateway
 * (e.g. AfroMessage / Ethio Telecom SMPP) by implementing SmsProvider and changing SMS_PROVIDER env.
 */
@Injectable()
export class MockSmsProvider implements SmsProvider {
  readonly name = 'mock';
  readonly isMock = true;
  private readonly logger = new Logger('MockSmsProvider');

  async sendOtp(phoneNumber: string, code: string, ttlSeconds: number): Promise<void> {
    this.logger.log(`[MOCK SMS] to=${phoneNumber} otp=${code} ttl=${ttlSeconds}s`);
  }
}

@Global()
@Module({
  providers: [
    {
      provide: SMS_PROVIDER,
      inject: [AppConfig],
      useFactory: (config: AppConfig): SmsProvider => {
        switch (config.env.SMS_PROVIDER) {
          case 'mock':
          default:
            return new MockSmsProvider();
        }
      },
    },
  ],
  exports: [SMS_PROVIDER],
})
export class SmsModule {}
