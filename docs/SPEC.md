# Full-Stack Build Prompt: Rewarded Advertising Platform (Ethiopia)

**Instructions for the AI receiving this prompt:** You are being asked to design and build a complete, production-grade, full-stack platform from scratch. Read this entire document before writing any code. Where a decision is not fully specified, make a reasonable choice, state the assumption clearly, and proceed — do not stop and ask unless something is truly blocking. Build this as if it will be handed to a real engineering team and a real investor demo. Prioritize correctness of the money/coin logic and fraud controls above visual polish, but the visual polish still matters a great deal — see the Design section.

---

## 1. Project Summary & Business Context

We are building a **rewarded advertising platform for Ethiopia**. It connects three types of participants:

1. **Advertisers** — Ethiopian businesses that pay to run ad campaigns (video ads, and later surveys/app-install offers).
2. **Users** — everyday people who watch ads and complete tasks through a mobile app, earning coins that convert to Ethiopian Birr (ETB) and can be withdrawn.
3. **The Platform** — takes a cut (initially modeled as 50%) of every advertiser payment; the rest funds user rewards.

The system must be built as **three connected surfaces sharing one backend and one database**:

| Surface               | Users                        | Format                                       |
| --------------------- | ---------------------------- | -------------------------------------------- |
| **User Application**  | Everyday consumers           | Native-feeling cross-platform **mobile app** |
| **Advertiser System** | Businesses running campaigns | **Web app**                                  |
| **Admin Dashboard**   | Internal platform team       | **Web app**                                  |

This is an MVP for a startup — it must be real, working, and demo-ready, but architected so it can scale to tens of thousands of users without a rewrite.

---

## 2. System Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   User Mobile    │     │  Advertiser Web   │     │   Admin Web       │
│   App (RN)        │     │  Portal (React)   │     │   Dashboard (React)│
└────────┬─────────┘     └─────────┬─────────┘     └─────────┬─────────┘
         │                          │                          │
         └──────────────┬───────────┴──────────────┬──────────┘
                         │                          │
                 ┌───────▼──────────────────────────▼───────┐
                 │         Backend API (REST, versioned)      │
                 │   Node.js + Express/NestJS + TypeScript     │
                 └───────┬──────────────────────────┬───────┘
                         │                          │
              ┌──────────▼─────────┐      ┌─────────▼──────────┐
              │   PostgreSQL         │      │   Redis (cache,      │
              │   (primary database) │      │   queues, rate-limit)│
              └───────────────────────┘      └──────────────────────┘
                         │
              ┌──────────▼─────────┐
              │  Object storage      │
              │  (ad videos/images)  │
              └───────────────────────┘
```

**Explicitly required:** use **PostgreSQL** as the database (already decided). Structure the backend so PostgreSQL can later be swapped for a managed/clustered instance without a schema rewrite — use a proper ORM (Prisma or TypeORM), migrations, and no raw vendor-specific SQL unless unavoidable.

---

## 3. Recommended Tech Stack

| Layer                          | Choice                                                                                                                    | Why                                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Mobile app                     | **React Native (Expo)**                                                                                                   | One codebase for iOS + Android, fast to build, huge ecosystem, easy OTA updates                                                                        |
| Advertiser + Admin web         | **React + TypeScript + Vite**, **Tailwind CSS**                                                                           | Fast, modern, easy to make visually strong                                                                                                             |
| Backend                        | **Node.js + TypeScript + NestJS** (or Express if simpler)                                                                 | Type safety across the whole stack, matches frontend language, strong ecosystem                                                                        |
| Database                       | **PostgreSQL**                                                                                                            | Explicitly required; relational integrity matters a lot for money/coins                                                                                |
| ORM                            | **Prisma**                                                                                                                | Type-safe queries, easy migrations, works cleanly with Postgres                                                                                        |
| Cache / Queues / Rate limiting | **Redis**                                                                                                                 | Needed for fraud rate-limiting, background jobs (payouts, fraud scoring)                                                                               |
| Auth                           | **JWT access + refresh tokens**, phone-number OTP for users, email+password for advertisers/admins                        | Matches the fraud requirement of phone-verified accounts                                                                                               |
| File/video storage             | **S3-compatible object storage** (AWS S3 or a local MinIO for dev)                                                        | Ad video/image assets                                                                                                                                  |
| Background jobs                | **BullMQ** (Redis-based)                                                                                                  | Payout processing, fraud scoring, notification sending                                                                                                 |
| Payments                       | **Abstracted provider interface** — build against telebirr and Chapa's APIs behind one internal interface (see Section 9) | Never hold money directly; always route through a licensed payout partner                                                                              |
| Push notifications             | **Firebase Cloud Messaging**                                                                                              | Standard for React Native                                                                                                                              |
| Hosting (MVP)                  | Single **Docker Compose** stack (API + Postgres + Redis + MinIO) runnable locally and on one VM                           | Keep it simple and cheap for MVP; document how each piece would scale later (managed Postgres, separate Redis, horizontal API replicas, CDN for video) |

State explicitly in your output: which parts of this stack you used as-is, and any substitutions you made, with reasoning.

---

## 4. Core Database Schema (PostgreSQL)

Design full Prisma (or equivalent) schema and migrations covering at minimum the following entities. Add any supporting tables you judge necessary (e.g. junction tables, audit logs).

### `users`

id, phone_number (unique, verified), full_name, date_of_birth, age_verification_status (`pending` / `verified_adult` / `rejected`), device_id, password_hash (or OTP-only auth), language_preference, coin_balance (derived from ledger, never edited directly), trust_score, status (`active` / `suspended` / `banned`), created_at, updated_at.

### `advertisers`

id, business_name, business_registration_number, contact_email, contact_phone, verification_status, created_at.

### `campaigns`

id, advertiser_id (FK), title, budget_etb, spent_etb, status (`draft` / `pending_review` / `active` / `paused` / `completed` / `rejected`), start_date, end_date, target_action_type (`video_view` / `survey` / `app_install`), reward_per_action_etb, created_at.

### `ads`

id, campaign_id (FK), media_url, media_type, duration_seconds, review_status (`pending` / `approved` / `rejected`), reviewed_by (admin user id), rejection_reason, created_at.

### `ad_completions`

id, user_id (FK), ad_id (FK), started_at, completed_at, watch_duration_seconds, server_verified (boolean), device_fingerprint, ip_address, fraud_flags (array/jsonb), coin_reward_amount, status (`valid` / `flagged` / `rejected`).

### `coin_ledger`

id, user_id (FK), amount (can be negative for withdrawals), balance_after, source_type (`ad_view` / `survey` / `app_install` / `withdrawal` / `admin_adjustment`), source_id, created_by (nullable admin id, for manual adjustments — must require dual approval, see Section 8), created_at.
**This table is append-only. `users.coin_balance` must be a derived/cached value recomputed from this ledger, never edited directly.**

### `withdrawals`

id, user_id (FK), amount_etb, coin_amount, payout_method (`telebirr` / `bank` / etc.), payout_destination, status (`pending` / `processing` / `completed` / `failed` / `flagged_for_review`), requested_at, processed_at, processed_by (admin id, if manual).

### `surveys` / `app_install_offers`

id, campaign_id (FK), details (jsonb), reward_etb, active (boolean).

### `fraud_flags`

id, user_id (FK, nullable), related_entity_type, related_entity_id, flag_type, severity, description, resolved (boolean), resolved_by, created_at.

### `admin_users`

id, email, password_hash, role (`super_admin` / `ad_reviewer` / `support` / `finance`), created_at.

### `audit_log`

id, actor_type (`admin` / `system`), actor_id, action, target_type, target_id, before_state (jsonb), after_state (jsonb), created_at.
**Every manual coin adjustment, withdrawal approval, and ad approval/rejection must write here.**

---

## 5. User Mobile App — Feature Specification

Build with **React Native (Expo)**, TypeScript, and a state management solution (Zustand or Redux Toolkit). Support **Amharic as the default language**, with English as a secondary option and the architecture ready for additional languages (Afaan Oromo, Tigrinya) via a proper i18n library (e.g. `i18next`) — do not hardcode any user-facing string.

### Screens required

- **Onboarding / signup**: phone number entry → OTP verification → date of birth (server-side age calculation, block under-18 with a clear, respectful message) → language selection.
- **Home / ad feed**: a clean, scrollable list of available ads/tasks, each showing thumbnail, reward amount, and estimated time. Make this visually the strongest screen in the app — see Design section.
- **Ad player**: full-screen video player. Reward must only be granted after the server independently confirms sufficient watch duration — never trust a client-side "finished" event alone. Include a short one-question check after some ads to confirm attention (configurable per campaign).
- **Coin balance / wallet**: current balance, a running transaction history (pulled from the coin ledger), and a prominent, honest note near the balance explaining the coin-to-birr conversion rate.
- **Withdrawal flow**: shows minimum withdrawal threshold, lets the user choose a payout method, confirms the destination, and shows real-time status once submitted.
- **Withdrawal history**: past requests and their status.
- **Surveys / offers tab**: separate from plain ads, since these pay significantly more — treat this as a first-class section, not an afterthought.
- **Profile & settings**: language, notification preferences, support contact (Telegram/phone), and a way to report a bad ad.
- **Notifications**: push notifications for reward confirmations, withdrawal status changes, and new high-value offers.

### Client-side technical requirements

- Collect and send a stable **device fingerprint** with every session (for fraud detection).
- Never store or trust a locally-computed coin balance as the source of truth — always re-fetch from the server.
- Handle offline/interrupted connections gracefully: never lose an in-progress ad-watch state; resume or safely discard rather than double-crediting.
- Build with accessibility and low-end Android devices in mind: small bundle size, lazy-loaded video, and graceful degradation on slow connections.

---

## 6. Advertiser Web Portal — Feature Specification

Build with React + TypeScript + Tailwind. This is a **business tool** — clean, professional, data-forward, but should still feel modern and premium, not like a bare admin template.

### Pages required

- **Sign up / login** (email + password, plus business verification fields: business name, registration number).
- **Dashboard home**: overview cards (active campaigns, total spend, total views, estimated reach), with a real chart (spend over time, views over time) — use a real charting library (Recharts or similar), not static images.
- **Create campaign wizard**: multi-step flow — campaign details → upload ad creative (video/image, with clear file requirements) → set budget and target action type → review → submit for approval.
- **Campaign list & detail view**: status, budget spent vs. remaining, real-time (or near-real-time) view/completion counts, and a way to pause/resume a campaign.
- **Analytics**: per-campaign breakdown of views, completions, estimated demographics if available, and — importantly — **fraud-filtered vs. raw numbers**, so advertisers can see the platform is actively protecting them from fake views. This is a direct product differentiator described in our business proposal; make it visible and clear.
- **Billing / payments**: payment history, add funds, invoices.
- **Account settings**.

---

## 7. Admin Dashboard — Feature Specification

Build with React + TypeScript + Tailwind, styled distinctly from the advertiser portal (internal tool, information-dense, efficient).

### Pages required

- **Login** with role-based access control (see roles in schema).
- **Ad review queue**: every pending ad, with approve/reject actions, a rejection-reason field, and a visible banned-topics checklist (alcohol, gambling, certain medicines, political content) referenced during review.
- **User management**: search/filter users, view trust score and flag history, suspend/ban with a reason and audit trail.
- **Advertiser management**: verify new advertiser business registrations, view/manage campaigns.
- **Fraud dashboard**: a live view of flagged accounts, flag types, and severity, with clear actions (dismiss / escalate / suspend). Show aggregate fraud metrics (e.g. % of views flagged this week).
- **Withdrawal queue**: pending withdrawals, especially first-time withdrawals for new accounts (manual review requirement from our fraud plan), with approve/reject and required dual-approval for large amounts.
- **Manual coin adjustments**: only accessible to specific roles, and every adjustment **requires a second admin's approval before it takes effect** — implement this as an actual two-step workflow, not just a warning message.
- **Revenue dashboard**: platform revenue over time, advertiser spend breakdown, user payout totals — the internal version of the business's core financial model from our proposal.
- **Audit log viewer**: searchable, filterable view of the `audit_log` table.

---

## 8. Backend API Requirements

Build a versioned REST API (`/api/v1/...`). Group endpoints logically:

- `/auth/*` — OTP request/verify (users), login (advertisers/admins), token refresh.
- `/users/*` — profile, coin balance, transaction history.
- `/ads/*` — fetch available ads (server-side filtered by fraud/eligibility rules), submit completion events.
- `/campaigns/*` — advertiser CRUD for campaigns, admin approval actions.
- `/withdrawals/*` — request, status, admin approval actions.
- `/admin/*` — all admin-only management endpoints, protected by role-based middleware.
- `/fraud/*` — internal endpoints for flag creation/resolution.

**Non-negotiable backend rules, directly from our fraud and financial model:**

- All coin balance changes happen through a single, transactional ledger-write function — never allow a direct `UPDATE users SET coin_balance = ...`.
- Ad-completion reward logic must run **entirely server-side**: verify watch duration against server-recorded timestamps, check device/account fraud signals, and only then write to the ledger.
- Rate-limit ad completions per user per day (configurable, default aligned with our 15/day assumption from the business model).
- Withdrawals for a user's first-ever payout, or above a configurable large-amount threshold, must be flagged for manual admin review rather than auto-processed.
- Any manual coin grant or adjustment must require two distinct admin approvals and write a full audit log entry.

---

## 9. Payments & Payouts

**Critical constraint from our legal review: the platform must never hold user funds directly** (this requires an NBE Payment Instrument Issuer licence, which is not feasible at MVP stage). Build a `PayoutProvider` interface with at least two implementations:

```typescript
interface PayoutProvider {
  initiatePayout(userId: string, amountEtb: number, destination: string): Promise<PayoutResult>;
  checkStatus(payoutId: string): Promise<PayoutStatus>;
}
```

- Implement one provider against **telebirr's business API** and one against **Chapa's payment gateway API** (or realistic mocked versions of both if live credentials aren't available in this build environment — make the mock clearly labeled and easy to swap for real credentials).
- The system should support at least two live payout methods simultaneously, as specified in our technology risk plan, so one partner outage doesn't halt all withdrawals.
- For advertiser payments inbound, integrate a standard payment gateway checkout (Chapa supports this well for Ethiopian businesses).

---

## 10. Design & UX Requirements

This must look and feel like a **funded, credible, modern startup product** — not a template. Refer to it as a real differentiator: in a market full of scam-looking apps, visual polish and trustworthiness are part of the product strategy from our business proposal.

- **Brand direction**: modern, warm, optimistic — this is a product about everyday Ethiopians earning real value. Avoid generic "crypto app" or "cheap reward app" visual clichés (no gaudy gold coins, no slot-machine energy — remember, no gambling-like presentation at all, per our legal requirements).
- **Color system**: define a clean palette (e.g. a deep trustworthy navy or forest tone as primary, one warm accent color) with full light/dark mode support across all three surfaces.
- **Typography**: a strong, legible typeface that renders Amharic script cleanly — verify font choice supports Ethiopic Unicode properly, this is essential, not optional.
- **Motion & animation**: use tasteful, purposeful animation — smooth screen transitions, a satisfying coin-earned animation on the mobile app (subtle, not slot-machine-like), animated number count-ups on dashboards (advertiser analytics, admin revenue), skeleton loading states instead of blank spinners. Use a real animation library (Framer Motion on web, Reanimated on React Native) rather than CSS-only tricks.
- **Mobile app feel**: should feel closer to a polished consumer app (think Duolingo-level visual craft, not a form-heavy utility app) — this is the product's shop window.
- **Web dashboards**: should feel like a premium SaaS analytics product — real charts, clear data hierarchy, confident whitespace, not a dense spreadsheet-like table dump everywhere.
- **Empty and error states**: design these deliberately (e.g. "No ads available right now — check back soon" with a friendly illustration), not default framework fallbacks.

---

## 11. Non-Functional Requirements

- **Testing**: include unit tests for all money/coin logic and fraud-scoring logic at minimum — this is the part that must never silently break.
- **Environment config**: `.env`-based configuration for all secrets, API keys, and provider credentials; never hardcoded.
- **Docker Compose** setup that runs the full stack (API, Postgres, Redis, object storage) locally with one command.
- **Migrations**: all schema changes via versioned migration files, never manual database edits.
- **Logging**: structured logging on the backend, with clear separation between normal logs and fraud/security-relevant events.
- **Documentation**: a `README.md` explaining how to run the project locally, environment variables required, and an overview of the architecture.
- **Scalability notes**: include a short written note (in the README or a `SCALING.md`) on what would change to support significant growth — e.g. moving to managed Postgres with read replicas, horizontal API scaling behind a load balancer, CDN for ad video delivery, and separating the fraud-scoring job into its own service.

---

## 12. Explicit Build Instructions

1. Start by proposing the full Prisma schema and confirming the architecture before writing feature code.
2. Build the backend core (auth, ledger, ad-completion flow, withdrawal flow) before either frontend, since this is where correctness matters most.
3. Build the mobile app next (it is the primary product surface), then the advertiser portal, then the admin dashboard.
4. At each stage, prioritize: (1) correct money/coin logic, (2) fraud controls, (3) visual polish — in that order of engineering priority, though all three are required for the final deliverable.
5. Clearly state any assumptions made, any parts mocked due to missing real credentials (e.g. telebirr/Chapa sandbox access), and a list of what would need to happen before this is genuinely production-ready.

---

_This specification is based on a full business proposal covering market research, financial modeling, legal compliance, and fraud prevention for the Ethiopian market. The technical requirements above (fraud controls, coin ledger integrity, payout provider abstraction, age verification, no chance-based reward mechanics) are not arbitrary engineering preferences — each one traces directly to a specific legal, financial, or trust risk identified in that research, and should not be simplified away for convenience._
