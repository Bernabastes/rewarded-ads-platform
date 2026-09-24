# @rap/admin-web — Admin dashboard (Phase 2)

**Status: stub.** This folder is reserved for the Phase 2 admin-web session. Only this folder (and the root
`pnpm-lock.yaml`) may be modified by that session.

## Planned stack

- React 19 + TypeScript strict + Vite, Tailwind CSS (light/dark), TanStack Query + Table, React Router
- Information-dense internal tool: keyboard-friendly tables, filters, side panels; visually distinct from the
  advertiser portal
- Recharts for fraud/revenue charts, Framer Motion for count-ups/transitions

## RBAC (enforced server-side, mirror it in the UI)

| Area | Roles allowed |
| --- | --- |
| Ad review queue, campaign moderation | `ad_reviewer`, `super_admin` |
| Users (suspend/ban/reinstate), advertiser verification, ad reports | `support`, `super_admin` |
| Fraud dashboard actions | `support`, `finance`, `super_admin` |
| Withdrawal queue, coin adjustments, revenue | `finance`, `super_admin` |
| Audit log | `finance`, `support`, `super_admin` (read) |

`GET /admin/me` returns the role. Large withdrawals (≥ `largeWithdrawalThresholdEtb`) require approvals from
**two distinct** finance/super_admin accounts; coin adjustments require a **different** admin to approve than the
one who requested — the UI must surface "awaiting second approval" states and disable self-approval.

## Consuming the API

- Base URL: `http://localhost:3000/api/v1`; configure via `VITE_API_URL`.
- Auth: `POST /auth/admin/login` → Bearer token + rotating refresh (`POST /auth/refresh`).
- Import the contract from `@rap/shared` (`API_ROUTES.admin.*`, `ErrorCode`, `BANNED_TOPICS`, admin types).
- Full endpoint guide: `docs/API.md`; machine-readable spec: `docs/openapi.json`; Swagger UI at `/api/docs`.

## Demo credentials

`super@rap.et`, `reviewer@rap.et`, `support@rap.et`, `finance@rap.et`, `finance2@rap.et` — password `Admin123!`.
