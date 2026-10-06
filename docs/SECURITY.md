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

### 3b. Second-opinion audit (Phase 5b)

An independent verifier re-read every Phase 5 fix and test: 16 / 19 confirmed FIXED, #1 and #14 PARTIALLY FIXED,
plus seven smaller items. Everything below was fixed with a regression test that fails before / passes after.

| Item | Severity | Residual / finding | Fix (where) | Commit | Regression test |
| --- | --- | --- | --- | --- | --- |
| New-1 | HIGH (re-opens #1) | `PATCH budget` ∥ `submit` TOCTOU: the reservation was computed from a row read before the transaction; `chargeCampaign` spent against `budget_etb`; approve never checked funding | `submit()` locks the campaign row, re-reads it, requires the ledger to agree nothing beyond `spent_etb` is reserved, claims with `WHERE status='draft' AND budget_etb=<locked> AND spent_etb=<locked>` and stamps `budget_reserved_etb` from the locked budget; `update()` re-validates under the same lock and writes guarded by status + budget + spent; `chargeCampaign` caps at `LEAST(budget_etb, budget_reserved_etb)`; `approveCampaign` → `422 CAMPAIGN_UNDERFUNDED` when `reserved < budget` (`campaigns.service.ts`, `ads.service.ts`, `admin-review.service.ts`) | `b06e231` | `campaigns.service.spec.ts` (locked-row reservation, pinned claim, out-of-sync ledger, update re-validation), `admin-review.service.spec.ts` (funding gate), `ads.service.spec.ts` (LEAST cap), e2e `REGRESSION New-1` (20 interleaved PATCH + submit rounds → every pending campaign has `reserved == budget`, wallet reconciles); `scripts/audit-reservations.mjs` flags UNDERFUNDED live campaigns |
| New-2 | MEDIUM (money) | `findByReference` treated HTTP 404 / unexpected 2xx as "never accepted" → failover (double payout) or refund while money in flight | `null` only for the partner's documented business "not found" (`TELEBIRR_ORDER_NOT_FOUND_CODES`, `CHAPA_TRANSFER_NOT_FOUND_MESSAGES`); everything else is ambiguous; the last provider's "not found" after an ambiguous send (or ambiguous-then-exhausted) → `needs_manual_review`; `markFailed` only on a definitive provider error; retried `initiate` jobs (`PAYOUT_INITIATE_ATTEMPTS`) resume via `findExisting()`; 10-minute sweeper parks payouts `processing` without a partner for > `PAYOUT_STUCK_PROCESSING_MINUTES` and raises `PAYOUT_STUCK_PROCESSING` (`providers/*`, `payout-provider.registry.ts`, `payout.processor.ts`, `withdrawals.service.ts`) | `09ca1ab` | `payout-providers.spec.ts` (lookup semantics per provider, parking branches, `findExisting`), `payout.processor.spec.ts` (last-provider parking, unexpected error, resume paths), `withdrawals.service.spec.ts` (sweeper) |
| New-3 | LOW (login CSRF) | `?mode=cookie` + the urlencoded parser let a cross-site form POST plant a `rap_refresh` cookie | cookie mode is selected by `X-Auth-Mode: cookie` only; no urlencoded parser, `/auth/*` answers 415 to non-JSON bodies; `assertCookieModeOrigin` refuses cross-site / unknown-origin cookie-mode requests with 403 before any work (`auth-cookies.ts`, `app.setup.ts`, `auth.controller.ts`) | `f55cf2d` | `auth-cookies.spec.ts`, `app.setup.spec.ts` (415 matrix), e2e `REGRESSION New-3` (the exact exploit sets no cookie) |
| New-4 | LOW | `MFA_ENCRYPTION_KEY` optional, fell back to `JWT_ACCESS_SECRET` | production requires a dedicated ≥ 32-char key that differs from the JWT / KYC keys (`config/env.ts`) | `ed91216` | `env.spec.ts` (missing / short / JWT-equal / KYC-equal) |
| New-5 | LOW (infra) | Redis unauthenticated on the compose network; Redis-backed controls failed open | `redis-server --requirepass ${REDIS_PASSWORD:?}`, `REDIS_URL` with password (refused without one in production), `backend` network without the SPA containers; `SECURITY_REDIS_FAIL_MODE=closed\|open` (default closed in production) for the login throttle / lockout, MFA replay guard + challenge single-use, destination lookup cap and the access-token denylist → 503 + security event (`docker-compose.yml`, `app-config.ts`, `login-throttle.ts`, `mfa.service.ts`, `auth.service.ts`, `destinations.service.ts`, `token.service.ts`) | `70a25df` | `login-hardening.spec.ts`, `token.service.spec.ts`, `destinations.service.spec.ts` (open vs closed), `env.spec.ts`; live: `redis`/`postgres` unresolvable from `rap-admin-web`, NOAUTH without the password |
| New-6 | LOW (money) | `releaseFlaggedCompletion` charged `spent_etb` without a campaign status / funding check | release runs before the flag is resolved and only when `status IN (active, paused)` and `spent + cost <= LEAST(budget, reserved)`; otherwise `422 CAMPAIGN_NOT_CHARGEABLE` and the flag stays open; admin UI explains it (`admin-reports.service.ts`, admin-web `errors.ts`) | `26810e6` | `admin-reports.service.spec.ts` (completed campaign, under-reserved active campaign, in-tx race), admin-web `errors.test.ts` |
| New-7 | LOW | MFA endpoints unthrottled; setup/enable needed no password; timing oracle on unknown e-mails; missing mfaToken-as-Bearer test | `verifyForAdmin` runs the `LoginThrottle` (wrong codes count toward the lockout) for login step 2, enable and disable; setup + enable require the current password; constant-work `passwordMatches` against a per-process dummy hash; `BCRYPT_ROUNDS = 12` everywhere (`mfa.service.ts`, `auth/password.ts`, admin-web security page) | `155c52f` | `auth.guard.spec.ts` (mfaToken as Bearer → 401), `login-hardening.spec.ts` (password on setup/enable, 5 wrong codes → 423), admin-web `security-page.test.tsx` |
| New-8 | LOW (partial #14) | deletion left `user_consents.ip_address/device_id` and `account_deletion_requests.ip_address` | both scrubbed in `DataRightsService.execute` | `f193889` | `data-rights.service.spec.ts` PII grep (consent proof survives identifier-free) |
| New-9 | INFO | stray `apps/api/profile` (Jest/Prisma dump) committed | `git rm` + `.gitignore` | `f193889` | – |
| #5/#7 notes | – | lockout keyed per account was a DoS vector against finance admins; bcrypt cost 10 vs documented 12 | hard lock + failure streak keyed account **+ IP**; the per-account window stays as the soft throttle and an IP that completed a login for the account within `LOGIN_TRUSTED_IP_HOURS` is exempt from it (never from the per-IP limit or its own lock) | `6980ec2` | `login-hardening.spec.ts` (attacker IP locked, owner admitted, trusted exemption), `auth.service.login.spec.ts` |

### 3c. Third verifier (Phase 5c) – Conditional GO residuals

The third independent verifier reviewed the Phase 5b diff: New-1..New-9 CLOSED, one MEDIUM plus six residuals.
All closed with fail-before / pass-after tests.

| Item | Severity | Residual | Fix (where) | Commit | Regression test |
| --- | --- | --- | --- | --- | --- |
| New-10 | MEDIUM | the source IP was trusted after the *password* step, before TOTP – a stolen password bought 5 TOTP guesses per IP per 15 min with no account-wide cap | `loginAdmin` clears the streak but trusts the IP only when no TOTP step follows; `loginAdminMfa` trusts it after the code passes; `MFA_MAX_FAILURES_PER_ACCOUNT_PER_HOUR` (10) wrong codes per ACCOUNT across all IPs lock the account for every IP (`423 ACCOUNT_LOCKED`, security log, audit row, critical `ADMIN_MFA_BRUTE_FORCE` alert), enforced inside `verifyForAdmin` for login step 2 / enable / disable (`auth.service.ts`, `login-throttle.ts`, `mfa.service.ts`) | `ec74721` | `auth.service.login.spec.ts` (no trust mark after the password step; 10 wrong codes from rotating IPs → 423 for a fresh IP, alert raised); pentest probe New-10 |
| New-2 caveat | – | the NOT_FOUND business code was honoured on any HTTP status | telebirr: only on 200 / 400 (`TELEBIRR_NOT_FOUND_HTTP_STATUSES`), Chapa: only on 200 / 400 / 404; `PAYOUT_LOOKUP_STRICT` (default **true in production**) makes every not-found ambiguous → `needs_manual_review` (no failover, no refund) on both registry paths until the partner contract is confirmed (`telebirr.provider.ts`, `chapa-payout.provider.ts`, `payout-provider.registry.ts`) | `da0b09b` | `payout-providers.spec.ts` (status matrix per provider; strict vs lenient on `initiateWithFailover` and `findExisting`; defaults) |
| New-1 residual | – | `resume()` / admin un-pause were not pinned | both lock the campaign row, refuse `budget_reserved_etb < budget_etb` (`422 CAMPAIGN_UNDERFUNDED`) and claim `WHERE status='paused' AND budget_etb=<locked> AND budget_reserved_etb=<locked>` (`campaigns.service.ts`, `admin-review.service.ts`) | `6546edc` | `campaigns.service.spec.ts`, `admin-review.service.spec.ts` |
| New-3 residual | – | content-type gate tolerance; Nest's default `urlencoded` parser still registered | `bodyParser: false` in `main.ts`, the OpenAPI exporter and the e2e harness (only `configureApp`'s JSON parser with raw-body capture exists); `mediaTypeOf()` – exactly `application/json`, case-insensitive, parameters tolerated; `multipart/*`, `text/plain` JSON, `json-patch` → 415 (`app.setup.ts`) | `594f2cc` | `app.setup.spec.ts` (mixed-case / parameter / multipart matrix), e2e `REGRESSION New-3` (`TEXT/PLAIN; charset` → 415, mixed-case JSON → 201, form body never parsed on a non-auth route) |
| New-8 residual | – | deletion left `withdrawals.provider_status_raw/bank_code`, alert payloads, idempotency rows | all scrubbed: partner payload / bank code nulled (amounts, status, provider ids kept), the user's `idempotency_keys` rows deleted, `platform_alerts.payload` phone strings replaced by `deleted:<userId>` + `subjectDeleted` flag (jsonb text replace, validated on live Postgres) (`data-rights.service.ts`) | `c4eeb60` | `data-rights.service.spec.ts` PII grep (other users' alerts / advertiser idempotency rows untouched) |
| New-4 residual | – | dev fallback `MFA_ENCRYPTION_KEY ?? JWT_ACCESS_SECRET` | removed; the key is required in every environment (dev default in `.env.example`, distinct from the JWT dev secret and rejected in production) (`mfa.service.ts`, `config/env.ts`) | `effd61e` | `env.spec.ts` |
| New-5 info | – | fraud IP-velocity read failed open silently | honours `SECURITY_REDIS_FAIL_MODE`: closed → velocity treated as exceeded → `IP_VELOCITY` hit → completion **flagged** for review (never rejected on this signal alone); both modes log `auth.denylist_unavailable{scope: fraud_ip_velocity}` (`fraud.service.ts`) | `f7bbca6` | `fraud.service.spec.ts` |

Final live pentest re-run (2026-10-06, rebuilt stack, 17 probes incl. the new New-10 probe): **17 / 17 BLOCKED** –
New-10: 5 wrong codes evaluated (per-IP lock), then `423 ACCOUNT_LOCKED` for the account on a brand-new password
login from the same host; no session issued.

## 4. Production hardening checklist

Most of these are **enforced** by the env schema (`apps/api/src/config/env.ts`): with `NODE_ENV=production` the API
refuses to start until they hold. The rest are operational.

Enforced at boot:
- [ ] `JWT_ACCESS_SECRET` ≥ 32 random chars (not the dev default); `KYC_HASH_KEY` ≥ 32 chars; `MFA_ENCRYPTION_KEY`
      set in EVERY environment and, in production, ≥ 32 chars, not the dev default and different from both
      (dedicated key for TOTP secrets at rest - New-4)
- [ ] `CHAPA_SECRET_KEY` + `CHAPA_WEBHOOK_SECRET` (real gateway), `PAYOUTS_MOCK=false` with telebirr / Chapa payout credentials
- [ ] `SMS_PROVIDER=http` (or another real provider) with `SMS_API_URL` / `SMS_API_KEY`
- [ ] non-default `S3_ACCESS_KEY` / `S3_SECRET_KEY` (≥ 16 chars); `CORS_ORIGINS` is an explicit list (no `*`)
- [ ] `REDIS_URL` carries a password (`redis://:<password>@host:6379`; compose enforces `--requirepass` with
      `REDIS_PASSWORD`) - New-5
- [ ] `SWAGGER_ENABLED=false`, `OTP_DEV_ECHO=false`, no `OTP_DEV_FIXED_CODE`, `RUN_SEED=false`

Operational:
- [ ] `SECURITY_REDIS_FAIL_MODE` left at its production default (`closed`): when Redis is unreachable the login
      throttle / lockout, MFA replay guard, destination lookup cap and token denylist answer 503 instead of allowing;
      only set `open` knowingly, with the `auth.denylist_unavailable` security events alerting someone
- [ ] `ADMIN_MFA_REQUIRED=true`; every finance / super_admin enrols TOTP on first login (setup and enable ask for the
      password); create admins only through `POST /admin/admins` (temporary password shown once).
      `MFA_MAX_FAILURES_PER_ACCOUNT_PER_HOUR` (default 10) stays low - it is the only cap on TOTP guessing that
      an attacker with a stolen password and many IPs cannot route around; route `ADMIN_MFA_BRUTE_FORCE` alerts to
      on-call (New-10)
- [ ] `PAYOUT_LOOKUP_STRICT` left at its production default (`true`) until BOTH partners have confirmed, in
      writing, their "order not found" business answer (telebirr `code` values + HTTP statuses for the outTradeNo
      query; Chapa's "Transfer not found" reply) – only then set `false` so a confirmed not-found may fail over
      instead of parking the payout; expect more `needs_manual_review` items while strict (go-live step)
- [ ] `TRUST_PROXY_HOPS` equals the number of reverse proxies / load balancers in front of the API (0 when exposed
      directly) - the login lockout, OTP limits and security logs are keyed by the resulting client IP; TLS everywhere
      (`AUTH_COOKIE_SECURE` stays true)
- [ ] `AUTH_COOKIE_DOMAIN` stays **unset** (host-only refresh cookie; a parent-domain cookie could be planted by or
      leak to sibling subdomains - New-3). Serve the API and each console on their own hosts and list the consoles
      in `CORS_ORIGINS` (cookie mode is refused for any other origin)
- [ ] Postgres / Redis / MinIO (or S3) reachable only from the API network (compose: the `backend` network; the web
      containers are not attached to it); backups per `docs/RUNBOOK.md`; bucket policy =
      `docker/minio-bucket-policy.json` (deny `private/*`)
- [ ] Alert notifiers configured (`ALERT_TELEGRAM_*` or `ALERT_WEBHOOK_URL`) and someone on call for
      `LEDGER_DRIFT`, `PAYOUT_FAILURE_RATE`, `DESTINATION_LOOKUP_SPIKE`, `PAYOUT_STUCK_PROCESSING`, `ADMIN_MFA_BRUTE_FORCE`
- [ ] Review the `needs_manual_review` queue daily; `scripts/audit-reservations.mjs` in the weekly checks
      (0 discrepancies; any UNDERFUNDED line is a New-1 class incident)
- [ ] Confirm telebirr "query by outTradeNo" (and its "order not found" business codes) and the Chapa transfer verify
      endpoint / "Transfer not found" reply against the partners' current docs - these are the ONLY answers that let
      the worker treat a transfer as never accepted
- [ ] Rotate `KYC_HASH_KEY` / `MFA_ENCRYPTION_KEY` only with a migration plan (re-hash / re-encrypt)
- [ ] Re-run the pentest script (`live-pentest.mjs`) against staging after every release that touches auth or money

## 5. Reporting a vulnerability

Please report security issues privately to **security@REPLACE-ME.et** (placeholder – set the real mailbox before
launch) and allow 90 days for a fix before public disclosure. Include reproduction steps and, where relevant, the
account ids / timestamps so we can correlate with the security log. Do not test against production accounts that are
not your own; the demo stack (`docker compose up`) is the intended target for research.
