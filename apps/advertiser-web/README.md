# @rap/advertiser-web — Advertiser portal (Phase 2)

**Status: stub.** This folder is reserved for the Phase 2 advertiser-web session. Only this folder (and the root
`pnpm-lock.yaml`) may be modified by that session.

## Planned stack

- React 19 + TypeScript strict + Vite
- Tailwind CSS (light/dark), Framer Motion (page transitions, animated count-ups), Recharts (real charts)
- TanStack Query for server state, React Router
- Premium SaaS analytics feel: overview cards, spend/views over time, **raw vs fraud-filtered** numbers

## Consuming the API

- Base URL: `http://localhost:3000/api/v1` (`API_BASE_PATH` from `@rap/shared`); configure via `VITE_API_URL`.
- Import the contract: `import { API_ROUTES, ErrorCode, type CampaignSummary } from '@rap/shared'`
  (ESM build is picked up by Vite automatically; run `pnpm --filter @rap/shared build` after editing it).
- Auth: `POST /auth/advertiser/register` or `POST /auth/advertiser/login` → Bearer access token +
  rotating refresh token (`POST /auth/refresh`). Unverified advertisers can log in and create drafts but cannot
  submit campaigns until an admin verifies them (`403 ADVERTISER_NOT_VERIFIED`).
- Campaign wizard: `POST /campaigns` (draft) → `POST /campaigns/uploads/presign` + `PUT` file to `uploadUrl` →
  `POST /campaigns/:id/ads` (with `storageKey`) → `POST /campaigns/:id/submit` (reserves budget from the wallet;
  `402`-style `INSUFFICIENT_WALLET_BALANCE` → send the user to Billing).
- Billing: `POST /billing/topups` → redirect to `checkoutUrl` (mock checkout page in dev) → wallet credited by
  webhook → `GET /billing/balance`.
- Analytics: `GET /campaigns/:id/analytics?from&to` returns totals + daily buckets with `rawCompletions` vs
  `validCompletions` (fraud-filtered) and `fraudFilteredRate`.
- Full endpoint guide: `docs/API.md`; machine-readable spec: `docs/openapi.json`; Swagger UI at `/api/docs`.

## Demo credentials

See root `README.md` (e.g. `ads@habesha-coffee.et` / `Advertiser123!`).
