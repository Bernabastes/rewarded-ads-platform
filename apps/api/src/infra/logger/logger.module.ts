import { Global, Injectable, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import pino, { type Logger as PinoLogger } from 'pino';
import { AppConfig } from '../../config/app-config';

export type SecurityEvent =
  | 'otp.rate_limited'
  | 'otp.too_many_attempts'
  | 'auth.refresh_reuse_detected'
  | 'auth.invalid_credentials'
  | 'age.restricted'
  | 'completion.rejected'
  | 'completion.flagged'
  | 'fraud.flag_created'
  | 'fraud.flag_resolved'
  | 'fraud.trust_score_changed'
  | 'ledger.drift_detected'
  | 'ledger.insufficient_balance'
  | 'ledger.write'
  | 'withdrawal.flagged_for_review'
  | 'withdrawal.rate_limited'
  | 'withdrawal.decision'
  | 'withdrawal.payout_failed'
  | 'adjustment.requested'
  | 'adjustment.executed'
  | 'adjustment.self_approval_blocked'
  | 'admin.moderation'
  | 'webhook.signature_invalid'
  | 'payout.provider_failover'
  // Phase 4A
  | 'auth.access_tokens_invalidated'
  | 'auth.denylist_unavailable'
  | 'impersonation.issued'
  | 'impersonation.write_blocked'
  | 'idempotency.replayed'
  | 'idempotency.key_reused_different_payload'
  | 'idempotency.store_failed'
  | 'consent.required'
  | 'referral.applied'
  | 'referral.paid'
  | 'referral.rejected'
  | 'referral.bonus_withheld'
  | 'media.duration_corrected'
  | 'media.processing_failed'
  | 'destination.resolved'
  | 'destination.otp_verified'
  | 'destination.not_verified'
  | 'kyc.submitted'
  | 'kyc.decision'
  | 'kyc.required'
  | 'kyc.duplicate_identity'
  | 'alert.raised'
  | 'alert.delivery_failed'
  | 'alert.acknowledged'
  | 'data_rights.export_requested'
  | 'data_rights.export_ready'
  | 'data_rights.deletion_requested'
  | 'data_rights.deletion_executed'
  | 'data_rights.deletion_cancelled'
  | 'frequency_cap.reached'
  // Phase 5 (security remediation)
  | 'otp.verify_rate_limited'
  | 'auth.login_rate_limited'
  | 'auth.account_locked'
  | 'auth.mfa_failed'
  | 'auth.mfa_enabled'
  | 'auth.mfa_disabled'
  | 'admin.account_created'
  | 'admin.role_changed'
  | 'admin.password_reset'
  | 'payout.outcome_unknown'
  | 'payout.manual_review_decided'
  | 'destination.lookup_rate_limited'
  | 'attention.answer_wrong'
  | 'security.production_gate';

/** Field names that must never appear in clear text in any log line (OTP codes, credentials, tokens). */
export const SECRET_FIELDS = ['code', 'otp', 'devCode', 'password', 'newPassword', 'currentPassword', 'token', 'accessToken', 'refreshToken', 'mfaToken', 'secret'] as const;

/** Deep-redacts SECRET_FIELDS (used in production in addition to pino's path-based redaction). */
export function redactSecretFields<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => redactSecretFields(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = (SECRET_FIELDS as readonly string[]).includes(k) ? '[redacted]' : redactSecretFields(v);
    }
    return out as T;
  }
  return value;
}

/**
 * Dedicated security/fraud log channel. It is a SEPARATE pino instance (own destination when
 * SECURITY_LOG_PATH is set, otherwise stdout) tagged with `channel: "security"` so SIEM/log
 * pipelines can route it independently from normal application logs.
 */
@Injectable()
export class SecurityLogger {
  private readonly logger: PinoLogger;
  private readonly redactSecrets: boolean;

  constructor(config: AppConfig) {
    const destination = config.env.SECURITY_LOG_PATH
      ? pino.destination({ dest: config.env.SECURITY_LOG_PATH, mkdir: true, sync: false })
      : pino.destination(1);
    this.redactSecrets = config.isProduction;
    this.logger = pino(
      {
        level: config.isTest ? 'silent' : 'info',
        base: { channel: 'security', service: 'rap-api' },
        timestamp: pino.stdTimeFunctions.isoTime,
        // Never let a one-time code / credential reach the security channel either (#9).
        redact: { paths: [...SECRET_FIELDS, ...SECRET_FIELDS.map((f) => `*.${f}`)], censor: '[redacted]' },
      },
      destination,
    );
  }

  event(event: SecurityEvent, data: Record<string, unknown>, level: 'info' | 'warn' | 'error' = 'warn') {
    this.logger[level]({ event, ...(this.redactSecrets ? redactSecretFields(data) : data) }, event);
  }

  info(event: SecurityEvent, data: Record<string, unknown>) {
    this.event(event, data, 'info');
  }

  warn(event: SecurityEvent, data: Record<string, unknown>) {
    this.event(event, data, 'warn');
  }

  error(event: SecurityEvent, data: Record<string, unknown>) {
    this.event(event, data, 'error');
  }
}

@Global()
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.isTest ? 'silent' : config.env.LOG_LEVEL,
          base: { channel: 'app', service: 'rap-api' },
          transport: config.env.LOG_PRETTY
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
          redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
          autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/health') },
          customProps: () => ({ channel: 'app' }),
          serializers: {
            req: (req: { id: unknown; method: string; url: string }) => ({
              id: req.id,
              method: req.method,
              url: req.url,
            }),
          },
        },
      }),
    }),
  ],
  providers: [SecurityLogger],
  exports: [SecurityLogger, LoggerModule],
})
export class AppLoggerModule {}
