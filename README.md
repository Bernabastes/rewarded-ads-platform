# Rewarded Advertising Platform (Ethiopia)

Monorepo for a rewarded-advertising platform: Ethiopian businesses fund ad campaigns, everyday users watch ads and
complete surveys/app installs in a mobile app to earn coins (100 coins = 1 ETB) that they withdraw through licensed
payout partners (telebirr / Chapa). The platform keeps 50% of advertiser spend and **never holds user funds**.

Phase 1 (this repository state) delivers the **complete backend API**, the shared contract package, infrastructure,
tests and documentation. Phase 2 builds the three frontends against the frozen contract in `docs/API.md` /
`docs/openapi.json`.

> Product specification: [`docs/SPEC.md`](docs/SPEC.md) · Architecture & decisions: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) ·
> Endpoint guide: [`docs/API.md`](docs/API.md) · OpenAPI: [`docs/openapi.json`](docs/openapi.json) · Scaling: [`docs/SCALING.md`](docs/SCALING.md)

## Repository layout

| Path                  | Package               | Purpose                                                                                    |
| --------------------- | --------------------- | ------------------------------------------------------------------------------------------ |
| `apps/api`            | `@rap/api`            | NestJS 12 + Prisma 6 + PostgreSQL 16 + Redis 7 + BullMQ backend (this phase)               |
| `packages/shared`     | `@rap/shared`         | Enums, error codes, platform constants, money helpers, route constants, DTO/response types |
| `apps/mobile`         | `@rap/mobile`         | **Stub** – Expo React Native user app (Phase 2)                                            |
| `apps/advertiser-web` | `@rap/advertiser-web` | **Stub** – React + Vite + Tailwind advertiser portal (Phase 2)                             |
| `apps/admin-web`      | `@rap/admin-web`      | **Stub** – React + Vite + Tailwind admin dashboard (Phase 2)                               |
| `docker-compose.yml`  |                       | postgres, redis, minio (+ bucket init), api                                                |
| `scripts/smoke.ps1`   |                       | One-command end-to-end demo verification against a running API                             |

## Prerequisites

- Node.js ≥ 24.9 (24.14 tested), pnpm ≥ 10 (11.21 tested) — `corepack enable` or `npm i -g pnpm`
- Docker Desktop (Compose v2+) for PostgreSQL, Redis and MinIO

## Quick start (local development)

```powershell
# 1. install (also builds @rap/shared)
pnpm install

# 2. configure – one root .env drives docker compose, the API, prisma and the seed
Copy-Item .env.example .env          # cp .env.example .env on macOS/Linux
#    If 5432 is taken on your machine set POSTGRES_PORT=5434 and update DATABASE_URL accordingly.

# 3. infrastructure
docker compose up -d postgres redis minio minio-init

# 4. database schema + demo data
pnpm --filter @rap/api prisma:migrate     # prisma migrate deploy
pnpm --filter @rap/api seed               # resets and seeds demo data (dev only)

# 5. run the API (watch mode)
pnpm dev:api
#    Swagger UI:      http://localhost:3000/api/docs
#    OpenAPI JSON:    http://localhost:3000/api/docs-json
#    Health:          http://localhost:3000/health  |  /health/ready
#    MinIO console:   http://localhost:9001  (minioadmin / minioadmin)

# 6. verify the whole money flow in one command (needs OTP_DEV_ECHO=true in .env)
pnpm smoke
```

Everything in one container stack instead (API image built from `apps/api/Dockerfile`, migrations applied on start):

```powershell
docker compose up -d --build            # add RUN_SEED=true to .env to seed on first start
```

## Everyday commands

| Command                                      | What it does                                                       |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | Fan out to every workspace package (stubs no-op cleanly)           |
| `pnpm --filter @rap/api test`                | Jest unit tests – money/coin + fraud logic, no database needed     |
| `pnpm --filter @rap/api test:e2e`            | Supertest e2e smoke; runs only when Postgres + Redis are reachable |
| `pnpm --filter @rap/api prisma:migrate:dev`  | Create/apply a migration in development                            |
| `pnpm --filter @rap/api prisma:studio`       | Browse the database                                                |
| `pnpm --filter @rap/api openapi:export`      | Build and write `docs/openapi.json` (works without DB/Redis)       |
| `pnpm --filter @rap/shared build`            | Rebuild the shared contract package after editing it               |
| `pnpm format`                                | Prettier over the whole repo                                       |

## Demo credentials (seeded)

| Role                        | Login                                                                | Password         |
| --------------------------- | -------------------------------------------------------------------- | ---------------- |
| Admin – super_admin         | `super@rap.et`                                                       | `Admin123!`      |
| Admin – ad_reviewer         | `reviewer@rap.et`                                                    | `Admin123!`      |
| Admin – support             | `support@rap.et`                                                     | `Admin123!`      |
| Admin – finance             | `finance@rap.et`, `finance2@rap.et` (two accounts for dual approval) | `Admin123!`      |
| Advertiser (verified)       | `ads@habesha-coffee.et`, `growth@addisfintech.et`                    | `Advertiser123!` |
| Advertiser (pending review) | `hello@shegerfashion.et`                                             | `Advertiser123!` |
| Users (OTP login)           | `+251911000000`, `+251911000137`, `+251911000274`, … (25 seeded)     | OTP (see below)  |

User login is phone + OTP. The SMS provider is mocked: with `OTP_DEV_ECHO=true` the code is returned as `devCode` in
the `POST /auth/otp/request` response and logged by the API; `OTP_DEV_FIXED_CODE=123456` additionally accepts that
code for any number (both are refused in production). Any unregistered Ethiopian number creates a fresh user.

The seed also creates: 9 campaigns across every status, approved/pending/rejected ads with attention questions, a
survey and an app-install offer, ~100 ad completions with a consistent coin ledger, withdrawals in every status
(including one large withdrawal awaiting its **second** approval), a coin-adjustment request awaiting a second
admin, fraud flags of every severity and an audit trail.

## Architecture overview

```
 Mobile app (Expo)   Advertiser web (Vite)   Admin web (Vite)
        └──────────────┬───────────┴──────────────┬────────┘
                       ▼   REST /api/v1  (JWT, RBAC)
                 ┌──────────────────────────────────────┐
                 │ NestJS API  – auth, users, ads, offers│
                 │ campaigns, billing, withdrawals,      │
                 │ admin, fraud  + BullMQ workers        │
                 └──────┬──────────────┬─────────────────┘
                        ▼              ▼
                  PostgreSQL 16     Redis 7 (rate limits, velocity counters, queues)
                  (Prisma, append-only ledgers, audit log)
                        ▼
                  MinIO / S3 (ad creatives via presigned uploads)
   External (behind interfaces, mocked without credentials): telebirr & Chapa payouts,
   Chapa checkout for advertiser top-ups, SMS OTP, Firebase Cloud Messaging.
```

Key guarantees (details in `docs/ARCHITECTURE.md`):

- **One ledger write path.** Every coin change goes through `applyLedgerEntry` (`apps/api/src/modules/ledger/ledger.core.ts`):
  row lock → idempotency key → append `coin_ledger` row → update cached `users.coin_balance`. Postgres triggers make
  `coin_ledger`, `advertiser_wallet_ledger` and `audit_log` append-only; a scheduled reconciliation job flags drift.
- **Server-side rewards.** Watch duration is measured from server timestamps, with heartbeats, attention questions,
  daily caps and a fraud rule engine; completions are `valid | flagged | rejected` and idempotent.
- **Withdrawals never auto-pay when risky.** First-ever, large (≥ 500 ETB, two distinct finance approvals) and
  low-trust requests are held for review; payouts run through the `PayoutProvider` interface (telebirr, Chapa) with failover.
- **Manual coin adjustments are a two-step workflow** – a different admin must approve; everything is audited.
- **No chance-based mechanics anywhere.**

## Environment variables

All variables are documented with defaults in [`.env.example`](.env.example). Secrets only via env; the API refuses
to start in production with dev secrets or OTP echo enabled.

## Frontend teams (Phase 2)

Read `docs/API.md` first. Import the contract from `@rap/shared`; branch on `code` in the error envelope
`{ statusCode, code, message, details? }`; treat the server balance as the only source of truth. Each frontend
session may only modify its own `apps/<name>` folder (plus `pnpm-lock.yaml`).
