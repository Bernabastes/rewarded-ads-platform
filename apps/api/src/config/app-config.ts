import { Global, Injectable, Module } from '@nestjs/common';
import { type Env, loadEnv } from './env';

/**
 * Typed, validated configuration. Injected everywhere instead of reading process.env directly.
 * Platform economics/fraud constants live in `platform` / `fraud` so tests can override them easily.
 */
@Injectable()
export class AppConfig {
  readonly env: Env;

  constructor(env?: Env) {
    this.env = env ?? loadEnv();
  }

  get isProduction() {
    return this.env.NODE_ENV === 'production';
  }

  get isTest() {
    return this.env.NODE_ENV === 'test';
  }

  get corsOrigins(): string[] {
    return this.env.CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  get platform() {
    const e = this.env;
    return {
      coinsPerEtb: e.COINS_PER_ETB,
      minWithdrawalEtb: e.MIN_WITHDRAWAL_ETB,
      largeWithdrawalThresholdEtb: e.LARGE_WITHDRAWAL_THRESHOLD_ETB,
      dailyAdCompletionLimit: e.DAILY_AD_COMPLETION_LIMIT,
      platformTakeRate: e.PLATFORM_TAKE_RATE,
      minWatchRatio: e.MIN_WATCH_RATIO,
      maxWatchRatio: e.MAX_WATCH_RATIO,
      watchGraceSeconds: e.WATCH_GRACE_SECONDS,
      minAge: e.MIN_AGE,
      heartbeatIntervalSeconds: e.HEARTBEAT_INTERVAL_SECONDS,
      minHeartbeatRatio: e.MIN_HEARTBEAT_RATIO,
      watchSessionTtlMinutes: e.WATCH_SESSION_TTL_MINUTES,
      dailyWithdrawalRequestLimit: e.DAILY_WITHDRAWAL_REQUEST_LIMIT,
      maxWatchAttemptsPerAdPerDay: e.MAX_WATCH_ATTEMPTS_PER_AD_PER_DAY,
      minCampaignBudgetEtb: e.MIN_CAMPAIGN_BUDGET_ETB,
      minCostPerActionEtb: e.MIN_COST_PER_ACTION_ETB,
      minTopupEtb: e.MIN_TOPUP_ETB,
      invoiceVatRate: e.INVOICE_VAT_RATE,
    };
  }

  get fraud() {
    const e = this.env;
    return {
      flagThreshold: e.FRAUD_FLAG_THRESHOLD,
      rejectThreshold: e.FRAUD_REJECT_THRESHOLD,
      minTrustScoreForFeed: e.FRAUD_MIN_TRUST_FOR_FEED,
      deviceSharedAccountsThreshold: e.FRAUD_DEVICE_SHARED_ACCOUNTS_THRESHOLD,
      ipCompletionsPerHourThreshold: e.FRAUD_IP_COMPLETIONS_PER_HOUR_THRESHOLD,
      minAccountAgeHoursForFullTrust: e.FRAUD_MIN_ACCOUNT_AGE_HOURS_FOR_FULL_TRUST,
    };
  }

  get mocks() {
    const e = this.env;
    return {
      sms: e.SMS_PROVIDER === 'mock',
      payouts: e.PAYOUTS_MOCK,
      paymentGateway: !e.CHAPA_SECRET_KEY,
      push: !e.FCM_SERVICE_ACCOUNT_JSON,
    };
  }
}

@Global()
@Module({
  providers: [{ provide: AppConfig, useFactory: () => new AppConfig() }],
  exports: [AppConfig],
})
export class AppConfigModule {}
