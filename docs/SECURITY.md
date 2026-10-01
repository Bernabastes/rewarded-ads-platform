# Security

This document is the security reference for the Gize rewarded-advertising platform: the threat model, the controls
that exist in the code, how every finding of the Phase 5 security audit + live pentest was fixed, and the checklist an
operator must complete before the first real birr moves.

Related: `docs/ARCHITECTURE.md` (money model, ledger invariants), `docs/API.md` (contract incl. the Phase 5 changes),
`docs/RUNBOOK.md` (operations), `.env.example` (every variable with its production requirement).

---

## 1. Threat model

| Asset | Threats we defend against |
| ----- | ------------------------- |
| **User coin balances / payouts** (the only thing that converts to cash) | double credit (replayed completions, concurrent withdrawals, duplicated refunds), stolen payouts (destination tampering, account takeover), payout "double send" after an ambiguous partner answer, fraud rings farming rewards |
| **Advertiser prepaid wallets** | budget reservations that are not backed by money (reservation replay), forged payment webhooks, settling a different amount than paid |
| **Identity data** (phone numbers, KYC documents, id numbers, DOB, device/IP history) | leaking through public storage, brute-forcing hashed identifiers from a leaked table, retention after account deletion |
| **Admin console** | credential stuffing / brute force, stale role claims, session theft (XSS stealing long-lived tokens), privilege escalation by editing the database |
| **Platform integrity** | SSRF through creative ingestion, forged client IPs defeating rate limits and fraud signals, OTP brute force, lookup oracles against payout partners, clickjacking / content injection in the SPAs |
| **Operations** | shipping mock payment / SMS / storage credentials to production, world-readable data stores, running services as root |

Out of scope for the code (handled operationally): DDoS at the network edge, TLS termination, physical security of the
payout-partner credentials, insider misuse by a super_admin (mitigated only by audit + dual approval).

## 2. Controls (what exists)

### Money
- **Append-only coin ledger** with a DB trigger; `users.coin_balance` is a cache written only inside the ledger
  transaction and reconciled by a job that raises `LEDGER_DRIFT` alerts.
- **Idempotency** on every money write (ledger idempotency keys; `Idempotency-Key` on money POSTs with payload binding
  and `details.resourceId` on reuse).
- **Row locks** (`SELECT … FOR UPDATE`) around every balance-changing path: completion credit, withdrawal request
  (#12), campaign reservation / refund (#1), payment settlement.
- **Atomic status claims** (`updateMany WHERE status = …`) before any credit/refund so a lost race does nothing (#15).
- **Dual approval** for large withdrawals and all manual coin adjustments (two distinct admins, server-enforced).
- **Payout state machine**: `needs_manual_review` instead of auto-refund when the partner's answer is ambiguous (#7);
  reversals are keyed to the specific hold entry (#6).
- Budget reservations keyed by `submission_seq`, balance asserted under the wallet lock, budget edits blocked while a
  reservation is outstanding (#1); `scripts/audit-reservations.mjs` compares `budget_reserved_etb` with the ledger.

### Identity & access
- OTP login: hashed codes, atomic attempt claim, burn after `OTP_MAX_ATTEMPTS`, per-phone + per-IP verify limits,
  constant-time compare (#4). OTP values are never logged in production (#9).
- Password logins: bcrypt (cost 12), per-IP + per-account throttling, progressive lockout with audit (#5).
- Admin TOTP MFA (RFC 6238, otplib) with encrypted secrets, replay guard, mandatory for finance / super_admin when
  `ADMIN_MFA_REQUIRED=true` (#5).
- Admin accounts are created / reset / re-roled through audited super_admin endpoints with one-time temporary
  passwords; the last active super_admin cannot be removed (#5).
- Access tokens are short-lived JWTs; **roles are read from the database on every request** (#13); a denylist
  (`tokens_invalid_before`, per-jti) makes logout, suspension, bans, role changes and password resets immediate.
- Refresh tokens are opaque, hashed, rotated, family-revoked on reuse, claimed atomically (#15); web clients keep them
  in an httpOnly, Secure, SameSite=Strict cookie (#16), the mobile app in the OS keychain.
- Support impersonation tokens are read-only and audited on every request.
- Client IPs come from `req.ip` with an explicit `TRUST_PROXY_HOPS`; `X-Forwarded-For` is never parsed by hand (#3).

### Data protection
- KYC documents and data exports live under `private/` in the bucket; the bucket policy grants anonymous read ONLY on
  `creatives/*` and `seed/*` and explicitly denies `private/*` (#10). Documents are served through 5-minute presigned
  links to admins only.
- Identity numbers are stored as HMAC-SHA256 with `KYC_HASH_KEY` plus the last 4 digits (#14).
- Account deletion anonymises the user AND scrubs KYC fields, OTP rows, completion IP/device, refresh-token IP/UA,
  survey answers, install proofs, referral signup data and fraud-flag metadata; financial facts are retained (#14).
- Security-channel logs redact secrets in production.

### Content & infrastructure
- Creatives are never fetched from client-supplied URLs; only `creatives/<advertiserId>/…` keys from the presign
  endpoint are accepted, downloads are size/time capped, ffmpeg runs with `-nostdin -protocol_whitelist file,pipe`,
  errors shown to advertisers are generic (#2).
- Chapa webhooks require the payload-bound `Chapa-Signature`; settlement goes through `verify()` and the verified
  amount/currency must match (#17).
- SPAs: strict CSP (`script-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`), `X-Content-Type-Options`,
  `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy` (#16). API: helmet, CORS allow-list with credentials.
- Containers: pinned image digests, data stores bound to loopback, credentials required from `.env`, API runs as
  `node` (#10, #16).
- **Production gates in the env schema** (#8/#9): the API refuses to boot with mock payments, mock payouts, mock SMS,
  default storage credentials, wildcard CORS, a short JWT secret, no `KYC_HASH_KEY`, or Swagger enabled; mock checkout
  routes are 404; the seed refuses to run (`ALLOW_SEED_IN_PRODUCTION` override).

### Fraud & abuse
- Server-timed watch sessions with heartbeats, min/max watch ratios, per-session shuffled attention questions whose
  wrong answer consumes the ad for the day (A3a), device/IP velocity signals, trust score, frequency caps, daily limits.
- Destination verification: new payout destinations need an OTP on the user's own phone BEFORE the partner is asked
  who owns the account; lookups are capped per user per day and spike-alerted per IP (#11).
- Alerts (ledger drift, payout failure rate, account minting, spend velocity, OTP spikes, destination-lookup spikes)
  delivered to Telegram / webhook / log.

## 3. Audit findings and how each was fixed

Source: read-only code audit (17 findings) + live pentest (notes A3a, D2). One commit per finding on `main`
(`git log --grep "security"`); each carries a regression test that failed before the fix.

| # | Severity | Finding | Fix (where) | Regression test |
| --- | --- | --- | --- | --- |
| 1 | CRITICAL | Campaign budget reservation replayed after reject → edit → resubmit (unfunded budget) | `campaigns.submission_seq`, per-seq idempotency keys, atomic draft claim, balance assert under wallet lock, budget edits blocked while net reservation ≠ 0, locked refunds (`campaigns.service.ts`, `campaign.economics.ts`, `campaign-lifecycle.service.ts`, `admin-review.service.ts`) | `campaigns.service.spec.ts` (replay sequence), e2e `REGRESSION #1` (DB-gated), `scripts/audit-reservations.mjs` (0 discrepancies) |
| 2 | HIGH | SSRF / arbitrary `storageKey` through creative ingestion | `storageKey` must be `creatives/<advertiserId>/…`; URLs only if they map to that prefix in our bucket; worker never fetches; capped download; ffmpeg protocol whitelist; generic `mediaError` (`campaigns.service.ts`, `media.service.ts`, `storage.service.ts`) | `media.service.spec.ts`, `campaigns.service.spec.ts` (`127.0.0.1` URL → 400, `private/kyc/..` → 400); pentest D2 re-run BLOCKED |
| 3 | HIGH | First-hop `X-Forwarded-For` trusted | `extractClientIp` uses `req.ip` only; `TRUST_PROXY_HOPS` (default 0) (`auth.decorators.ts`, `app.setup.ts`) | `auth.decorators.spec.ts` (spoofed XFF ignored for OTP limits + security logs) |
| 4 | HIGH | OTP brute force (non-atomic attempts, no verify rate limit) | `OtpVerifier`: Redis verify limits per phone/IP, atomic attempt claim, burn, constant-time compare, single consume; used by login + destination OTP (`otp.verifier.ts`) | `otp.verifier.spec.ts` (20 parallel wrong guesses → ≤ max evaluated, code burned) |
| 5 | HIGH | No login throttling / lockout, no admin MFA, admins managed in the DB | `LoginThrottle`, `MfaService` (TOTP, AES-256-GCM secrets, replay guard), MFA login step, `ADMIN_MFA_REQUIRED` gate, `PASSWORD_CHANGE_REQUIRED` gate, admin account management endpoints (`login-throttle.ts`, `mfa.service.ts`, `auth.service.ts`, `admin-accounts.service.ts`, `auth.guard.ts`) | `login-hardening.spec.ts`, `auth.service.login.spec.ts`, `admin-accounts.service.spec.ts`, `auth.guard.spec.ts`, admin-web login/security/admins tests |
| 6 | MEDIUM | Withdrawal reversal idempotency key collided across retries | `withdrawal_reversal:<holdEntryId>`; replay aborts (`withdrawals.service.ts`) | `withdrawals.service.spec.ts` (fail → retry → reject refunds the retry hold) |
| 7 | MEDIUM | Payout failover / auto-refund on ambiguous partner errors | timeouts on every provider call, definitive vs ambiguous classification, `findByReference` lookup, failover only on definitive errors, `needs_manual_review` + admin resolution (`providers/*`, `payout.processor.ts`, `withdrawals.service.ts`) | `payout-providers.spec.ts`, `payout.processor.spec.ts`, `withdrawals.service.spec.ts` (manual review) |
| 8 | MEDIUM | Mock routes / providers reachable with partial production config | env `superRefine` production gates; `BillingService.assertMock()` checks `isProduction` first; `HttpSmsProvider` (`config/env.ts`, `billing.service.ts`, `sms.module.ts`) | `env.spec.ts` (each unsafe prod combo rejected), `billing.spec.ts` |
| 9 | MEDIUM | OTP values logged / Swagger in production | `MockSmsProvider` reveals codes only in development; security logger redacts secret fields in production; Swagger gated on `SWAGGER_ENABLED && !production` | `sms.spec.ts`, `logger.spec.ts`, `env.spec.ts` |
| 10 | MEDIUM | World-readable bucket, data stores on all interfaces, default credentials, floating image tags | scoped bucket policy (deny `private/*`), loopback port bindings, `${VAR:?}` credentials, digest-pinned images (`docker-compose.yml`, `docker/minio-bucket-policy.json`, `seed.ts`) | live verification: `private/kyc/*` 403, `private/exports/*` 403, `creatives/*` 200, `seed/*` 200, listing 403; compose fails without credentials |
| 11 | MEDIUM | Destination lookup oracle ("who owns this number?") | OTP before lookup, per-user daily cap, per-IP spike alert (`destinations.service.ts`, `alert.rules.ts`) | `destinations.service.spec.ts` (deferred lookup, cap, alert), mobile `destinationFlow.test.ts`, e2e main flow |
| 12 | MEDIUM | TOCTOU in `POST /withdrawals` (in-flight / KYC checks outside the transaction) | checks under `users FOR UPDATE`, partial unique index `withdrawals_one_in_flight_per_user`, P2002 → `WITHDRAWAL_PENDING_EXISTS` (`withdrawals.service.ts`, migration `20261001080100`) | `withdrawals.service.spec.ts` (ordering, P2002), e2e `REGRESSION #12` (3 concurrent 999 ETB → one accepted) |
| 13 | LOW | `@Roles` evaluated against the token claim | admin row (active + role) loaded before `@Roles`; role changes revoke sessions (`auth.guard.ts`, `admin-accounts.service.ts`) | `auth.guard.spec.ts` (stale claim denied / DB role granted) |
| 14 | LOW | Plain sha256 identity hash; PII left after deletion | HMAC-SHA256 with `KYC_HASH_KEY`; deletion scrubs every PII column (`kyc.service.ts`, `data-rights.service.ts`) | `kyc.service.spec.ts`, `data-rights.service.spec.ts` (PII grep after execution) |
| 15 | LOW | Non-atomic release of flagged completions / refresh rotation | `updateMany` claims; lost race = no-op / reuse (`admin-reports.service.ts`, `token.service.ts`) | `admin-reports.service.spec.ts`, `token.service.spec.ts` |
| 16 | LOW | No CSP / hardening headers, API as root, refresh tokens in localStorage | nginx template with CSP + headers, `USER node`, cookie refresh mode, web token stores (`docker/nginx-spa.conf.template`, `apps/api/Dockerfile`, `auth-cookies.ts`, web clients) | `auth-cookies.spec.ts`, e2e cookie-mode flow, web client tests |
| 17 | LOW | Chapa webhook accepted the constant header; failure/settlement trusted the body | payload-bound signature only; verify-driven settlement with amount/currency match (`chapa.gateway.ts`, `billing.service.ts`) | `billing.webhook.spec.ts` |
| A3a | pentest | Attention-check answers guessable across attempts | wrong answer consumes the ad for the day; per-session shuffled option order (`ads.service.ts`) | `ads.service.spec.ts` |
| D2 | pentest | SSRF exploitable via `mediaUrl` | see #2 | pentest re-run (`files/security/pentest`) → BLOCKED |

Live pentest re-run (2026-10-01, rebuilt local stack, adapted script with four new probes): A1a, A1b, A2a, A2b, B1,
B2, B2b, C1, C2, C3, D1, D2, A3a, #4, #5 and #11 — **16 / 16 BLOCKED**. D2 is now refused before anything is fetched
(`400 MEDIA_SOURCE_NOT_ALLOWED` for a loopback URL, a `private/kyc/…` key and another tenant's `creatives/…` prefix);
#4 evaluated exactly `OTP_MAX_ATTEMPTS` of 20 parallel guesses and burned the code; #5 locked after 5 failures (423);
#11 revealed no holder name before the OTP step.

Deliberately **not** changed: telebirr `findByReference` uses the documented "query by outTradeNo" endpoint and must
be confirmed against Ethio Telecom's partner API before go-live (mock providers return "not found"); plain-sha256 KYC
hashes written before #14 do not match new submissions (reseed for demo data; re-hash offline with the key for a real
database).

## 4. Production hardening checklist

Most of these are **enforced** by the env schema (`apps/api/src/config/env.ts`): with `NODE_ENV=production` the API
refuses to start until they hold. The rest are operational.

Enforced at boot:
- [ ] `JWT_ACCESS_SECRET` ≥ 32 random chars (not the dev default); `KYC_HASH_KEY` ≥ 32 chars; `MFA_ENCRYPTION_KEY`
      ≥ 32 chars and different from both (dedicated key for TOTP secrets at rest - New-4)
- [ ] `CHAPA_SECRET_KEY` + `CHAPA_WEBHOOK_SECRET` (real gateway), `PAYOUTS_MOCK=false` with telebirr / Chapa payout credentials
- [ ] `SMS_PROVIDER=http` (or another real provider) with `SMS_API_URL` / `SMS_API_KEY`
- [ ] non-default `S3_ACCESS_KEY` / `S3_SECRET_KEY` (≥ 16 chars); `CORS_ORIGINS` is an explicit list (no `*`)
- [ ] `SWAGGER_ENABLED=false`, `OTP_DEV_ECHO=false`, no `OTP_DEV_FIXED_CODE`, `RUN_SEED=false`

Operational:
- [ ] `ADMIN_MFA_REQUIRED=true`; every finance / super_admin enrols TOTP on first login; create admins only through
      `POST /admin/admins` (temporary password shown once)
- [ ] `TRUST_PROXY_HOPS` equals the number of reverse proxies / load balancers in front of the API; TLS everywhere
      (`AUTH_COOKIE_SECURE` stays true; set `AUTH_COOKIE_DOMAIN` if the API and consoles share a parent domain)
- [ ] Postgres / Redis / MinIO (or S3) reachable only from the API network; backups per `docs/RUNBOOK.md`; bucket
      policy = `docker/minio-bucket-policy.json` (deny `private/*`)
- [ ] Alert notifiers configured (`ALERT_TELEGRAM_*` or `ALERT_WEBHOOK_URL`) and someone on call for
      `LEDGER_DRIFT`, `PAYOUT_FAILURE_RATE`, `DESTINATION_LOOKUP_SPIKE`
- [ ] Review the `needs_manual_review` queue daily; `scripts/audit-reservations.mjs` in the weekly checks
- [ ] Confirm telebirr "query by outTradeNo" and the Chapa transfer verify endpoint against the partners' current docs
- [ ] Rotate `KYC_HASH_KEY` / `MFA_ENCRYPTION_KEY` only with a migration plan (re-hash / re-encrypt)
- [ ] Re-run the pentest script (`live-pentest.mjs`) against staging after every release that touches auth or money

## 5. Reporting a vulnerability

Please report security issues privately to **security@REPLACE-ME.et** (placeholder – set the real mailbox before
launch) and allow 90 days for a fix before public disclosure. Include reproduction steps and, where relevant, the
account ids / timestamps so we can correlate with the security log. Do not test against production accounts that are
not your own; the demo stack (`docker compose up`) is the intended target for research.
