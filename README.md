# Gize — Rewarded Advertising Platform (Ethiopia)

> **Brand placeholder.** "Gize" (Amharic ጊዜ, "time" — «ጊዜዎ ዋጋ አለው», "your time has value") is a working name.
> It lives in one constant per app (`apps/mobile/src/config.ts`, the web apps' `src/config`), the mobile `app.json`
> and the i18n `appName` keys. Rename there before launch.

Gize connects three participants around one PostgreSQL database and one REST API:

- **Advertisers** — Ethiopian businesses prepay a wallet and run video-view, survey and app-install campaigns.
- **Users** — everyday people who watch ads and complete offers in a mobile app, earning **coins (100 coins = 1 ETB)**
  that they withdraw to telebirr / CBE Birr / bank accounts through licensed payout partners.
- **The platform** — keeps 50% of every advertiser payment; the rest funds user rewards. It **never holds user funds**:
  every payout is executed by a partner behind a `PayoutProvider` interface.

Every rule in the money and fraud logic traces to the product specification in [`docs/SPEC.md`](docs/SPEC.md).
Architecture, decisions and assumptions live in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md); the API contract in
[`docs/API.md`](docs/API.md) + [`docs/openapi.json`](docs/openapi.json); growth notes in [`docs/SCALING.md`](docs/SCALING.md).

## Architecture

```
  ┌──────────────────────┐   ┌──────────────────────────┐   ┌──────────────────────────┐
  │  Mobile app (Expo)   │   │ Advertiser portal (Vite) │   │  Admin dashboard (Vite)  │
  │  :8081 web / device  │   │  :5173                   │   │  :5174                   │
  └──────────┬───────────┘   └────────────┬─────────────┘   └────────────┬─────────────┘
             │  REST /api/v1 · Bearer JWT · error envelope {statusCode, code, message}   │
             └─────────────────────────────┬───────────────────────────────────────────┘
                                           ▼
             ┌─────────────────────────────────────────────────────────────────┐
             │  NestJS API  :3000  (Swagger /api/docs)                          │
             │  auth · users · ads · offers · campaigns · billing ·             │
             │  withdrawals · kyc · legal · referrals · alerts · media ·        │
             │  data-rights · admin · fraud  +  BullMQ workers (payouts,        │
             │  notifications, reconciliation, alert rules, media, data-rights) │
             └───────┬──────────────────┬──────────────────────┬──────────────┘
                     ▼                  ▼                      ▼
             PostgreSQL 16       Redis 7 (rate limits,     MinIO / S3 (creatives,
             Prisma · append-    velocity counters,        presigned browser uploads,
             only ledgers        queues)                   public read)
                     │
     external partners behind interfaces (mocked without credentials):
     telebirr & Chapa payouts + account lookup · Chapa checkout (advertiser top-ups) · SMS OTP ·
     Firebase Cloud Messaging · Fayda id verification · Telegram / webhook alert delivery
```

## Workspaces

| Path                  | Package               | What it is                                                                                                                                                                       | README                                                         |
| --------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `apps/api`            | `@rap/api`            | NestJS 12 · Prisma 6 · PostgreSQL 16 · Redis 7 · BullMQ 6. Single transactional coin ledger, server-side ad verification, fraud engine, dual-approval workflows, audit log; Phase 4: idempotency keys, destination verification, KYC tiers, consent, alerts, frequency caps, media pipeline, referrals, Ethiopian calendar, data rights, impersonation | [apps/api/README.md](apps/api/README.md)                       |
| `apps/mobile`         | `@rap/mobile`         | Expo SDK 57 / React Native user app: Amharic-first (am/en/om/ti), onboarding + OTP, feed, server-timed player, wallet, withdrawals (destination confirm + OTP, known chips), offers, notifications; Phase 4: consent screen, Ethiopian DOB picker, KYC upload, referrals, privacy (export / delete) | [apps/mobile/README.md](apps/mobile/README.md)                 |
| `apps/advertiser-web` | `@rap/advertiser-web` | React 19 + Vite + Tailwind v4 portal: campaign wizard with presigned uploads + frequency cap, media processing status, raw-vs-fraud-filtered analytics, wallet top-ups (idempotent), invoices, terms acceptance | [apps/advertiser-web/README.md](apps/advertiser-web/README.md) |
| `apps/admin-web`      | `@rap/admin-web`      | React 19 + Vite + Tailwind v4 internal console: RBAC, review queue (banned-topics checklist, media status), fraud dashboard, dual-approval withdrawals and coin adjustments, revenue, audit; Phase 4: KYC queue, alerts, referrals, deletion requests, read-only impersonation | [apps/admin-web/README.md](apps/admin-web/README.md)           |
| `packages/shared`     | `@rap/shared`         | The contract: enums, `ErrorCode`, `PLATFORM_DEFAULTS`, money helpers, `API_ROUTES`, request/response types (CJS + ESM)                                                           | [packages/shared/README.md](packages/shared/README.md)         |

Infrastructure lives at the root: `docker-compose.yml`, `.env.example`, `scripts/` (`demo.ps1`, `demo-flow.mjs`,
`smoke.ps1`, `backup.*`, `restore.*`, `install-media-tools.mjs`, `run-workspace.mjs`), `docker/nginx-spa.conf`;
operations in [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

## One-command start (whole stack in containers)

Prerequisites: Docker Desktop (Compose v2+). For development also Node.js ≥ 24.9 and pnpm ≥ 10.

```powershell
Copy-Item .env.example .env        # cp .env.example .env on macOS/Linux; change POSTGRES_PORT if 5432 is taken. REQUIRED: compose has no default credentials (POSTGRES_*, S3_*, REDIS_PASSWORD - keep REDIS_URL's password in sync)
docker compose up -d --build       # postgres, redis, minio (+bucket), api (migrations run on start), advertiser-web, admin-web
pnpm install
pnpm --filter @rap/api seed        # demo data + self-hosted demo videos (or set RUN_SEED=true in .env before the first start)
```

| Surface               | URL                            | Notes                                                          |
| --------------------- | ------------------------------ | -------------------------------------------------------------- |
| API + Swagger UI      | http://localhost:3000/api/docs | OpenAPI JSON at `/api/docs-json`; health `/health/ready`       |
| Advertiser portal     | http://localhost:5173          | nginx static build (`docker compose`) or `pnpm dev:advertiser` |
| Admin dashboard       | http://localhost:5174          | nginx static build (`docker compose`) or `pnpm dev:admin`      |
| Mobile app (Expo web) | http://localhost:8081          | `pnpm dev:mobile` (dev server; scan the QR for a device)       |
| MinIO console         | http://localhost:9001          | `S3_ACCESS_KEY` / `S3_SECRET_KEY` from `.env` (loopback only); bucket `rap-media` (anonymous read: `creatives/*`, `seed/*`) |

## Development mode

```powershell
pnpm install                                  # builds @rap/shared too
pnpm demo                                     # checks Docker, starts infra, migrates, seeds, starts the API, prints URLs + credentials
pnpm dev                                      # or: API + advertiser portal + admin dashboard concurrently (watch mode)
pnpm dev:mobile                               # Expo web on :8081 (EXPO_PUBLIC_API_URL defaults to http://localhost:3000)
```

| Command                                                     | What it does                                                                                  |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build` | Fan out to every workspace (`scripts/run-workspace.mjs`)                                      |
| `pnpm --filter @rap/api test:e2e`                           | Supertest e2e against the live database (skips when unreachable)                              |
| `pnpm smoke`                                                | `scripts/smoke.ps1`: 21-step user money flow (consent, watch, destination lookup + OTP, payout) |
| `node scripts/demo-flow.mjs`                                | Cross-surface investor demo journey (see below) with assertions                               |
| `pnpm --filter @rap/api seed`                               | Reset + seed demo data and upload the demo media to MinIO (**destructive**, development only) |
| `pnpm --filter @rap/api openapi:export`                     | Regenerate `docs/openapi.json` from the code                                                  |
| `pnpm media:tools`                                          | Install desktop ffmpeg/ffprobe for the media pipeline when running the API outside Docker     |
| `pwsh scripts/backup.ps1` / `scripts/restore.ps1`           | Database dump + bucket mirror, and the restore drill (see `docs/RUNBOOK.md`)                  |

Test counts (all green): API 391 Jest unit tests + 8 e2e · mobile 145 Jest · advertiser portal 106 Vitest · admin
dashboard 110 Vitest · shared 12.

## Demo credentials (seeded)

| Role                                   | Login                                                            | Password         |
| -------------------------------------- | ---------------------------------------------------------------- | ---------------- |
| Admin – super_admin                    | `super@rap.et`                                                   | `Admin123!`      |
| Admin – ad_reviewer                    | `reviewer@rap.et`                                                | `Admin123!`      |
| Admin – support                        | `support@rap.et`                                                 | `Admin123!`      |
| Admin – finance (×2 for dual approval) | `finance@rap.et`, `finance2@rap.et`                              | `Admin123!`      |
| Advertiser (verified)                  | `ads@habesha-coffee.et`, `growth@addisfintech.et`                | `Advertiser123!` |
| Advertiser (pending review)            | `hello@shegerfashion.et`                                         | `Advertiser123!` |
| Users (phone + OTP)                    | `+251911000000`, `+251911000137`, `+251911000274`, … (25 seeded) | OTP — see below  |

User login is phone + OTP. SMS is mocked: with `OTP_DEV_ECHO=true` the code is returned as `devCode` and shown under
the OTP boxes in development builds; `OTP_DEV_FIXED_CODE=123456` also works for any number (both refused in
production). Any new Ethiopian number creates a fresh user. Seeded fraud cases: `+251911002466/2603/2740` share a
device (open flags), `+251911003151` is banned, `+251911002877` / `+251911003014` are suspended, `+251900000017` is
age-rejected.

Phase 4 demo data (seeded):

| Feature              | Where to look / who to log in as                                                                                                                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Legal / consent      | Terms + privacy **v1.0** in `en` and `am`; every seeded account already consented – a **new** phone number gets the consent screen before the feed                                                                                             |
| KYC                  | Admin → KYC queue: pending `+251911001233` (Fayda), `+251911001644` (national id), `+251911001918` (Fayda, mock registry name mismatch); approved / `id_verified`: `+251911000137`, `+251911000411`, `+251911000685`; rejected `+251911002192` |
| Referrals            | `+251911000137` (code `779HLB`) has 2 paid referrals, `+251911000411` (`88CJ7D`) 1; pending (`+251911000548`, `+251911000822`), withheld – daily cap (`+251911000959`), rejected – shared device (`+251911002466` → `+251911002740`)           |
| Alerts               | Admin → Alerts: `PAYOUT_FAILURE_RATE` (acknowledged), `ACCOUNT_MINTING` critical, `SPEND_VELOCITY`, `OTP_SPIKE` open; "Run rules now" as `super@rap.et`                                                                                        |
| Deletion requests    | Admin → Deletion requests: `+251911002192` pending (grace period running)                                                                                                                                                                      |
| Payout destinations  | Users with withdrawal history (e.g. `+251911000137` telebirr, `+251911000411` bank) have **known** destinations (one-tap chip); any other number is new → partner lookup + OTP; in MOCK mode a number ending in `0000` is "not found"          |
| Media pipeline       | Upload any MP4 in the portal wizard: probe → duration correction → 720p transcode → poster (`processing` badge until done; review refuses approval before)                                                                                     |
| Impersonation        | Admin → Users → any user → "Impersonate" (support / super_admin, reason required) → read-only banner                                                                                                                                             |

Phase 5 (security remediation) demo data and switches:

| Feature                       | Where to look / how to try it                                                                                                                                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payout needing manual review  | Admin → Withdrawals → **Needs manual review** tab: `+251911001644` (110 ETB, "MOCK: telebirr request timed out") – "Mark completed" keeps the hold, "Mark failed & refund" returns the coins (finance / super_admin)                           |
| Admin MFA                     | Admin → **My security** (any admin) → "Set up" → paste the key into an authenticator app (or compute a code with `node -e "console.log(require('otplib').authenticator.generate('<secret>'))"` from `apps/api`) → "Turn on"; the next login asks for the 6-digit code. `ADMIN_MFA_REQUIRED=true` makes it mandatory for finance / super_admin |
| Admin account management      | Admin → **Admin accounts** as `super@rap.et`: create an admin (temporary password shown once; first login is confined to "My security" until it is changed), change roles (sessions revoked), reset passwords, deactivate                      |
| Login lockout                 | 5 wrong passwords on `finance@rap.et` → `423 ACCOUNT_LOCKED` for 15 min (also wrong TOTP codes); 30 attempts / 15 min per IP → `429 LOGIN_RATE_LIMITED`                                                                                        |
| Destination lookup order      | Mobile → Withdraw → new number: the account holder name is shown only **after** the OTP; 5 partner lookups per user per day (`429 DESTINATION_LOOKUP_LIMIT`)                                                                                    |
| Attention check               | Options are shuffled per watch session; a wrong answer removes the ad from the feed for the rest of the day                                                                                                                                   |
| Cookie refresh mode           | Both web consoles keep the refresh token in the httpOnly `rap_refresh` cookie (DevTools → Application → Cookies); localStorage only holds the short-lived access token                                                                        |
| Storage policy                | `curl -I http://localhost:9000/rap-media/private/kyc/<anything>` → 403; `…/rap-media/seed/eid-promo.mp4` → 200                                                                                                                                 |

## The demo journey

`node scripts/demo-flow.mjs` performs (and asserts) the whole story against the running stack; the same steps can be
clicked through in the three UIs:

1. **Advertiser** registers on the portal (accepting the current terms) → cannot submit until verified
   (`ADVERTISER_NOT_VERIFIED`).
2. **Admin (support)** verifies the business.
3. **Advertiser** tops up 500 ETB through the (mock) Chapa checkout → invoice issued → creates a campaign (frequency
   cap 2/day), uploads a **real** creative straight to object storage (presigned PUT) → the media pipeline probes it,
   corrects the declared duration, transcodes it to 720p and renders a poster → submits → 300 ETB reserved.
4. **Admin (reviewer)** approves the campaign and the creative (media status visible) with the banned-topics checklist.
5. **User** signs up in the mobile app (OTP, Ethiopian-calendar DOB, server-side age check), accepts terms + privacy,
   watches the ad with server heartbeats, answers the attention question → `valid` completion, **+100 coins**; a
   replay never double-credits and reports the current balance.
6. **Advertiser analytics** show the completion: raw views vs verified completions, spend 2.00 ETB, fraud-filtered rate.
7. **User** verifies a new payout destination (partner account-name lookup + OTP re-check) and requests a 50 ETB
   withdrawal with an `Idempotency-Key` (replayed, then refused with a changed payload) → held (`first_withdrawal`) →
   **finance** approves → payout worker moves it `pending → processing → completed` via the (mock) telebirr provider.
8. **Support** opens a read-only impersonation session on the user (audited; writes refused).
9. **Admin revenue** shows spend, rewards, platform revenue (50% take), referral cost, top-ups and payouts; the alert
   rules run and the alerts page lists open money-day alerts.

Verified on this machine against the containerized stack (API, both portals, Expo web) with Playwright; screenshots
are kept outside the repo.

## What is real vs mocked

| Area                    | Real                                                                                                                                                | Mocked / not yet real                                                                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Coin ledger & balances  | Append-only `coin_ledger` (DB triggers), single write path with row locks + idempotency keys, hourly reconciliation, DB `CHECK` constraints         | —                                                                                                                                                                                                      |
| Ad verification & fraud | Server-timed watch sessions, heartbeats, attention questions, daily cap, 8-rule fraud engine with trust scores, flagged completions held for review | Device attestation (Play Integrity / App Attest) and ML scoring are not implemented; thresholds are tuned by hand                                                                                      |
| Withdrawals             | Holds, first/large/low-trust review, two distinct finance approvals for ≥ 500 ETB, failover registry (definitive errors only), reversing entries keyed to the hold, **`needs_manual_review` instead of auto-refund on ambiguous partner answers**, destination verification (OTP first, then partner name lookup; per-user lookup cap), KYC tier limit, idempotency keys, all gates under the user row lock | **telebirr and Chapa payouts and account lookups run in labelled MOCK mode** (`PAYOUTS_MOCK=true`); the real HTTP shapes (incl. transfer lookup by reference) exist and activate with credentials; telebirr endpoint paths must be confirmed with Ethio Telecom |
| KYC                     | Tiers (`phone_only` / `id_verified`), private document uploads, admin queue with 5-minute presigned links, duplicate-identity flags, rolling 30-day threshold | **Fayda registry check is mocked** (`MockFaydaProvider`); NIDP onboarding needed for `FaydaProvider`                                                                                                     |
| Advertiser billing      | Prepaid wallet ledger, budget reservation/refund, invoices (JSON), webhook signature verification, idempotent settlement, idempotency keys on top-ups | **Chapa checkout is mocked** without `CHAPA_SECRET_KEY` (local checkout page); PDF invoices and VAT policy (`INVOICE_VAT_RATE=0`) pending finance sign-off                                             |
| Auth                    | OTP with per-phone/IP request **and verify** limits (atomic attempts, burn-after-max), rotating refresh tokens with reuse detection + atomic claim, **immediate access-token denylist** (logout / suspension / ban / role change), RBAC re-checked against the DB per request, login throttling + lockout, **admin TOTP MFA**, audited admin account management, httpOnly-cookie refresh mode for the web consoles, age computed server-side from Gregorian **or Ethiopian** DOB, terms/privacy consent enforcement, read-only support impersonation | **SMS provider is mocked** (code echoed in dev only); `HttpSmsProvider` is a generic JSON POST skeleton to wire to the chosen gateway |
| Media                   | Presigned browser → MinIO/S3 uploads, public read, **ffprobe duration correction + 720p H.264 transcode + poster generation** (apk ffmpeg in the image)         | No CDN, single rendition, no virus scan                                                                                                                                                                |
| Alerting                | `platform_alerts` + rules (ledger drift, payout failure rate, account minting, spend velocity, OTP spikes), admin acknowledgement, security log channel        | **Telegram / Slack-webhook delivery is mocked to the log** until `ALERT_TELEGRAM_*` / `ALERT_WEBHOOK_URL` are set                                                                                       |
| Referrals               | Codes, first-login attribution, bonuses credited through the ledger on the referee's first valid completion, device/IP self-referral guards, daily cap, admin metrics | Share URL is a placeholder (`REFERRAL_SHARE_URL`) until the store listing exists                                                                                                                       |
| Data rights             | Async JSON export with presigned download, deletion requests with a 14-day grace period, anonymisation that keeps financial records, backup/restore scripts + runbook | Retention basis and export format to be confirmed by legal                                                                                                                                             |
| Notifications           | In-app inbox persisted for every event, FCM HTTP v1 adapter, push tokens                                                                            | **Push is mocked** without `FCM_SERVICE_ACCOUNT_JSON`; templates are English-only                                                                                                                      |
| Offers                  | Surveys validated and credited immediately (idempotency keys supported)                                                                             | App-install completions are verified manually by admins (no attribution SDK)                                                                                                                           |
| Mobile app              | Full Expo app, Amharic default, 78 tests, Expo-web verified end-to-end                                                                              | **Native Android/iOS builds, device playback and real push were not run here** (no SDKs on this machine); Afaan Oromo / Tigrinya translations partial; Phase 4A screens (consent, KYC, destination confirm, referrals, Ethiopian DOB picker) are built by the Phase 4B frontend sessions |
| Web portals             | Full React apps with unit tests and Playwright E2E, containerized nginx builds                                                                      | Advertiser settings page still caches the profile from login; Phase 4A UI (frequency cap, media status, terms, KYC queue, alerts, referrals, deletion requests, impersonation) is built by the Phase 4B sessions |

The effective mock flags are shown at `GET /admin/config` (`mocks`) and in the admin console header ("Mock mode").

## Before production

Many former checklist items are now **enforced by the API's environment schema** – with `NODE_ENV=production` the API
refuses to boot with mock payments / payouts / SMS, default storage credentials, wildcard CORS, a short
`JWT_ACCESS_SECRET`, a missing `KYC_HASH_KEY`, `OTP_DEV_*` switches or Swagger enabled, mock checkout routes answer
404 and the seed refuses to run (`ALLOW_SEED_IN_PRODUCTION`). The full threat model, controls, audit-finding table and
hardening checklist live in [`docs/SECURITY.md`](docs/SECURITY.md). What remains is contractual and operational:

Legal / money

- Sign telebirr business API and Chapa merchant agreements; obtain sandbox credentials; confirm telebirr B2C endpoint
  paths/fields, the transfer "query by outTradeNo" lookup and both partners' account-name lookup endpoints against the
  contract documentation; run `PAYOUTS_MOCK=false` in staging with real 1 ETB payouts and a forced timeout to see a
  payout land in **Needs manual review**.
- Register the Chapa webhook URL (payload-signed `Chapa-Signature`), set `CHAPA_WEBHOOK_SECRET`, reconcile gateway
  settlements against `advertiser_payments`.
- Finance sign-off: take rate, VAT on top-ups/invoices, invoice numbering, PDF invoices, statements, referral bonus budget.
- Legal review: the seeded terms/privacy texts (v1.0 placeholders, en/am), data-retention basis for anonymised
  financial records after account deletion, KYC threshold under NBE rules, payout KYC; Fayda/NIDP onboarding to
  replace the mock identity check.
- Real SMS provider (`SMS_PROVIDER=http` + `SMS_API_URL` / `SMS_API_KEY`, adapt `HttpSmsProvider` to the gateway's payload).

Security / infrastructure

- Generate production secrets (`JWT_ACCESS_SECRET`, `KYC_HASH_KEY`, `MFA_ENCRYPTION_KEY`, storage + database
  credentials), set `ADMIN_MFA_REQUIRED=true`, create real admin accounts through `POST /admin/admins` and delete the
  seeded ones, set `TRUST_PROXY_HOPS` to the number of proxies in front of the API, TLS everywhere, edge rate limiting / WAF.
- Managed PostgreSQL with backups + PITR (replace `scripts/backup.*`), PgBouncer, managed Redis with persistence
  (denylist, throttles and lockouts live there; keep SECURITY_REDIS_FAIL_MODE=closed), a separate worker deployment (`QUEUES_ENABLED=false` on API replicas),
  S3 + CDN for media with the `docker/minio-bucket-policy.json` semantics (anonymous read for `creatives/*` only),
  virus scanning of creatives before transcoding, observability (ship the `channel=security` log stream to a SIEM; wire
  `ALERT_TELEGRAM_*` / `ALERT_WEBHOOK_URL` to on-call).
- CI: run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, the API e2e/smoke and the pentest script on every
  change; the Playwright E2E suites used for verification live outside the repo and should be committed into CI. Run
  the restore drill monthly and `scripts/audit-reservations.mjs` weekly.

Product

- Native builds (EAS), real-device playback and push, store listings; Afaan Oromo / Tigrinya translations (incl. legal
  texts); app-install attribution postbacks; fraud/alert threshold tuning with real traffic; additional media renditions.

## Environment variables

Everything is documented in [`.env.example`](.env.example) (one root `.env` drives docker compose, the API, Prisma,
the seed and the scripts). Frontends read `VITE_API_URL` (web) and `EXPO_PUBLIC_API_URL` (mobile), default
`http://localhost:3000`. Phase 4 groups: `KYC_*` / `ID_VERIFICATION_PROVIDER` / `FAYDA_*`, `DESTINATION_RESOLVE_TTL_MINUTES`,
`ALERT_*` (Telegram / webhook delivery + rule thresholds), `DEFAULT_FREQUENCY_CAP` / `ADVERTISER_IMPRESSION_CAP_PER_USER_PER_DAY`,
`MEDIA_*` (ffmpeg paths, time-box, target height), `REFERRAL_*` / `REFEREE_BONUS_COINS`, `ACCOUNT_DELETION_GRACE_DAYS` /
`DATA_*`, `IMPERSONATION_TTL_SECONDS`, `IDEMPOTENCY_TTL_HOURS`. Phase 5 (security) groups: `TRUST_PROXY_HOPS`,
`OTP_VERIFY_*`, `LOGIN_*` (throttle + lockout), `ADMIN_MFA_REQUIRED` / `MFA_ENCRYPTION_KEY`, `KYC_HASH_KEY`,
`DESTINATION_LOOKUPS_PER_DAY` / `ALERT_DESTINATION_LOOKUPS_PER_IP_PER_HOUR`, `PAYOUT_PROVIDER_TIMEOUT_MS` /
`PAYOUT_MAX_POLLS` / `PAYOUT_INITIATE_ATTEMPTS` / `PAYOUT_STUCK_PROCESSING_MINUTES`, `AUTH_COOKIE_*`, `SMS_PROVIDER` /
`SMS_API_*`, `SWAGGER_ENABLED`, `ALLOW_SEED_IN_PRODUCTION`, `MINIO_BIND`, `LOGIN_TRUSTED_IP_HOURS`,
`SECURITY_REDIS_FAIL_MODE` (closed in production); `POSTGRES_*`, `S3_ACCESS_KEY` / `S3_SECRET_KEY` and
`REDIS_PASSWORD` (mirrored into `REDIS_URL`) are **required** by docker compose (no defaults).

## Key engineering guarantees

- **One ledger write path.** `apps/api/src/modules/ledger/ledger.core.ts` is the only code that writes `users.coin_balance`
  (a Jest guard greps the tree); `coin_ledger`, `advertiser_wallet_ledger` and `audit_log` are append-only at the database level.
- **Rewards are decided server-side** from server timestamps and fraud signals; completions are idempotent.
- **Risky withdrawals never auto-pay**; large ones need two distinct finance approvals; manual coin adjustments are a
  real two-step workflow; every admin decision is audited with before/after state; an ambiguous partner answer parks the
  payout for a human instead of refunding - only a partner's documented "order not found" answer ever counts as
  "never accepted", and a payout stuck without a partner is parked and alerted, never refunded (Phase 5/5b).
- **Money POSTs are idempotent** (`Idempotency-Key`), new payout destinations are OTP-confirmed before the partner is
  asked who owns them, and phone-only accounts are capped per rolling month until KYC (Phase 4A/5).
- **Every money gate runs under a row lock** (completion, withdrawal request, campaign budget edit / submit /
  approve, payment settlement) and every status transition is a guarded atomic claim – concurrency cannot
  double-spend; a live campaign can never pay beyond what its advertiser's wallet actually reserved (Phase 5/5b).
- **Production is gated by the env schema**: no mock providers, default credentials or debug switches can reach a
  production boot (Phase 5; see `docs/SECURITY.md`).
- **No chance-based mechanics anywhere.**

Operations: `docs/RUNBOOK.md` (daily checks, backups, restore drill, jobs, incidents, data-subject requests).
