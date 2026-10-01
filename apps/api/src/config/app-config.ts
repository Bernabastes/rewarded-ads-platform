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

  get isDevelopment() {
    return this.env.NODE_ENV === 'development';
  }

  /**
   * Phase 5b New-5: what the Redis-backed security controls (login throttle / lockout, MFA replay guard and
   * challenge single-use, destination lookup cap, access-token denylist) do when Redis is unreachable.
   * `closed` refuses the request with 503; `open` lets it through with a security-log event. Default: closed in
   * production, open elsewhere (SECURITY_REDIS_FAIL_MODE overrides).
   */
  get redisFailClosed(): boolean {
    return (this.env.SECURITY_REDIS_FAIL_MODE ?? (this.isProduction ? 'closed' : 'open')) === 'closed';
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
      kycRequiredAboveMonthlyEtb: e.KYC_REQUIRED_ABOVE_MONTHLY_ETB,
      defaultFrequencyCap: e.DEFAULT_FREQUENCY_CAP,
      advertiserImpressionCapPerUserPerDay: e.ADVERTISER_IMPRESSION_CAP_PER_USER_PER_DAY,
      referralBonusCoins: e.REFERRAL_BONUS_COINS,
      refereeBonusCoins: e.REFEREE_BONUS_COINS,
      referralMaxPerReferrerPerDay: e.REFERRAL_MAX_PER_REFERRER_PER_DAY,
      accountDeletionGraceDays: e.ACCOUNT_DELETION_GRACE_DAYS,
      destinationResolveTtlMinutes: e.DESTINATION_RESOLVE_TTL_MINUTES,
      /** Security audit #11: partner account lookups a user may trigger per UTC day. */
      destinationLookupsPerDay: e.DESTINATION_LOOKUPS_PER_DAY,
      idempotencyTtlHours: e.IDEMPOTENCY_TTL_HOURS,
      impersonationTtlSeconds: e.IMPERSONATION_TTL_SECONDS,
    };
  }

  get alerts() {
    const e = this.env;
    return {
      enabled: e.ALERT_RULES_ENABLED,
      cron: e.ALERT_RULES_CRON,
      dedupeMinutes: e.ALERT_DEDUPE_MINUTES,
      payoutFailureRate: e.ALERT_PAYOUT_FAILURE_RATE,
      payoutMinSample: e.ALERT_PAYOUT_MIN_SAMPLE,
      accountsPerDevicePerHour: e.ALERT_ACCOUNTS_PER_DEVICE_PER_HOUR,
      spendVelocityMultiplier: e.ALERT_SPEND_VELOCITY_MULTIPLIER,
      spendVelocityMinEtb: e.ALERT_SPEND_VELOCITY_MIN_ETB,
      otpRequestsPerIpPerHour: e.ALERT_OTP_REQUESTS_PER_IP_PER_HOUR,
      /** Security audit #11: partner account lookups per IP per hour before DESTINATION_LOOKUP_SPIKE is raised. */
      destinationLookupsPerIpPerHour: e.ALERT_DESTINATION_LOOKUPS_PER_IP_PER_HOUR,
      telegramConfigured: Boolean(e.ALERT_TELEGRAM_BOT_TOKEN && e.ALERT_TELEGRAM_CHAT_ID),
      webhookConfigured: Boolean(e.ALERT_WEBHOOK_URL),
    };
  }

  get media() {
    const e = this.env;
    return {
      enabled: e.MEDIA_PROCESSING_ENABLED,
      ffmpegPath: e.MEDIA_FFMPEG_PATH,
      ffprobePath: e.MEDIA_FFPROBE_PATH,
      jobTimeoutSeconds: e.MEDIA_JOB_TIMEOUT_SECONDS,
      targetHeight: e.MEDIA_TARGET_HEIGHT,
      durationToleranceSeconds: e.MEDIA_DURATION_TOLERANCE_SECONDS,
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
      idVerification: e.ID_VERIFICATION_PROVIDER === 'mock',
      alerts: !(e.ALERT_TELEGRAM_BOT_TOKEN && e.ALERT_TELEGRAM_CHAT_ID) && !e.ALERT_WEBHOOK_URL,
      /** Destination name lookup runs on the payout providers, so it is mocked whenever payouts are. */
      destinationLookup: e.PAYOUTS_MOCK,
    };
  }
}

@Global()
@Module({
  providers: [{ provide: AppConfig, useFactory: () => new AppConfig() }],
  exports: [AppConfig],
})
export class AppConfigModule {}
