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
             │  withdrawals · admin · fraud  +  BullMQ workers                  │
             │  (payouts, notifications, ledger reconciliation)                 │
             └───────┬──────────────────┬──────────────────────┬──────────────┘
                     ▼                  ▼                      ▼
             PostgreSQL 16       Redis 7 (rate limits,     MinIO / S3 (creatives,
             Prisma · append-    velocity counters,        presigned browser uploads,
             only ledgers        queues)                   public read)
                     │
     external partners behind interfaces (mocked without credentials):
     telebirr & Chapa payouts · Chapa checkout (advertiser top-ups) · SMS OTP · Firebase Cloud Messaging
```

## Workspaces

| Path                  | Package               | What it is                                                                                                                                                                       | README                                                         |
| --------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `apps/api`            | `@rap/api`            | NestJS 12 · Prisma 6 · PostgreSQL 16 · Redis 7 · BullMQ 6. Single transactional coin ledger, server-side ad verification, fraud engine, dual-approval workflows, audit log       | [apps/api/README.md](apps/api/README.md)                       |
| `apps/mobile`         | `@rap/mobile`         | Expo SDK 57 / React Native user app: Amharic-first (am/en/om/ti), onboarding + OTP, feed, server-timed player, wallet, withdrawals, offers, notifications                        | [apps/mobile/README.md](apps/mobile/README.md)                 |
| `apps/advertiser-web` | `@rap/advertiser-web` | React 19 + Vite + Tailwind v4 portal: campaign wizard with presigned uploads, raw-vs-fraud-filtered analytics, wallet top-ups, invoices                                          | [apps/advertiser-web/README.md](apps/advertiser-web/README.md) |
| `apps/admin-web`      | `@rap/admin-web`      | React 19 + Vite + Tailwind v4 internal console: RBAC, review queue with banned-topics checklist, fraud dashboard, dual-approval withdrawals and coin adjustments, revenue, audit | [apps/admin-web/README.md](apps/admin-web/README.md)           |
| `packages/shared`     | `@rap/shared`         | The contract: enums, `ErrorCode`, `PLATFORM_DEFAULTS`, money helpers, `API_ROUTES`, request/response types (CJS + ESM)                                                           | [packages/shared/README.md](packages/shared/README.md)         |

Infrastructure lives at the root: `docker-compose.yml`, `.env.example`, `scripts/` (`demo.ps1`, `demo-flow.mjs`,
`smoke.ps1`, `run-workspace.mjs`), `docker/nginx-spa.conf`.

## One-command start (whole stack in containers)

Prerequisites: Docker Desktop (Compose v2+). For development also Node.js ≥ 24.9 and pnpm ≥ 10.

```powershell
Copy-Item .env.example .env        # cp .env.example .env on macOS/Linux; change POSTGRES_PORT if 5432 is taken
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
| MinIO console         | http://localhost:9001          | `minioadmin` / `minioadmin`; bucket `rap-media`                |

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
| `pnpm smoke`                                                | `scripts/smoke.ps1`: user money flow against a running API                                    |
| `node scripts/demo-flow.mjs`                                | Cross-surface investor demo journey (see below) with assertions                               |
| `pnpm --filter @rap/api seed`                               | Reset + seed demo data and upload the demo media to MinIO (**destructive**, development only) |
| `pnpm --filter @rap/api openapi:export`                     | Regenerate `docs/openapi.json` from the code                                                  |

Test counts (all green): API 102 Jest unit tests + 3 e2e · mobile 78 Jest · advertiser portal 55 Vitest · admin
dashboard 63 Vitest · shared 6.

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

## The demo journey

`node scripts/demo-flow.mjs` performs (and asserts) the whole story against the running stack; the same steps can be
clicked through in the three UIs:

1. **Advertiser** registers on the portal → cannot submit until verified (`ADVERTISER_NOT_VERIFIED`).
2. **Admin (support)** verifies the business.
3. **Advertiser** tops up 500 ETB through the (mock) Chapa checkout → invoice issued → creates a campaign, uploads a
   creative straight to object storage (presigned PUT), submits → 300 ETB reserved from the wallet.
4. **Admin (reviewer)** approves the campaign and the creative with the banned-topics checklist.
5. **User** signs up in the mobile app (OTP, server-side age check), watches the ad with server heartbeats, answers the
   attention question → `valid` completion, **+100 coins**; a replay never double-credits.
6. **Advertiser analytics** show the completion: raw views vs verified completions, spend 2.00 ETB, fraud-filtered rate.
7. **User** requests a 50 ETB withdrawal → held (`first_withdrawal`) → **finance** approves → payout worker moves it
   `pending → processing → completed` via the (mock) telebirr provider; the hold stays in the ledger.
8. **Admin revenue** shows spend, rewards, platform revenue (50% take), top-ups and payouts, per advertiser.

Verified on this machine against the containerized stack (API, both portals, Expo web) with Playwright; screenshots
are kept outside the repo.

## What is real vs mocked

| Area                    | Real                                                                                                                                                | Mocked / not yet real                                                                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Coin ledger & balances  | Append-only `coin_ledger` (DB triggers), single write path with row locks + idempotency keys, hourly reconciliation, DB `CHECK` constraints         | —                                                                                                                                                                                                      |
| Ad verification & fraud | Server-timed watch sessions, heartbeats, attention questions, daily cap, 8-rule fraud engine with trust scores, flagged completions held for review | Device attestation (Play Integrity / App Attest) and ML scoring are not implemented; thresholds are tuned by hand                                                                                      |
| Withdrawals             | Holds, first/large/low-trust review, two distinct finance approvals for ≥ 500 ETB, failover registry, reversing entries on failure                  | **telebirr and Chapa payouts run in labelled MOCK mode** (`PAYOUTS_MOCK=true`); the real HTTP shapes exist and activate with credentials; telebirr endpoint paths must be confirmed with Ethio Telecom |
| Advertiser billing      | Prepaid wallet ledger, budget reservation/refund, invoices (JSON), webhook signature verification, idempotent settlement                            | **Chapa checkout is mocked** without `CHAPA_SECRET_KEY` (local checkout page); PDF invoices and VAT policy (`INVOICE_VAT_RATE=0`) pending finance sign-off                                             |
| Auth                    | OTP with per-phone/IP limits, rotating refresh tokens with reuse detection, RBAC re-checked per request, age computed server-side                   | **SMS provider is mocked** (code logged / echoed in dev); no admin MFA; Ethiopian-calendar date of birth not implemented (Gregorian entry)                                                             |
| Media                   | Presigned browser → MinIO/S3 uploads, public read, self-hosted demo clips                                                                           | No transcoding / duration probe (declared duration, admin-reviewed), no CDN                                                                                                                            |
| Notifications           | In-app inbox persisted for every event, FCM HTTP v1 adapter, push tokens                                                                            | **Push is mocked** without `FCM_SERVICE_ACCOUNT_JSON`; templates are English-only                                                                                                                      |
| Offers                  | Surveys validated and credited immediately                                                                                                          | App-install completions are verified manually by admins (no attribution SDK)                                                                                                                           |
| Mobile app              | Full Expo app, Amharic default, 78 tests, Expo-web verified end-to-end                                                                              | **Native Android/iOS builds, device playback and real push were not run here** (no SDKs on this machine); Afaan Oromo / Tigrinya translations partial                                                  |
| Web portals             | Full React apps with unit tests and Playwright E2E, containerized nginx builds                                                                      | Advertiser settings page still caches the profile from login (the new `GET/PATCH /advertisers/me` and change-password endpoints are not wired yet); admin console English-only                         |

The effective mock flags are shown at `GET /admin/config` (`mocks`) and in the admin console header ("Mock mode").

## Before production

Legal / money

- Sign telebirr business API and Chapa merchant agreements; obtain sandbox credentials; confirm telebirr B2C endpoint
  paths/fields against the contract documentation; run `PAYOUTS_MOCK=false` in staging with real 1 ETB payouts.
- Register the Chapa webhook URL, set `CHAPA_WEBHOOK_SECRET`, reconcile gateway settlements against `advertiser_payments`.
- Finance sign-off: take rate, VAT on top-ups/invoices, invoice numbering, PDF invoices, statements.
- Legal review: age verification (self-declared DOB today — consider ID checks for large withdrawals), terms, privacy
  notice (device fingerprints, IP retention) under Ethiopian data-protection rules; payout KYC (destination-name matching).
- Real SMS provider (e.g. Ethio Telecom / AfroMessage) and Ethiopian-calendar date entry in the app.

Security / infrastructure

- Rotate all dev secrets (`JWT_ACCESS_SECRET`), disable `OTP_DEV_ECHO` / `OTP_DEV_FIXED_CODE` (the API refuses to start
  in production otherwise), admin MFA + IP allow-list, edge rate limiting / WAF, TLS everywhere.
- Managed PostgreSQL with backups + PITR, PgBouncer, managed Redis with persistence, a separate worker deployment
  (`QUEUES_ENABLED=false` on API replicas), S3 + CDN for media, virus scanning of creatives, observability (ship the
  `channel=security` log stream to a SIEM, alert on `LEDGER_DRIFT`).
- CI: run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` and the API e2e/smoke on every change; the Playwright
  E2E suites used for verification live outside the repo and should be committed into CI.

Product

- Native builds (EAS), real-device playback and push, store listings; Afaan Oromo / Tigrinya translations; wire the
  advertiser settings page to `GET/PATCH /advertisers/me` and `POST /auth/advertiser/change-password`; wire the mobile
  "report an ad" screen to `GET /users/me/recently-watched`; app-install attribution postbacks; fraud threshold tuning
  with real traffic; media transcoding pipeline.

## Environment variables

Everything is documented in [`.env.example`](.env.example) (one root `.env` drives docker compose, the API, Prisma,
the seed and the scripts). Frontends read `VITE_API_URL` (web) and `EXPO_PUBLIC_API_URL` (mobile), default
`http://localhost:3000`.

## Key engineering guarantees

- **One ledger write path.** `apps/api/src/modules/ledger/ledger.core.ts` is the only code that writes `users.coin_balance`
  (a Jest guard greps the tree); `coin_ledger`, `advertiser_wallet_ledger` and `audit_log` are append-only at the database level.
- **Rewards are decided server-side** from server timestamps and fraud signals; completions are idempotent.
- **Risky withdrawals never auto-pay**; large ones need two distinct finance approvals; manual coin adjustments are a
  real two-step workflow; every admin decision is audited with before/after state.
- **No chance-based mechanics anywhere.**
