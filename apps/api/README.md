# @rap/api

NestJS backend for the Rewarded Ads Platform. See the root `README.md` for setup and `docs/ARCHITECTURE.md`,
`docs/API.md` for design and contract details.

```
pnpm --filter @rap/api dev              # watch mode (loads the root .env)
pnpm --filter @rap/api test             # unit tests (no database)
pnpm --filter @rap/api test:e2e         # e2e smoke against a live database + redis (seeded)
pnpm --filter @rap/api prisma:migrate   # apply migrations
pnpm --filter @rap/api seed             # reset + seed demo data (development only)
pnpm --filter @rap/api openapi:export   # regenerate ../../docs/openapi.json
```

Key files:

- `src/modules/ledger/ledger.core.ts` — the single transactional coin write path (guarded by `ledger.guard.spec.ts`)
- `src/modules/ads/completion.verifier.ts` + `ads.service.ts` — server-side watch verification, frequency caps and
  the completion pipeline (referral bonuses ride on the first valid completion)
- `src/modules/fraud/fraud.rules.ts` — fraud rule engine and trust-score math
- `src/modules/withdrawals/providers/*` — `PayoutProvider` implementations (telebirr, Chapa), account lookup and the
  failover registry; `withdrawals/destinations/*` — destination verification (lookup + OTP re-check)
- `src/common/idempotency/*` — `Idempotency-Key` interceptor for money POSTs
- `src/common/guards/auth.guard.ts` (token denylist, read-only impersonation) and `consent.guard.ts`
- `src/modules/{kyc,legal,alerts,referrals,media,data-rights}` — Phase 4A modules (see `docs/ARCHITECTURE.md` §12c)
- `prisma/schema.prisma`, `prisma/migrations/*` — schema and versioned migrations (incl. append-only triggers)
- `prisma/seed.ts` — demo data

Media pipeline binaries: the Docker image installs `ffmpeg` via apk (`MEDIA_FFMPEG_PATH` / `MEDIA_FFPROBE_PATH`). When
running the API on a developer machine run `pnpm media:tools` once (installs `ffmpeg-static`/`ffprobe-static` into
`tools/media/`, outside the workspace lockfile) or put `ffmpeg`/`ffprobe` on your PATH; otherwise uploaded videos end
up `media_status = failed` and cannot be approved.
