# Architecture

This document explains how the backend implements the product specification (`SPEC.md`), the decisions and
assumptions made where the spec left room, what is real versus mocked, and what must happen before production.

Contents

1. [Stack: as-is vs substituted](#1-stack-as-is-vs-substituted)
2. [System layout](#2-system-layout)
3. [Database schema rationale](#3-database-schema-rationale)
4. [Money & coin model](#4-money--coin-model)
5. [Ad-completion sequence](#5-ad-completion-sequence)
6. [Fraud engine](#6-fraud-engine)
7. [Withdrawal / payout state machine](#7-withdrawal--payout-state-machine)
8. [Dual-approval workflows](#8-dual-approval-workflows)
9. [Advertiser funds, campaigns and billing](#9-advertiser-funds-campaigns-and-billing)
10. [Auth, RBAC and account states](#10-auth-rbac-and-account-states)
11. [Logging, audit and observability](#11-logging-audit-and-observability)
12. [Real vs mocked](#12-real-vs-mocked)
13. [Assumptions](#13-assumptions)
14. [Production-readiness checklist](#14-production-readiness-checklist)

---

## 1. Stack: as-is vs substituted

| Layer            | Spec recommendation                        | Used                                                              | Note                                                                                                                                                                                                                       |
| ---------------- | ------------------------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend          | Node + TypeScript + NestJS                 | **As-is** – NestJS 12.1, TypeScript 5.9 strict, Express adapter   | Nest 12 ships ESM-only packages; the app stays CommonJS via Node's `require(esm)` (Node ≥ 24.9 required, Jest runs with `--experimental-vm-modules`).                                                                      |
| Database         | PostgreSQL                                 | **As-is** – PostgreSQL 16                                         | Two deliberate bits of vendor SQL: append-only triggers and `SELECT … FOR UPDATE` row locks (both documented below).                                                                                                       |
| ORM              | Prisma                                     | **As-is** – Prisma **6.19** (not 7)                               | Prisma 7 requires driver adapters + `prisma.config.ts` and changes the generated client layout; 6.x is the stable line every team member knows. Upgrading is a mechanical change isolated to `PrismaService`.              |
| Cache/queues     | Redis + BullMQ                             | **As-is** – Redis 7, ioredis 5, BullMQ 6 via `@nestjs/bullmq`     | Workers are registered manually so API-only processes can run without workers.                                                                                                                                             |
| Auth             | JWT access + refresh, OTP users, email/pwd | **As-is**                                                         | HS256 access tokens (15 min), opaque rotating refresh tokens stored hashed with family-based reuse detection. `@nestjs/jwt` directly (no Passport – one guard is simpler and fully typed).                                 |
| Password hashing | –                                          | bcryptjs (pure JS)                                                | Avoids native build steps in Docker/Windows; argon2 is a drop-in swap (`AuthService.hashPassword`).                                                                                                                        |
| Object storage   | S3-compatible (MinIO dev)                  | **As-is** – AWS SDK v3 + MinIO                                    | Browser → storage presigned PUT; the API never proxies media bytes. Presigned URLs are signed for the browser-reachable `S3_PUBLIC_ENDPOINT` (the host is part of a SigV4 signature); server-side calls use `S3_ENDPOINT`. |
| Payments in      | Chapa checkout                             | **As-is** shape, mocked without credentials                       | `PaymentGateway` interface; `ChapaGateway` calls the real initialize/verify endpoints when `CHAPA_SECRET_KEY` is set.                                                                                                      |
| Payouts          | telebirr + Chapa behind `PayoutProvider`   | **As-is** shape, mocked without credentials                       | Interface matches the spec signature exactly (plus optional metadata argument); registry with failover.                                                                                                                    |
| Push             | Firebase Cloud Messaging                   | FCM HTTP v1 via `fetch` (no firebase-admin SDK), mocked w/o creds | Smaller image; `firebase-admin` can replace `FcmPushAdapter` without touching callers.                                                                                                                                     |
| Validation       | –                                          | class-validator/class-transformer + zod for env                   | class-validator DTOs feed the Swagger CLI plugin so the OpenAPI file is generated from code.                                                                                                                               |
| Logging          | structured, security separation            | pino via nestjs-pino + separate `SecurityLogger` pino instance    | Security events are a separate stream (`channel: "security"`, optional file destination).                                                                                                                                  |
| Package manager  | –                                          | pnpm 11 workspaces, `nodeLinker: hoisted`                         | Flat `node_modules` is required by Expo/Metro in Phase 2. pnpm ≥ 10 reads settings from `pnpm-workspace.yaml`, so `.npmrc` only mirrors the setting for older tooling.                                                     |
| Hosting          | Docker Compose                             | **As-is**                                                         | `docker compose up -d --build` runs postgres, redis, minio (+bucket init) and the API (migrations applied on start).                                                                                                       |

## 2. System layout

```
apps/api/src
├── main.ts / app.setup.ts / swagger.ts / openapi-export.ts   bootstrap, global pipes/filters, OpenAPI
├── config/        env.ts (zod schema, defaults, production guards), app-config.ts (typed accessors), dotenv.ts
├── common/        AuthGuard (JWT + subject type + RBAC + account state), decorators, error envelope filter,
│                  Decimal/Date serializer, pagination helpers
├── infra/         prisma (lazy connect), redis (counters/rate limits), logger (+security channel),
│                  queue (BullMQ, manual worker registration), storage (S3 presign), sms (mock), push (FCM/mock)
└── modules/
    ├── auth           OTP, profile completion (age gate), advertiser/admin login, token rotation
    ├── users          profile, balance (ledger checksum), ledger history, notifications, push tokens, ad reports
    ├── ledger         ledger.core.ts (THE write path), LedgerService, reconciliation job + scheduler
    ├── fraud          rule engine (pure), FraudService (signals, flags, trust), /fraud endpoints
    ├── ads            feed eligibility (SQL), watch sessions, heartbeats, completion pipeline
    ├── offers         surveys (validated answers, immediate credit), app installs (pending verification)
    ├── campaigns      advertiser CRUD, budget reservation, creatives, analytics (raw vs fraud-filtered), lifecycle cron
    ├── wallet         advertiser wallet ledger (append-only, cached balance, idempotent)
    ├── billing        Chapa checkout (real/mock), webhook, payments, invoices, mock checkout page
    ├── withdrawals    request/hold, admin decisions (dual approval), PayoutProvider(s), registry, BullMQ worker
    ├── admin          review queue, campaign moderation, users/advertisers, fraud dashboard, withdrawal queue,
    │                  coin adjustments, revenue, audit log, config, ad reports, app-install verification
    ├── notifications  persistence + push dispatch through the notifications queue
    └── audit          AuditService (append-only audit_log rows, in the caller's transaction)
```

Background work runs inside the API process for the MVP (queues: `payouts`, `reconciliation`, `notifications`,
`fraud`) and can be split into a dedicated worker deployment by setting `QUEUES_ENABLED=false` on API replicas
(see `SCALING.md`).

## 3. Database schema rationale

`apps/api/prisma/schema.prisma` (snake_case tables/columns, camelCase in code). Every spec §4 entity exists with the
required columns; supporting tables and additions:

| Table                                           | Why it exists / notable decisions                                                                                                                                                                                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `users`                                         | Spec fields + `age_verification_status`, `trust_score` (0–100, default 50), `device_id`, `language_preference` (default `am`), `notification_prefs` JSON, `status_reason`, `last_ip`. `coin_balance` is a **cache** written only by the ledger core; DB `CHECK (coin_balance >= 0)`. |
| `otp_codes`                                     | Hashed code (`sha256(phone:code)`), expiry, attempt counter, consumed_at, requesting IP.                                                                                                                                                                                             |
| `refresh_tokens`                                | Hashed, single-use rotating tokens with `family_id`; presenting a revoked token revokes the whole family. Works for users, advertisers and admins (`subject_type`).                                                                                                                  |
| `admin_users`                                   | Spec fields + `full_name`, `active` (deactivation without deletion).                                                                                                                                                                                                                 |
| `advertisers`                                   | Spec fields + `password_hash`, verification metadata, cached `wallet_balance_etb`, `notification_prefs` JSON (editable via `PATCH /advertisers/me`).                                                                                                                                 |
| `advertiser_wallet_ledger`                      | **Append-only ETB ledger** of advertiser prepaid funds: `topup`, `campaign_budget_reservation`, `campaign_budget_refund`, `adjustment`. Advertiser balances are a normal B2B prepayment/receivable – distinct from user funds, which the platform never holds.                       |
| `advertiser_payments`, `invoices`               | Gateway checkout records (`tx_ref` unique → webhook idempotency; `return_url` stored so the mock checkout and real gateways send the browser back to the caller with `paymentId` + `txRef`) and JSON invoices issued per completed top-up.                                           |
| `campaigns`                                     | Spec fields + `cost_per_action_etb`, `take_rate_snapshot`, `attention_check_enabled`, review/pause metadata, `budget_reserved_etb`. `reward_per_action_etb = cost × (1 − take rate)` is snapshotted at creation so config changes never alter live campaigns.                        |
| `ads`                                           | Spec fields + `title`, `storage_key`, `thumbnail_url`, `banned_topics_checklist` JSON (structured reviewer checklist), `review_note`.                                                                                                                                                |
| `attention_questions`                           | Per-ad one-question checks (`prompt`, `prompt_am`, options JSON, `correct_index`); asked when the campaign has `attention_check_enabled`.                                                                                                                                            |
| `ad_watch_sessions`                             | **Server-recorded** `started_at`, heartbeats, expected duration, `expires_at`, device fingerprint, IP, user agent, status, chosen attention question, rejection code. Source of truth for timing.                                                                                    |
| `ad_completions`                                | Spec fields + `campaign_id` (analytics), `watch_session_id` (unique → one completion per session), `fraud_score`, `attention_answer_correct`, `reward_etb`, `cost_etb`, `rejection_code`. `status ∈ valid/flagged/rejected`; only `valid` is credited and charged.                   |
| `coin_ledger`                                   | Spec fields + **`idempotency_key` (unique)** – the last line of defence against double credits – and `CHECK (balance_after >= 0)`. UPDATE/DELETE blocked by trigger.                                                                                                                 |
| `coin_adjustment_requests`                      | Two-step manual adjustments: `requested_by`, `approved_by`/`rejected_by`, status, `ledger_entry_id` (unique) written on execution.                                                                                                                                                   |
| `ledger_reconciliation_runs`                    | History of the reconciliation job (users checked, drifts found).                                                                                                                                                                                                                     |
| `withdrawals`                                   | Spec fields + `review_reasons` JSON, `is_first_withdrawal`, `requires_dual_approval`, provider ids/raw status, attempts, links to the hold and reversal ledger entries. Status enum extended with `rejected`.                                                                        |
| `withdrawal_approvals`                          | One row per admin decision; `UNIQUE (withdrawal_id, admin_id)` enforces **two distinct admins** at the database level.                                                                                                                                                               |
| `surveys`, `survey_responses`                   | Questions in `details` JSON; one response per user per survey.                                                                                                                                                                                                                       |
| `app_install_offers`, `app_install_completions` | Installs are recorded as `pending_verification` and credited by an admin (no attribution SDK in this build).                                                                                                                                                                         |
| `fraud_flags`                                   | Spec fields + `metadata`, `trust_score_delta`, resolution (`dismissed/escalated/confirmed`) with resolver and note.                                                                                                                                                                  |
| `audit_log`                                     | Spec fields + `metadata`, `ip_address`; append-only trigger. Written inside the same transaction as the change wherever possible.                                                                                                                                                    |
| `notifications`, `device_push_tokens`           | In-app inbox (always persisted) + FCM tokens; push delivery status per notification.                                                                                                                                                                                                 |
| `ad_reports`                                    | Users report a bad ad (one per user per ad) → admin review queue, optionally pulling the ad.                                                                                                                                                                                         |
| `idempotency_keys` (4A)                         | Stored responses for `Idempotency-Key` money POSTs, unique per (actor, key); placeholder row inserted before the handler runs so concurrent duplicates collide; 24 h TTL, purged hourly.                                                                                            |
| `payout_destinations` (4A)                      | Per-user verified payout destinations: partner account name, `verified_at` (lookup), `otp_verified_at`, `last_used_at`/`use_count` (=> "known"). Withdrawals reference the row and snapshot `destination_account_name`.                                                              |
| `kyc_submissions` (4A)                          | Identity submissions: `id_type`, **hash + last 4 of the id number only**, name/DOB, private S3 keys for front/back/selfie, status, provider pre-check JSON, reviewer + reason. Partial unique index: one pending per user. `users.kyc_tier` is promoted on approval.                  |
| `legal_documents`, `user_consents`, `advertiser_consents` (4A) | Published terms/privacy versions per locale; consents per (subject, kind, version). "Current" = latest `published_at` per kind; ConsentGuard compares.                                                                                                                    |
| `platform_alerts` (4A)                          | Money-day alerts (type, severity, payload, dedupe key, per-notifier deliveries, acknowledgement).                                                                                                                                                                                       |
| `referrals` (4A)                                | referrer/referee (unique referee), code, status `pending → paid \| qualified \| rejected`, bonus coins, qualifying completion, signup IP/device for the fraud guards. `users.referral_code` unique 6-char code; `coin_ledger.source_type = referral`.                                    |
| `data_export_requests`, `account_deletion_requests` (4A) | Data-subject rights: async export archives (private S3 key, expiry) and deletion requests (grace period, executed/cancelled by whom). Partial unique index: one pending deletion per user. `users.anonymized_at` + `status = deleted` after execution.                     |
| `ads.media_*` (4A)                              | Pipeline state (`media_status`), `media_probe` JSON, declared vs probed duration, transcoded key, original URL, error, processed_at.                                                                                                                                                  |
| `campaigns.frequency_cap_per_user_per_day` (4A) | Advertiser-editable 1–5 (DB CHECK); default `DEFAULT_FREQUENCY_CAP`.                                                                                                                                                                                                                |

Types: ETB amounts are `Decimal(12,2)`; coins are `Int` (a single user would need > 21 million ETB to overflow –
documented upgrade path is `BigInt`). Ids are UUIDs; timestamps are UTC.

Migrations: `prisma/migrations/*_init` (generated), `*_append_only_guards` (hand-written triggers + CHECK constraints),
`*_payment_return_url_and_advertiser_prefs` (Phase 3 additive columns) and `*_phase4a_roadmap` (Phase 4A tables/columns
plus hand-written partial unique indexes and CHECKs). Triggers are the only non-portable SQL; they are documented here
as deliberate. Prisma interactive transactions run with a 20 s budget (`transactionOptions` in `PrismaService`)
because cold Docker volumes exceeded the 5 s default on the first admin decision after start-up.

## 4. Money & coin model

- `COINS_PER_ETB = 100` (env-overridable; exposed to clients in `/withdrawals/config`, `/users/me/balance`, `/admin/config`).
- Advertiser pays `cost_per_action_etb` per **valid** action. User reward `= cost × (1 − PLATFORM_TAKE_RATE)`, rounded
  half-up to 2 decimals, converted to whole coins. Platform revenue `= cost − reward`.

Worked example (defaults):

| Item                        | Value                                                       |
| --------------------------- | ----------------------------------------------------------- |
| Campaign budget             | 5 000.00 ETB (reserved from the wallet on submit)           |
| Cost per action             | 2.00 ETB                                                    |
| Reward per action           | 2.00 × (1 − 0.50) = **1.00 ETB = 100 coins**                |
| Platform revenue per action | 1.00 ETB                                                    |
| Actions the budget affords  | 2 500                                                       |
| User after 12 valid views   | 1 200 coins = 12.00 ETB (below 50 ETB minimum)              |
| Withdrawal of 60 ETB        | hold −6 000 coins immediately; payout via partner           |
| Failed payout               | reversing entry +6 000 coins (source `withdrawal_reversal`) |

**Single write path.** `applyLedgerEntry(tx, input)` in `modules/ledger/ledger.core.ts`:

1. `SELECT coin_balance FROM users WHERE id = $1 FOR UPDATE` – serialises every balance change of a user.
2. Idempotency check **after** the lock (`coin_ledger.idempotency_key` unique) → replay returns the existing entry.
3. `balance_after = cached + amount` (or `SUM(ledger) + amount` in reconciliation mode); negative → `INSUFFICIENT_BALANCE`.
4. Append the ledger row.
5. `UPDATE users SET coin_balance = balance_after` – the only such statement in the codebase (`ledger.guard.spec.ts`
   greps the source tree and fails if another appears).

Callers pass their own transaction so the business record (completion, withdrawal, adjustment) and the ledger row
commit atomically. Idempotency keys: `ad_completion:<watchSessionId>`, `survey_response:<id>`, `app_install:<id>`,
`withdrawal_hold:<id>[:retryN]`, `withdrawal_reversal:<id>:<attempt>`, `adjustment:<requestId>`, `reconcile:<runId>`,
`referral_referrer:<referralId>`, `referral_referee:<referralId>`.

Referral bonuses (4A) are a **platform cost**, not advertiser-funded: they are written with `source_type = referral`
inside the referee's first valid-completion transaction and reported separately in the revenue dashboard
(`referralBonusesEtb`, `netPlatformRevenueEtb = platformRevenue − referralBonuses`).

**Reconciliation.** Hourly BullMQ job (`RECONCILIATION_CRON`) compares `users.coin_balance` with `SUM(coin_ledger.amount)`
per user. Drift → `ledger.drift_detected` on the security channel, a `critical` `LEDGER_DRIFT` fraud flag, an audit row
and a run record. The job never "fixes" the cache silently; a repair is itself a ledger row (`source_type =
reconciliation`, `recomputeFromLedger`).

**DB-level enforcement.** Triggers raise on UPDATE/DELETE of `coin_ledger`, `advertiser_wallet_ledger`, `audit_log`;
`TRUNCATE` (used only by the dev seed reset) bypasses row triggers by design.

## 5. Ad-completion sequence

```
Client                                  API (server clock only)                          DB / Redis
  │ GET /ads/feed ─────────────────────► eligibility SQL: approved ad, active funded campaign,
  │                                      date window, not credited by this user; empty if daily cap
  │                                      reached or trust < FRAUD_MIN_TRUST_FOR_FEED
  │ POST /ads/:id/watch-sessions ──────► checks: eligible, daily cap, attempts/ad/day ≤ 3
  │  {deviceFingerprint}                 abandons other active sessions, records started_at, ip, ua,
  │                                      picks an attention question (if campaign enabled) ──────────► ad_watch_sessions
  │ ◄── sessionId, minWatchSeconds, heartbeatIntervalSeconds, expiresAt, attentionQuestion?
  │ POST …/heartbeat  (every N s) ─────► increments heartbeat_count (ignores spam faster than N/2)
  │ POST …/complete {answerIndex?} ────► 1. replay if session not active (returns stored result)
  │                                      2. verifyWatchSession(): daily cap → expiry → too long
  │                                         (duration×MAX_WATCH_RATIO+grace) → too short
  │                                         (< ceil(duration×MIN_WATCH_RATIO)) → heartbeat count/staleness
  │                                         → attention answer required/correct
  │                                         ✗ → rejected completion row + rejection code (no scoring)
  │                                      3. FraudService.collectCompletionSignals (device graph, IP velocity,
  │                                         user velocity, recent bad completions, account age, trust)
  │                                         evaluateCompletion() → score, outcome valid|flagged|rejected
  │                                      4. TRANSACTION: claim session (UPDATE … WHERE status='active'),
  │                                         lock user row, re-check daily cap + (user, ad) uniqueness,
  │                                         charge campaign atomically (UPDATE campaigns … WHERE
  │                                         spent+cost ≤ budget; pause on exhaustion), insert completion,
  │                                         valid → applyLedgerEntry(+coins), flagged/rejected → flags +
  │                                         trust delta, mark session completed/rejected
  │                                      5. after commit: velocity counters, notification, security log
  │ ◄── { status, coinReward, newBalance, reasonCode, fraudFlags, replayed }
```

Idempotency: the session claim is an atomic conditional update; a concurrent or repeated request finds the session
already claimed and replays the stored completion (`replayed: true`). The `watch_session_id` unique constraint and
the ledger idempotency key guarantee at most one credit even if application logic had a bug.

Retry policy: a _rejected_ completion does not block the ad (network hiccups happen); a user may start up to
`MAX_WATCH_ATTEMPTS_PER_AD_PER_DAY` sessions per ad per day. `valid` and `flagged` completions block the ad for that user
and count toward the daily cap.

## 6. Fraud engine

`modules/fraud/fraud.rules.ts` is pure and unit-tested; `FraudService` gathers signals and persists results.

| Rule id                        | Signal                                                        | Severity | Weight | Trust Δ |
| ------------------------------ | ------------------------------------------------------------- | -------- | ------ | ------- |
| `DEVICE_SHARED_ACCOUNTS`       | ≥ 3 distinct accounts used this device fingerprint in 30 days | high     | 45     | −10     |
| `IP_VELOCITY`                  | ≥ 30 completions from this IP in the last hour                | medium   | 25     | −5      |
| `RAPID_SEQUENTIAL_COMPLETIONS` | ≥ 12 completions by the user in the last hour                 | medium   | 20     | −3      |
| `LOW_TRUST_SCORE`              | trust score < 30                                              | medium   | 25     | 0       |
| `NEW_ACCOUNT_HIGH_VOLUME`      | account < 24 h old and already at ≥ 66% of the daily cap      | medium   | 20     | −3      |
| `HEARTBEAT_SPARSE`             | heartbeats between the hard minimum and 85% of expected       | low      | 15     | −1      |
| `EARLY_COMPLETION`             | completed after the minimum ratio but before the ad ended     | low      | 10     | 0       |
| `REPEAT_OFFENDER`              | ≥ 3 flagged/rejected completions in 7 days                    | high     | 30     | −5      |

Score = Σ weights (cap 100). `≥ FRAUD_REJECT_THRESHOLD (80)` → **rejected** (`FRAUD_REJECTED`), `≥ FRAUD_FLAG_THRESHOLD (40)`
→ **flagged** (not credited, reviewable), else valid (low hits are still recorded as informational flags without
trust penalty). Hard failures (`ATTENTION_CHECK_FAILED`, `DAILY_LIMIT_REACHED`) cost −2 trust.

Trust score (`computeTrustScore`): `50 + min(30, valid×0.5) + min(10, completedWithdrawals×2) − min(60, Σ open-flag
penalties [low 2, medium 5, high 15, critical 30])`, clamped 0–100; suspended ≤ 20, banned = 0. Recomputable via
`POST /fraud/users/:id/recompute-trust`. Feed access requires ≥ `FRAUD_MIN_TRUST_FOR_FEED (20)`.

Admin actions on a flag: **dismiss** (reverses the flag's trust penalty; when every flag on a _flagged_ completion is
dismissed the completion becomes valid and is credited through the ledger, charging the campaign), **escalate**
(−10 trust), **suspend user** (confirms the flag, suspends, recomputes trust). Manual flags can be created via
`POST /fraud/flags`. All actions are audited and mirrored on the security channel.

Other controls: OTP rate limits per phone/IP (Redis), withdrawal request limit per day, one in-flight withdrawal per
user, attempts per ad per day, refresh-token reuse detection, account status re-checked on every request.

## 7. Withdrawal / payout state machine

```
             request (user)                                        approve (finance/super_admin,
  ┌────────────────────────────────┐                                2 distinct admins if large)
  │ validate min/destination/method│     review reasons?  ──yes──► flagged_for_review ──────────┐
  │ rate limit, single in-flight,  │            │                        │ reject → rejected (hold reversed)
  │ TX: create + ledger hold −coins│            └──no──► pending ◄───────┘
  └────────────────────────────────┘                        │ BullMQ `payouts` worker
                                                            ▼ initiate via PayoutProviderRegistry (failover)
                                                       processing ──poll──► completed  (hold stays: money left)
                                                            │
                                                            └──────────► failed  (reversing ledger entry +coins,
                                                                                  notification, security log)
                                                                         └─ admin retry → new hold → pending
```

Review reasons: `first_withdrawal` (no previously completed withdrawal), `large_amount` (≥ `LARGE_WITHDRAWAL_THRESHOLD_ETB`,
sets `requires_dual_approval`), `low_trust_score` (< 30). Held requests are **never** auto-paid. Coins are held at
request time so a user cannot spend them twice; rejection/failure refunds via a reversing entry (never by deleting the
hold – the ledger is append-only).

`PayoutProvider` (spec §9 signature, `providers/payout-provider.ts`): `TelebirrPayoutProvider` (telebirr B2C
disbursement) and `ChapaPayoutProvider` (Chapa Transfers – banks and telebirr/CBE Birr wallets). Routing:
`telebirr → [telebirr, chapa]`, `cbe_birr → [chapa]`, `bank → [chapa]`; the registry fails over to the next partner
on error and logs `payout.provider_failover`. Mock mode (default) simulates async processing with a deterministic,
configurable failure rate.

## 8. Dual-approval workflows

**Large withdrawals** – `withdrawal_approvals` rows; `UNIQUE(withdrawal_id, admin_id)`; the service refuses a second
approval from the same admin (`DUAL_APPROVAL_SAME_ADMIN`) and only releases to `pending` once `approved` rows ≥ 2
(1 for non-large held requests). Only `finance`/`super_admin` may decide (`DUAL_APPROVAL_ROLE_REQUIRED`).

**Manual coin adjustments** – `POST /admin/coin-adjustments` creates `pending_approval` (nothing credited).
`POST …/:id/approve` by a **different** admin (`ADJUSTMENT_SELF_APPROVAL_FORBIDDEN` otherwise) atomically claims the
request (`UPDATE … WHERE status='pending_approval'`, so concurrent approvals execute at most once) and writes the ledger
entry with key `adjustment:<id>`; `reject` and requester `cancel` close it without touching the ledger. Every step is an
audit row containing both admin ids and the before/after state, plus security-channel events.

## 9. Advertiser funds, campaigns and billing

Prepaid model: advertisers top up a wallet through the gateway; **submitting** a campaign reserves its full budget
(wallet debit `campaign_budget_reservation`; `INSUFFICIENT_WALLET_BALANCE` otherwise). Each valid action increments
`campaigns.spent_etb` atomically (`UPDATE … WHERE spent + cost ≤ budget`); when the remaining budget cannot afford
another action the campaign is **paused** with `paused_reason = budget_exhausted` (the advertiser may raise the
budget – the extra is reserved – and resume). Rejection, completion (admin or end date via the hourly lifecycle cron)
refunds the unspent reservation (`campaign_budget_refund`). Wallet balance is a cache maintained exactly like the coin
ledger (`WalletService.applyEntry`).

Campaign lifecycle: `draft → pending_review → active ⇄ paused → completed`, or `rejected` (editable → back to draft).
Ads are reviewed independently (`pending → approved | rejected`); only approved ads of active campaigns are served.
Approval requires the reviewer to tick every banned topic (`BANNED_TOPICS` in `@rap/shared`), stored as structured
JSON on the ad. Analytics report `rawViews`, `rawCompletions`, `validCompletions`, `flaggedCompletions`,
`rejectedCompletions`, `fraudFilteredRate`, spend and daily buckets – the "we protect you from fake views" story.

Billing: `POST /billing/topups` → `advertiser_payments` (pending) → checkout URL (real Chapa or local mock page) →
webhook (`Chapa-Signature` HMAC verified, idempotent via `tx_ref` row lock, cross-checked with `verify`) →
`settlePayment` credits the wallet once and issues a paid invoice (`INV-YYYY-XXXXXXXX`, VAT line configurable, 0 by
default).

## 10. Auth, RBAC and account states

- Users: OTP (`+2519…/+2517…`, normalised to E.164). New numbers create a user; `profileComplete` is false until full
  name + DOB are set. **Age is computed server-side** (`calculateAge`, UTC); under `MIN_AGE` → `age_verification_status =
rejected`, all sessions revoked, `403 AGE_RESTRICTED` on every subsequent request. Money endpoints
  (`/ads`, `/offers`, `POST /withdrawals`) require `verified_adult` (`403 PROFILE_INCOMPLETE` otherwise).
- Advertisers/admins: email + password. Advertisers may log in and create drafts while `pending`, but cannot submit
  campaigns until verified (`403 ADVERTISER_NOT_VERIFIED`).
- Tokens: access JWT `{ sub, typ: user|advertiser|admin, role? }` (15 min); refresh tokens rotate on every use, reuse
  revokes the family (`401 REFRESH_TOKEN_REUSED`).
- `AuthGuard` (global) verifies the token, enforces `@Subjects()` and `@Roles()`, and re-reads account status on every
  request so suspension/ban/deactivation take effect immediately; admin roles are read from the DB (role changes need
  no re-login).
- RBAC matrix: see `docs/API.md` §Admin.

## 11. Logging, audit and observability

- Application logs: pino JSON (`channel: "app"`), pretty in dev (`LOG_PRETTY=true`), request logging with redaction.
- **Security channel**: a separate pino instance (`channel: "security"`, `SECURITY_LOG_PATH` for a dedicated file/stream)
  receiving typed events: OTP rate limits, refresh reuse, invalid credentials, age restriction, completion rejected/flagged,
  fraud flag created/resolved, trust changes, ledger writes/drift/insufficient balance, withdrawal review/decision/failure,
  adjustment requested/executed/self-approval blocked, admin moderation, webhook signature failures, provider failover.
- Audit log: every admin mutation and money-relevant system action (`audit_log`, append-only) with before/after JSON.
- Health: `/health` (liveness), `/health/ready` (Postgres + Redis, 503 when degraded).

## 12. Real vs mocked

| Integration              | Real implementation present                                                                                                                      | Mock behaviour (default in this build)                                                   | Switch                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| telebirr payouts         | `TelebirrPayoutProvider`: token → disbursement → status (endpoint paths per public merchant docs – **confirm with Ethio Telecom contract docs**) | `MOCK-TB-*` ids, async processing, deterministic failure rate `PAYOUT_MOCK_FAILURE_RATE` | `PAYOUTS_MOCK=false` + `TELEBIRR_APP_ID/APP_KEY/SHORT_CODE` |
| Chapa payouts            | `ChapaPayoutProvider`: `POST /v1/transfers`, `GET /v1/transfers/verify/:ref`                                                                     | `MOCK-CH-*` ids, same simulation                                                         | `PAYOUTS_MOCK=false` + `CHAPA_SECRET_KEY`                   |
| Chapa checkout (inbound) | `ChapaGateway`: `POST /v1/transaction/initialize`, `GET /v1/transaction/verify/:tx_ref`, webhook HMAC                                            | Local fake checkout page `/api/v1/billing/mock-checkout/:txRef` with pay/fail buttons    | `CHAPA_SECRET_KEY` (+ `CHAPA_WEBHOOK_SECRET` for webhooks)  |
| SMS OTP                  | `SmsProvider` interface                                                                                                                          | `MockSmsProvider` logs the code; `OTP_DEV_ECHO` returns it in the response               | Implement provider, set `SMS_PROVIDER`                      |
| Push (FCM)               | `FcmPushAdapter` (HTTP v1, service-account JWT)                                                                                                  | `MockPushAdapter` logs                                                                   | `FCM_PROJECT_ID` + `FCM_SERVICE_ACCOUNT_JSON`               |
| Object storage           | S3 SDK v3 presigned PUT                                                                                                                          | MinIO in docker compose (real S3 API)                                                    | `S3_*` env                                                  |
| App-install attribution  | –                                                                                                                                                | Installs recorded as `pending_verification`; admin verifies                              | Integrate an attribution SDK/postback in Phase 3            |
| Payout account lookup (4A) | `TelebirrPayoutProvider.resolveAccount` (customer query) / `ChapaPayoutProvider.resolveAccount` (`POST /v1/transfers/verify-account`) – shapes to confirm with partner docs | Deterministic Ethiopian holder name from the destination; numbers ending `0000` are "not found" | Same as payouts (`PAYOUTS_MOCK=false` + credentials) |
| Identity verification (4A) | `FaydaProvider` (OAuth2 client credentials → `/v1/ekyc/verify`; NIDP onboarding needed)                                                        | `MockFaydaProvider`: id tail `00` not found, `99` name mismatch (0.4), else match (0.97). Admin decision is authoritative either way | `ID_VERIFICATION_PROVIDER=fayda` + `FAYDA_CLIENT_ID/SECRET` |
| Alert delivery (4A)      | `TelegramNotifier` (Bot API `sendMessage`), `WebhookNotifier` (Slack-compatible JSON)                                                            | `LogNotifier` writes alerts to the application log; alerts are always persisted + on the security channel | `ALERT_TELEGRAM_BOT_TOKEN`+`ALERT_TELEGRAM_CHAT_ID` and/or `ALERT_WEBHOOK_URL` |
| Media processing (4A)    | Real ffprobe/ffmpeg (`apk ffmpeg` in the image; `pnpm media:tools` on dev machines)                                                             | Not mocked (tests fake the tool wrapper)                                                 | –                                                           |

The effective mock flags are exposed at `GET /admin/config` (`mocks`) and logged at boot.

## 12b. Phase 3 integration notes

The three frontends (Expo mobile app, advertiser portal, admin dashboard) were built against the Phase 1 contract and
merged into `main`. Gaps they reported were closed in the API rather than worked around:

- `S3_PUBLIC_ENDPOINT` for presigned uploads (browser-reachable host in the signature); the portal's dev proxy is now opt-in.
- Mock Chapa checkout: CSP-compliant external script (`/billing/mock-checkout/assets/checkout.js`), honours the caller's
  `returnUrl` and appends `paymentId` + `txRef`.
- Boolean query parameters are parsed with `ToBoolean` (`?resolved=false` used to coerce to `true`).
- New endpoints: `GET/PATCH /advertisers/me`, `POST /auth/advertiser/change-password`, `GET /admin/advertisers/:id/wallet`,
  `GET /users/me/recently-watched`; admin login returns `roles`/`permissions`; `/admin/config` exposes `payoutMaxAttempts`
  and the campaign/top-up minimums.
- `@rap/shared` is the single source of truth for minimums (`MIN_CAMPAIGN_BUDGET_ETB`, `MIN_COST_PER_ACTION_ETB`,
  `MIN_TOPUP_ETB`, `PAYOUT_MAX_ATTEMPTS`) and declares every field the API returns (`PaymentItem.mock`, `TopupResponse.returnUrl`,
  `AdReviewItem.reviewNote`/`bannedTopics`, withdrawal `bankCode`/`attempts`, user `lastIp`, `AdminCampaignDetail`).
- Demo media is self-hosted: `prisma/seed-assets` (synthetic H.264 clips + PNG thumbnails, ~0.5 MB, regenerated with
  `seed-assets/generate.ps1` in an ffmpeg container) is uploaded to the MinIO bucket by the seed.
- Monorepo hygiene with a hoisted `node_modules`: the apps pin the same `react`/`react-dom` (19.2.3, required by Expo
  SDK 57) and share one `vitest` major, otherwise singleton libraries resolve to different copies.
- Docker compose now includes nginx-served static builds of both portals (`advertiser-web` :5173, `admin-web` :5174).

## 12c. Phase 4A – post-test roadmap (backend)

Ten features built after the 63-item manual test pass, all backwards compatible (new endpoints, optional fields,
new error codes). Frontends are built against `docs/API.md` / `docs/openapi.json` / `@rap/shared` (`types/phase4.ts`).

**1. Idempotency keys.** `IdempotencyInterceptor` (global, opt-in per handler with `@Idempotent()`) on the four money
POSTs. A placeholder row is inserted in `idempotency_keys` before the handler executes, so two identical requests
racing each other collide on `UNIQUE (actor_type, actor_id, key)` – the loser gets `409 IDEMPOTENCY_KEY_REUSED
{ inProgress: true }` instead of executing twice. Finished responses are replayed (serialized body + status,
`Idempotent-Replayed: true`); a different payload under the same key is a `409`; failures release the key. This sits
_in front_ of the ledger's own `idempotency_key` column, which remains the last line of defence.

**2. Destination verification.** `PayoutProvider.resolveAccount()` was added to the spec interface (telebirr customer
query / Chapa account verification; deterministic MOCK names). `DestinationsService` stores per-user
`payout_destinations`; a destination is _known_ once a withdrawal to it was successfully requested. NEW destinations
need `verified_at` (lookup) **and** `otp_verified_at` (OTP with `purpose = destination_change`, reusing the OTP table
and rate limits) within `DESTINATION_RESOLVE_TTL_MINUTES` (10), otherwise `422 DESTINATION_NOT_VERIFIED` /
`DESTINATION_OTP_REQUIRED`. The withdrawal snapshots `destination_account_name` / `destination_verified_at`, so finance
sees the partner-confirmed holder name in the review queue. Registry routing/failover applies to lookups too, except
that a partner "account not found" is authoritative (no failover).

**3. KYC tiers.** `users.kyc_tier ∈ phone_only | id_verified`. Rule (`KycService.evaluateThreshold`, pure): for
`phone_only` users, completed + in-flight (`pending`, `processing`, `flagged_for_review`) payouts requested in the
rolling 30 days plus the new request must stay **strictly below** `KYC_REQUIRED_ABOVE_MONTHLY_ETB` (1 000); a projected
total **at or above** the threshold → `422 KYC_REQUIRED`. The boundary is inclusive by product decision (Phase 4D, QA
finding P4-F1: exactly 1 000 ETB requires KYC); the env variable keeps its historical name for compatibility.
Documents are uploaded with presigned PUTs into the **private** prefix (`private/kyc/<user>/…`), never served publicly;
admins receive 5-minute presigned GET links. Only `sha256(idType:idNumber)` + the last 4 digits are stored; a matching
hash on another account opens a `KYC_DUPLICATE_IDENTITY` (high) flag. `IdVerificationProvider` (`MockFaydaProvider`
today) gives an advisory pre-check; approval by support/finance/super_admin promotes the tier in the same transaction.

**4. Consent.** `legal_documents` (kind, version, locale) with "current = latest published per kind". `LegalService`
computes `consents[]`/`requiresConsent[]` (embedded in `UserProfile`); `ConsentGuard` (second global guard, opt-in with
`@RequireConsent()`) returns `403 CONSENT_REQUIRED` on `/ads/*`, `/offers/*` and `POST /withdrawals`. Advertisers accept
`terms` (`termsVersion` at registration or `POST /advertisers/me/consents`); campaign submit enforces it. Publishing a
new version automatically re-prompts everyone. Fresh installs without legal documents require nothing.

**5. Money-day alerting.** `AlertService.raise()` persists to `platform_alerts`, mirrors on the security channel and
fans out to `Notifier`s (`TelegramNotifier`, `WebhookNotifier`, `LogNotifier` fallback); the same `dedupeKey` is
suppressed for `ALERT_DEDUPE_MINUTES`. Rules (`alert.rules.ts`, pure and unit-tested) run every `ALERT_RULES_CRON` on
the `alerts` queue: payout failure rate over the last hour (> `ALERT_PAYOUT_FAILURE_RATE`, ≥ `ALERT_PAYOUT_MIN_SAMPLE`
finished payouts), account minting (> `ALERT_ACCOUNTS_PER_DEVICE_PER_HOUR` signups sharing `signup_device_fingerprint`),
spend velocity (last-hour campaign spend > `max(multiplier × trailing-7-day hourly average, ALERT_SPEND_VELOCITY_MIN_ETB)`),
OTP spike per IP. Ledger drift raises `LEDGER_DRIFT` directly from the reconciliation job. Admins acknowledge alerts.

**6. Frequency capping.** Two caps per UTC day, both in the feed eligibility SQL _and_ re-checked under the user row
lock inside the completion transaction (`FREQUENCY_CAP_REACHED`): per campaign (`frequency_cap_per_user_per_day`,
advertiser-editable 1–5, default `DEFAULT_FREQUENCY_CAP`) and per advertiser (distinct ads,
`ADVERTISER_IMPRESSION_CAP_PER_USER_PER_DAY`). `valid` and `flagged` completions count. The feed reports
`meta.hiddenByFrequencyCap` (eligible-without-caps − eligible) for the "come back tomorrow" empty state.

**7. Media pipeline.** Video creatives are created `processing`; the `media` queue job downloads the object, runs
ffprobe (duration/codec/dimensions → `media_probe`), corrects `duration_seconds` when off by more than
`MEDIA_DURATION_TOLERANCE_SECONDS` (`duration_corrected`), transcodes to 720p H.264/AAC MP4 (`…/processed/<adId>/
transcoded.mp4` becomes `media_url`; the upload stays as `original_media_url`) and renders a poster when no thumbnail
was given. The job is time-boxed (`MEDIA_JOB_TIMEOUT_SECONDS`), runs with concurrency 1 and marks `failed` with the
error. Review refuses approval while `processing`/`failed` (`422 MEDIA_NOT_READY`); admins can `reprocess-media`.
Binaries: `apk ffmpeg` in the image (`MEDIA_FF*_PATH`), `pnpm media:tools` on developer machines (kept out of the
workspace lockfile because the 150 MB static packages repeatedly timed out inside Docker builds).

**8. Referrals.** Every user gets a 6-char code (unambiguous alphabet). `POST /auth/otp/verify` accepts
`referralCode` on the **first** login only (validated before any write). Nothing is credited at signup: the referee's
first `valid` completion transaction calls `ReferralsService.onValidCompletion(tx)` which (a) rejects + flags both
accounts (`REFERRAL_SELF_REFERRAL`, −5 trust) when the referee shares the referrer's signup device/IP or any device/IP
the referrer ever watched from, (b) withholds the bonus (`qualified`) when the referrer is inactive or already has
`REFERRAL_MAX_PER_REFERRER_PER_DAY` paid referrals today, otherwise (c) writes both bonuses through `applyLedgerEntry`
(`source_type = referral`, unique keys per referral) and marks `paid`. Status semantics: `pending` → `paid` (credited) |
`qualified` (withheld, not fraud) | `rejected` (fraud guard).

**9. Ethiopian calendar.** `@rap/shared/ethiopian-calendar` converts via Julian Day Numbers (exact both ways;
Pagume 5/6, leap year `year % 4 === 3`, tested over a full 4-year cycle). `complete-profile` and KYC accept
`dateOfBirthEthiopian`; the API stores Gregorian and echoes `dateOfBirthEthiopian` in `UserProfile`.

**10. Ops tooling.** `scripts/backup.{ps1,sh}` (pg_dump + `mc mirror`) / `scripts/restore.{ps1,sh}` with a documented
drill in `docs/RUNBOOK.md`. Data rights: async export archives (gzip JSON under `private/exports/`, presigned link,
retention), deletion requests with a `ACCOUNT_DELETION_GRACE_DAYS` grace period executed by the `data-rights` job or by
support; execution anonymises PII and keeps ledger/completions/withdrawals/audit (financial records that no longer
identify a person). Support impersonation: `typ: impersonation` JWT with `actorAdminId`, 10 minutes, no refresh token;
the guard treats it as the user for GET only, audits every request and refuses mutations (`IMPERSONATION_READ_ONLY`).

**Findings.** F2: access-token denylist in Redis (`tokens_invalid_before:<subject>` on suspension/ban/age
rejection/refresh reuse; `denied_jti:<jti>` on logout) checked by the guard on every request (fails open if Redis is
down – tokens are 15-minute and account status is re-read anyway). F3: completion replays carry the current balance.
F4: the demo flow uploads a real seed MP4 and waits for the pipeline. F10: seed spend is derived from generated
completions for every campaign (the completed AddisPay campaign refunds its unspent reservation only once the real
spend is known).

## 12d. Phase 4B/4C – frontends integrated, contract gaps closed

The three Phase 4B frontend branches (advertiser `505c1c7`, admin `7315585`, mobile `9140d8e`) were merged without
conflicts. Gaps they reported were closed in the API (all backwards compatible):

- `POST /withdrawals { payoutDestinationId }` – a known destination is referenced by id and resolved server-side, so
  the mobile app no longer stores full payout numbers on the device (it keeps a display-only memory).
- OTP business errors are `400` everywhere (`/auth/otp/verify` and destination OTP); `401` is reserved for token
  problems; `INVALID_CREDENTIALS` on the login endpoints stays `401` by convention.
- `referredBy.bonusCoins` quotes the configured referee bonus while `pending`; `GET /users/me/delete-request` always
  returns `{ request }`; `KycPresignResponse.kind` typed.
- `409 IDEMPOTENCY_KEY_REUSED` carries `resourceId` once the first request finished (while it is still running the id
  is unknown – the window is sub-second, clients simply retry the same request).
- Admin: deletion execute/cancel return the list-row shape; `AuditLogItem.actorLabel` + `GET /admin/audit-log?actor=`
  resolved server-side (unknown actor ⇒ empty page, `meta.actorResolved: false`); `AdminOverview` carries the Phase 4
  queue counters (one request for every sidebar badge); `AdminKycDetail.duplicateIdentityUsers` lists the accounts;
  `?mediaStatus=` on the review queue; `GET /admin/alerts` readable by every admin role (ack: support/finance/super;
  run-rules: super) and admin `permissions[]` extended accordingly.
- Deferred on purpose: the admin audit page still resolves the actor client-side before calling the API (its
  MSW-tested flow asserts `actorId=`); switching it to `actor=` is a UI-only follow-up now that the server supports it.

## 13. Assumptions

1. **Prepaid advertiser model**: the full campaign budget is reserved from the wallet at submit time; unspent budget is
   refunded on rejection/completion. Per-action spend is tracked on the campaign, not as individual wallet rows.
2. **Flagged completions are not credited** until a fraud reviewer dismisses the flags (then credited via the ledger);
   they count toward the daily cap and block re-watching, so probing is not rewarded.
3. **Daily cap counts `valid + flagged`** completions per UTC day (`DAILY_AD_COMPLETION_LIMIT`, default 15).
4. **Attention check** is deterministic per campaign (`attention_check_enabled` ⇒ a question is asked on every watch of
   an ad that has questions; the question is chosen at random among the ad's questions – not a reward chance).
5. **Budget exhaustion pauses** the campaign (`paused_reason = budget_exhausted`) rather than completing it, so the
   advertiser can top up and resume; end dates complete campaigns.
6. **First-ever withdrawal** = the user has no _completed_ withdrawal yet (so every attempt is reviewed until one succeeds).
7. **One in-flight withdrawal per user** and `DAILY_WITHDRAWAL_REQUEST_LIMIT=3` requests/day.
8. **Failed payouts refund immediately**; an admin `retry` takes a fresh hold. `completed` never refunds (money left).
9. **Withdrawal status enum extended** with `rejected`; `LedgerSourceType` extended with `withdrawal_reversal` and
   `reconciliation`; `PayoutMethod` = `telebirr | cbe_birr | bank`.
10. **Coins are 32-bit integers**; ETB is `Decimal(12,2)`; rounding is half-up to 2 decimals.
11. **VAT** is not applied to top-ups by default (`INVOICE_VAT_RATE=0`, invoices show a VAT line when configured, amounts
    treated as VAT-inclusive) – to be confirmed with finance/legal.
12. **Language codes**: `am` (default), `en`, `om`, `ti`. Survey/attention prompts carry optional Amharic variants; other
    user-facing text is localised client-side from `code`s.
13. **Admin roles** as spec; `super_admin` can do everything. Withdrawal decisions: `finance`/`super_admin`; ad review:
    `ad_reviewer`/`super_admin`; user/advertiser moderation: `support`/`super_admin`; fraud actions: `support`/`finance`/`super_admin`.
14. **Health endpoints live at `/health`** (outside the `/api/v1` prefix) for load balancers.
15. **Time zone**: all daily buckets/caps use UTC days (Ethiopia is UTC+3 year-round; a product decision may later move
    caps to local days – a one-line change in `utcDayKey`).
16. Sample ad media are self-hosted synthetic clips (see §12b).
17. **Phase 4A**: KYC threshold counts completed + in-flight payouts by `requested_at` in a rolling 30-day window; the
    referrer's daily cap counts `paid` referrals per UTC day; referral bonuses are a platform cost line; consent is
    per (kind, version) and any newly published version re-prompts all accounts; deletion keeps financial records
    (ledger, completions, withdrawals with anonymised destination, audit) – legal basis to be confirmed; frequency caps
    count `valid + flagged` completions; the media pipeline keeps the original upload alongside the transcode.

## 14. Production-readiness checklist

Money/legal

- [ ] Sign telebirr business API and Chapa merchant agreements; obtain sandbox credentials; confirm telebirr B2C endpoint
      paths/field names against the contract documentation and run `PAYOUTS_MOCK=false` in staging.
- [ ] Confirm the account-name lookup endpoints (`resolveAccount`) with both partners – the request/response shapes are
      modelled on public docs and MUST be validated before payouts to new destinations go live.
- [ ] Register the Chapa webhook URL and set `CHAPA_WEBHOOK_SECRET`; add a reconciliation job comparing gateway
      settlements with `advertiser_payments`.
- [ ] Finance sign-off on take rate, VAT treatment of top-ups/invoices, invoice numbering and statement exports; decide
      the referral programme budget (`REFERRAL_BONUS_COINS`, `REFEREE_BONUS_COINS`, daily cap).
- [ ] Legal review of the seeded terms/privacy texts (v1.0 placeholders in en/am; add om/ti), the data-retention basis
      for anonymised financial records, and the KYC threshold (`KYC_REQUIRED_ABOVE_MONTHLY_ETB`) under NBE rules.
- [ ] Fayda / NIDP relying-party onboarding to replace `MockFaydaProvider`; decide which id types are acceptable.
- [ ] Legal review of age verification (self-declared DOB today – consider ID verification for large withdrawals),
      terms of service, privacy notice (device fingerprints, IP retention) under Ethiopian data-protection rules.
- [ ] Payout KYC: destination-name matching (telebirr name lookup), sanctions/duplicate-destination checks.

Security

- [ ] Replace dev secrets (`JWT_ACCESS_SECRET`), disable `OTP_DEV_ECHO`/`OTP_DEV_FIXED_CODE` (enforced by the env schema).
- [ ] Real SMS provider with delivery receipts; OTP brute-force monitoring dashboards from the security channel.
- [ ] Rotate refresh tokens' storage to a stricter TTL policy; consider device binding.
- [ ] Rate limiting at the edge (API gateway/WAF) in addition to Redis counters; Helmet CSP tuned for Swagger.
- [ ] Admin MFA (TOTP) and IP allow-listing for `/admin/*`; admin session audit.
- [ ] Secrets in a vault (not `.env` on hosts); TLS termination; database roles with least privilege (the API role
      should not own the append-only tables' triggers).

Data/infra

- [ ] Managed PostgreSQL with backups + PITR; run `prisma migrate deploy` in CI/CD; connection pooling (PgBouncer).
- [ ] Managed Redis (persistence for BullMQ); separate worker deployment (`QUEUES_ENABLED`).
- [ ] S3 bucket policy: public read of creatives only, upload size/MIME validation (server-side head check after upload),
      antivirus scanning of creatives, CDN in front of media.
- [ ] Observability: ship `channel=security` to SIEM, metrics (completions/min, flagged rate, payout failures, queue
      depth), alerting on `LEDGER_DRIFT`.
- [ ] Load testing of the completion path (row locks per user are cheap, but confirm p95 under burst).

Product/fraud

- [ ] Tune fraud thresholds with real data; add device attestation (Play Integrity / App Attest) to the fingerprint.
- [ ] App-install attribution (postback) instead of manual verification.
- [x] Ad media transcoding pipeline (Phase 4A: ffprobe duration correction + 720p H.264 transcode + poster).
- [ ] Tune alert thresholds (`ALERT_*`) after a few weeks of real traffic; route Telegram/webhook alerts to an on-call
      rotation; consider paging for `critical`.
- [ ] Media pipeline hardening: virus scan before transcode, multiple renditions (360p for low-end devices), CDN.
- [ ] Localised notification copy (currently English templates; clients localise UI from codes).
- [ ] Denylist durability: `tokens_invalid_before` lives in Redis with the access-token TTL; if Redis is flushed within
      15 minutes of a ban the old token works until expiry – acceptable for MVP, revisit with Redis persistence.
