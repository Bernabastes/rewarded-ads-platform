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
- `src/modules/ads/completion.verifier.ts` + `ads.service.ts` — server-side watch verification and completion pipeline
- `src/modules/fraud/fraud.rules.ts` — fraud rule engine and trust-score math
- `src/modules/withdrawals/providers/*` — `PayoutProvider` implementations (telebirr, Chapa) and failover registry
- `prisma/schema.prisma`, `prisma/migrations/*` — schema and versioned migrations (incl. append-only triggers)
- `prisma/seed.ts` — demo data
