# @rap/advertiser-web — Advertiser portal (Gize for Business)

The web app Ethiopian businesses use to run rewarded video campaigns: sign up, get verified, fund a wallet, build a
campaign (details → budget → creative upload → review), watch **raw vs fraud-filtered** results, and manage billing.

React 19 · TypeScript strict · Vite 8 · Tailwind CSS v4 (`@theme` tokens) · react-router v8 (data routes) · TanStack
Query · react-hook-form + zod · Framer Motion · Recharts · Radix UI primitives · sonner · lucide-react · `@rap/shared`.
Tests: Vitest + Testing Library + MSW.

## Run

```powershell
pnpm install                                   # at the repo root (also builds @rap/shared)
docker start rap-api                           # API on http://localhost:3000 (or pnpm dev:api)
pnpm --filter @rap/advertiser-web dev          # http://localhost:5173
```

When the nginx container `rap-advertiser-web` already occupies 5173, run the dev server on another port and let it
proxy the API same-origin (the API's `CORS_ORIGINS` only lists 5173/5174/8081):

```powershell
Set-Content apps\advertiser-web\.env.local "VITE_API_URL="     # empty = relative /api/v1 through the Vite proxy
pnpm --filter @rap/advertiser-web exec vite --port 5175 --strictPort
```

Other scripts (run from the root with `--filter @rap/advertiser-web`, or inside the folder):

| Script      | What it does                                             |
| ----------- | -------------------------------------------------------- |
| `dev`       | Vite dev server on port 5173 (strict port)               |
| `build`     | Production build to `dist/` (route-level code splitting) |
| `preview`   | Serve the production build on 5173                       |
| `typecheck` | `tsc --noEmit` (strict, `noUnusedLocals`)                |
| `lint`      | ESLint 10 flat config (React hooks/compiler, a11y)       |
| `test`      | Vitest (jsdom + MSW), 105 tests                          |

Demo accounts (password `Advertiser123!`): `ads@habesha-coffee.et`, `growth@addisfintech.et` (verified, with data),
`hello@shegerfashion.et` (pending verification). Register new advertisers freely — they start in the pending state.

## Environment variables (`.env.example` → `.env.local`)

| Variable                      | Default                  | Purpose                                                                                                        |
| ----------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `VITE_API_URL`                | `http://localhost:3000`  | API origin; `API_BASE_PATH` (`/api/v1`) from `@rap/shared` is appended. **Empty** = same-origin `/api/v1` via the dev proxy |
| `VITE_DEV_API_PROXY_TARGET`   | `http://localhost:3000`  | Where the Vite dev server forwards same-origin `/api` and `/health` requests (dev only)                        |
| `VITE_PUBLIC_URL`             | `window.location.origin` | Used to build the top-up `returnUrl`                                                                           |
| `VITE_UPLOAD_INTERNAL_ORIGIN` | _(empty = disabled)_     | Legacy opt-in: only if an API signs upload URLs for a host the browser cannot reach (e.g. `http://minio:9000`) |
| `VITE_UPLOAD_PROXY_PATH`      | `/__media-upload`        | Dev-server path used by the legacy upload proxy (preserves the signed `Host` header)                           |
| `VITE_UPLOAD_PROXY_TARGET`    | `http://localhost:9000`  | Where the legacy dev proxy forwards uploads                                                                    |

## Architecture

```
src/
  main.tsx                 entry: providers → RouterProvider
  app/                     router (lazy routes), guards (RequireAuth / RedirectIfAuthenticated), providers, error + 404 pages
  config/                  brand.ts (BRAND_NAME placeholder), env.ts
  styles/globals.css       Tailwind v4 @theme tokens, light/dark variables, fonts, utilities
  lib/
    api/client.ts          fetch wrapper: bearer auth, proactive + on-401 refresh (single in-flight, queued retries), forced logout
    api/auth-store.ts      external store for tokens + cached AdvertiserProfile (local/session storage, cross-tab sync)
    api/errors.ts          ApiError, describeApiError (copy keyed on ErrorCode), mapValidationErrors (→ form fields)
    api/index.ts           typed endpoint functions (authApi, legalApi, advertisersApi, campaignsApi, billingApi) built on API_ROUTES
    api/upload.ts          presign → PUT (XHR progress, abort) → storageKey; dev proxy URL rewrite
    query/                 QueryClient defaults + query-key factory
    utils/                 format (ETB/dates/numbers), budget split math, CSV export, media (duration/validation), cn,
                           markdown (dependency-free renderer for the legal documents)
    forms.ts               RHF helpers: server errors → fields / root banner, toastApiError
  components/
    ui/                    Button, Input/Textarea, Field, Card, Badge (+status badges), Dialog, ConfirmDialog, Select, Tabs,
                           Switch, Checkbox, DropdownMenu, Tooltip, Popover, Progress, Skeletons, Alert, Table/Pagination
    layout/                AppShell (sidebar, topbar, mobile drawer; hosts ProfileSync + TermsGate; chrome marked
                           print-hidden), PageHeader, BrandLogo, ThemeToggle, CommandPalette, VerificationBanner
    charts/                chart-kit (themed tooltip/legend/axes), StatCard
    feedback/              EmptyState / ErrorState + inline SVG illustrations
    motion/                PageTransition, Stagger/StaggerItem, ChartReveal, CountUp (reduced-motion aware)
    theme/                 theme store (light / dark / system, persisted, applied before first paint via index.html)
  features/
    auth/                  AuthProvider (login/register/logout), AuthLayout, LoginPage, RegisterPage (versioned terms), password strength
    legal/                 useCurrentTerms / useAcceptTerms, TermsDialog + AcceptTermsDialog (Markdown, 409 outdated handling),
                           TermsGate (banner + auto-opening modal when requiresTermsAcceptance)
    dashboard/             overview cards, spend/views charts, recent campaigns, wallet card, new-account empty state
    campaigns/             list (filter/search/sort), detail (timeline, budget, live counts, creatives, pause/resume/delete),
                           CampaignCard, submit flow (funds / verification / consent dialogs), StatusTimeline, CreativePreview,
                           frequency-cap (1–5 control + summary), media-status (badge, probe details, 5 s ads polling hook)
    campaigns/wizard/      machine.ts (pure step state machine), schemas (zod), steps, CreativeUploader, WizardPage
    analytics/             FraudFilterPanel, completions/spend charts, funnel, CSV export, overview aggregate, settings strip
    billing/               wallet, TopupDialog (+ in-app mock gateway, Idempotency-Key per intent), idempotent-topup (replay
                           polling on 409), TopupReturnPanel (poll → receipt), payments, invoices, ledger, printable InvoicePage
    settings/              live profile (GET/PATCH /advertisers/me), notification prefs, Legal card, change password, appearance
  test/                    MSW server/handlers/fixtures, renderWithApp helper
```

### Routing

`react-router` v8 data router with lazy route modules (`createBrowserRouter`). Public: `/login`, `/register`
(redirect home when signed in). Private (inside `AppShell`): `/` dashboard, `/campaigns`, `/campaigns/new`,
`/campaigns/:id`, `/campaigns/:id/edit`, `/campaigns/:id/analytics`, `/analytics`, `/billing`, `/billing/return`,
`/billing/invoices/:id`, `/settings`, `*` → designed 404. A root `errorElement` renders unexpected errors; a React
error boundary wraps the whole tree.

### State & data

- **Server state** lives in TanStack Query (`staleTime` 30 s, no retries on 4xx). Mutations invalidate the campaign,
  overview and billing keys. Campaign detail polls every 15 s while `active`/`pending_review`; the creative list
  polls every 5 s while any creative's `mediaStatus` is `processing` (10 min cap); the top-up return panel polls the
  payment every 2.5 s until it leaves `pending` (3 min cap); `GET /advertisers/me` refreshes the cached profile
  (60 s stale time) on every authenticated page load.
- **Auth** is a tiny external store consumed with `useSyncExternalStore`. Access + refresh tokens and the
  `AdvertiserProfile` are stored in `localStorage` ("Keep me signed in", default) or `sessionStorage`. The API client
  refreshes proactively when the JWT `exp` is within 20 s and on any 401; one refresh is shared by concurrent requests
  and every queued request retries with the new token. A failed refresh (`REFRESH_TOKEN_REUSED`, expired) clears the
  session, shows a toast keyed on the error code and the guard redirects to `/login` remembering `from`. The cached
  profile is patched from `GET /advertisers/me` and from consent acceptances, so gates react without a re-login.
- **Errors** are branched on `code`, never on `message`. `400 VALIDATION_ERROR` details map to form fields (unknown
  fields become a form-level banner); every mutation toasts on failure.
- **Wizard**: `machine.ts` is a pure reducer/guards module (tested). The page derives the state from the URL
  (`?step=`) plus server data — no duplicated local state. Steps before the draft exists are kept in
  `sessionStorage`; from the budget step on, every step is saved to the API and `/campaigns/:id/edit` resumes.

### Theming

Tailwind v4 `@theme` tokens define the shared brand palette (forest primary, terracotta accent, warm stone
neutrals, semantic colours, radii 8/12/16/24, soft warm shadows, keyframes). Mode-aware surface/text/border/chart
colours are CSS variables switched by the `.dark` class (`@custom-variant dark`) and exposed as utilities through
`@theme inline`. Theme preference (light / dark / system) is persisted and applied by an inline script before first
paint. Fonts are self-hosted: Inter Variable (body), Manrope Variable (display), Noto Sans Ethiopic (Ethiopic
fallback in both stacks — verified with Amharic campaign titles and business names). Stats/tables use tabular
numerals; interactive targets are ≥ 44 px; focus rings are visible; `prefers-reduced-motion` disables animations
(Framer Motion `MotionConfig reducedMotion="user"` + CSS).

## Design decisions

- **Fraud filtering as the hero.** The analytics page opens with a dark "We filtered N suspicious completions so you
  only pay for real attention" panel showing the filtered rate, the ETB _not_ charged, and flagged vs rejected with
  tooltips explaining each. Raw and verified numbers sit side by side everywhere (dashboard cards, campaign cards,
  detail page, charts, funnel, CSV).
- **Skeletons, never spinners.** Every page has a skeleton state; spinners only appear inside buttons.
- **Guided blockers instead of error toasts.** `INSUFFICIENT_WALLET_BALANCE` opens a dialog showing budget / balance /
  shortfall and an "Add funds and come back" path (pre-filled amount, returns to the campaign after settlement).
  `ADVERTISER_NOT_VERIFIED` explains the pending state; a successful submit while the cached profile says "pending"
  flips it to verified. `CONSENT_REQUIRED` opens the current terms; accepting them retries the submit automatically.
- **Transparent economics.** The budget step shows the per-action split using `computeRewardEtb` /
  `PLATFORM_DEFAULTS` ("viewer receives X, platform fee Y"), the coin equivalent and the estimated completions.
- **Charts are real** (Recharts) and themed through CSS variables so they follow light/dark automatically.
- **Command palette** (`Ctrl/⌘ K`) jumps to pages, actions and campaigns.

## Phase 4B features (built against the Phase 4A API)

| Feature                    | Where                                                                                                        | How it works                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Terms consent**          | Register, app shell (`TermsGate`), submit flow, Settings → Legal                                             | `GET /legal/current?audience=advertiser&locale=en` feeds a real "I accept the Terms v{version}" checkbox whose label opens the Markdown document; `termsVersion` is sent on register. After login `profile.requiresTermsAcceptance` shows a banner and auto-opens the accept modal (deferrable per version, per session); accepting posts `POST /advertisers/me/consents { kind: 'terms', version }` and patches the cached profile. `403 CONSENT_REQUIRED` on campaign submit opens the same modal and retries; `409 CONSENT_VERSION_OUTDATED` reloads the document. Settings → Legal shows accepted vs current version with acceptance time. |
| **Live profile**           | App shell (`ProfileSync`), Settings                                                                          | `GET /advertisers/me` refreshes the cached session profile (verification status, wallet, prefs, terms) — no re-login needed after approval. Business name / phone and notification preferences save through `PATCH /advertisers/me`; `POST /auth/advertiser/change-password` signs every session out and returns to login.                                                                                                                                  |
| **Frequency cap**          | Details step (new + edit), review step, campaign detail, analytics settings strip                            | Segmented 1–5 radio group (arrow keys, default `PLATFORM_DEFAULTS.DEFAULT_FREQUENCY_CAP`, zod-validated against `MIN/MAX_FREQUENCY_CAP`) → `frequencyCapPerUserPerDay` on `POST`/`PATCH /campaigns`. Helper text explains the "real attention, no repeat inflation" rationale.                                                                                                                                                                              |
| **Media processing**       | Creative step, review step, campaign detail, previews                                                        | `mediaStatus` badge (`processing` / `ready` / `duration_corrected` / `failed`) with probe facts (`width×height`, codec, bitrate, container). While any creative is `processing`, `useMediaProcessingPoll` polls `GET /campaigns/:id/ads` every 5 s and writes into the campaign-detail cache; it stops when nothing is processing, on error, or after 10 min ("taking longer than usual"). `duration_corrected` explains "declared Xs → measured Ys; the measured value is used"; `failed` shows `mediaError` with a re-upload path. Previews use `thumbnailUrl` (generated poster) and `mediaUrl` (720p transcode). Review warns that approval waits for processing but allows submission. |
| **Idempotent top-ups**     | `TopupDialog`, `features/billing/idempotent-topup.ts`                                                        | One `Idempotency-Key` (UUID) per intent — minted on the first "Continue to payment" for a given payload, reused on retries of that payload, fresh for a different amount. `409 IDEMPOTENCY_KEY_REUSED` with `details.inProgress: true` → wait 1.5 s and re-send the identical request (the API replays the memoised payment once the original finishes) with a "waiting instead of charging twice" status; `inProgress: false` (payload mismatch) surfaces the error and mints a new key next time. |
| **Invoice print (F7)**     | `globals.css`, `AppShell`                                                                                    | `@media print` hides everything marked `.print-hidden` / `[data-app-chrome]` (sidebar, top bar, theme toggle, avatar, terms banner), sonner toasts and Radix poppers, and resets `main` padding — Ctrl+P yields only the invoice.                                                                                                                                                                                                                         |
| **Analytics**              | Campaign analytics                                                                                           | A settings strip shows the campaign's frequency cap, attention check and approved-creatives count from the campaign summary. The analytics endpoint exposes no cap- or media-specific metrics, so nothing is estimated; the "What we do not show" card says so.                                                                                                                                                                                              |

## Assumptions (please review)

- **Brand name "Gize"** (ጊዜ) is a placeholder held in `src/config/brand.ts` (`BRAND_NAME`), as agreed across the
  three surfaces.
- **Wizard step order is details → budget & pricing → creatives → review** (the brief listed creatives before
  budget). `POST /campaigns` requires `budgetEtb` and `costPerActionEtb`, and creatives need a draft id, so the draft
  is created at the end of the budget step and creatives attach to it. Details/budget entered before that are kept in
  `sessionStorage` so a reload does not lose them.
- **Attention question lives on the creative**, not the campaign: the API takes `attentionQuestions` per ad, so the
  campaign-level toggle (`attentionCheckEnabled`) is on the details step and the question/options editor appears in
  the creative step when the toggle is on.
- **Client-side minimums**: budget ≥ ETB 100 and cost per action ≥ ETB 0.50 (from the `@rap/shared` DTO comments)
  even though the API accepts ≥ 1 / ≥ 0.01. Top-up minimum ETB 100.
- **Creatives are optional for survey / app-install campaigns** (only video campaigns get `CAMPAIGN_HAS_NO_ADS`); the
  wizard says so and allows "Skip and review".
- **Session storage**: tokens are kept in `localStorage` when "Keep me signed in" is ticked (default), otherwise in
  `sessionStorage`. Cross-tab rotation is synced through the `storage` event.
- **Verification status refresh**: `GET /advertisers/me` is fetched on every authenticated page load (`ProfileSync`,
  60 s stale time) and on the settings page, so approval shows up without a re-login.
- **Notification preferences live on the account** (`notificationPrefs` via `PATCH /advertisers/me`); the previous
  device-local store was removed.
- **Password change signs out everywhere**: the API revokes every refresh token, so the portal clears the session and
  returns to login after a successful change. Forgot-password still points to support (no API).
- **Terms locale**: the portal is English-only today, so `GET /legal/current` is requested with `locale=en`
  (the API falls back to `en` anyway). Deferring the consent modal is per published version and per browser session.
- **Idempotency scope**: a new key is minted per _payload_ (amount + return URL); re-submitting the same amount after a
  network / 5xx failure reuses it, a changed amount is a new intent. Error responses are not memoised by the API, so
  retrying after a 4xx/5xx with the same key is safe.
- **Search & sort on the campaign list are client-side** (the API only filters by `status`); the list fetches one page
  of 100.

## API / infra gaps found and how the portal works around them

| Gap                                                                                                                                                                                                     | Workaround in the portal                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~`POST /campaigns/uploads/presign` returned an `uploadUrl` on the Docker-internal host `http://minio:9000`~~ **Fixed in the API (Phase 3)**: URLs are now signed for `S3_PUBLIC_ENDPOINT`              | The dev proxy (`VITE_UPLOAD_INTERNAL_ORIGIN` → `/__media-upload/*`) stays available but is disabled by default; `resolveUploadUrl` is a no-op unless the variable is set.     |
| ~~The mock Chapa checkout page was blocked by its own CSP~~ **Fixed in the API**: the page script is served from `/billing/mock-checkout/assets/checkout.js` (no inline handlers)                       | The in-app "Test payment" dialog (public `POST /billing/mock-checkout/:txRef/pay`) is kept as the fastest demo path; the hosted mock page also works and redirects back.      |
| ~~The mock checkout ignored the custom `returnUrl`~~ **Fixed in the API**: it returns to the caller's `returnUrl` with `paymentId` + `txRef` appended                                                   | `/billing/return?paymentId&txRef` is the primary landing; `/billing?topup=…`, `tx_ref`, `trx_ref` and the `localStorage` txRef context remain as fallbacks for real gateways. |
| ~~No `GET /advertisers/me`, profile update, password change, notification preferences~~ **Added in the API**: `GET/PATCH /advertisers/me`, `POST /auth/advertiser/change-password`                      | **Wired in Phase 4B**: `ProfileSync` refreshes the cached profile; Settings edits name/phone/prefs and changes the password through the live endpoints.                      |
| ~~`PaymentItem`/`TopupResponse` `mock`/`returnUrl` missing from `@rap/shared`~~ **Fixed in `@rap/shared`**                                                                                              | `isMockPayment` now reads a declared field.                                                                                                                                   |
| `GET /campaigns` has no search/sort; ~~OpenAPI minimums differed from the shared constants~~ **Fixed**: `PLATFORM_DEFAULTS.MIN_CAMPAIGN_BUDGET_ETB` / `MIN_COST_PER_ACTION_ETB` are the source of truth | Client-side search/sort.                                                                                                                                                      |
| No attention pass-rate or demographics in `CampaignAnalytics`                                                                                                                                           | Explicitly _not_ shown (a card explains why) rather than inventing numbers.                                                                                                   |
| `CampaignAnalytics` has no frequency-cap (views hidden / repeat completions prevented) or media metrics                                                                                                 | The analytics page shows the campaign's cap/attention/creative settings from the summary and states that hidden-by-cap counts are not reported; nothing is estimated.         |
| The `POST /auth/advertiser/change-password` response (`{ changed, sessionsRevoked }`) and the `GET/POST /advertisers/me/consents` response are not typed in `@rap/shared`                               | Typed locally in `src/lib/api/index.ts` (`ChangePasswordResponse`, `AdvertiserConsentState`) — candidates for `packages/shared`.                                              |
| `409 IDEMPOTENCY_KEY_REUSED { inProgress: true }` gives no payment id to poll                                                                                                                            | The portal re-sends the identical request after 1.5 s (max 20 times); the API answers with the memoised response once the first request finishes, which is the intended replay. |
| An "outdated consent" advertiser cannot be seeded live (only terms v1.0 is published)                                                                                                                   | That path (`requiresTermsAcceptance`, banner + modal, `CONSENT_REQUIRED` retry, `CONSENT_VERSION_OUTDATED`) is covered by MSW tests with an `outdatedTermsProfileFixture`.       |
| The API's `CORS_ORIGINS` only lists 5173/5174/8081, but the nginx container occupies 5173 during development                                                                                            | `VITE_API_URL=` (empty) makes the client call relative `/api/v1` URLs and the Vite dev server proxies them (`VITE_DEV_API_PROXY_TARGET`), so any dev port works same-origin. |

## Verification performed

- `pnpm --filter @rap/advertiser-web typecheck | lint | test | build` all pass (105 tests: the 55 original plus 50
  Phase 4B tests — terms gate / accept modal / 409 outdated / deferral, register `termsVersion`, `CONSENT_REQUIRED`
  retry in the submit flow, frequency-cap schema 1–5 + radio control, media badge / probe notes / review warnings,
  ads polling start / stop / timeout, idempotency key reuse + `inProgress` replay-poll, settings live endpoints,
  Legal card, print CSS + chrome markers, safe Markdown renderer).
- Phase 3 manual E2E through the real UI against the live API with Playwright/Chromium: register → pending dashboard →
  wizard (validation, draft creation) → real WebM upload to MinIO via presign/PUT → attention question → review →
  submit blocked by verification (dialog) → admin verifies → re-login → submit blocked by funds (dialog) → guided
  top-up (mock gateway) → receipt → back to campaign → submit → in review → admin approves → active (live badge) →
  pause → resume → analytics (empty state) → billing history → invoices → printable invoice → settings → list search.
- Phase 4B live E2E (Playwright/Chrome against the dev server on 5175 → API container, 19/19 checks, zero console
  errors): register with the versioned terms dialog (`termsVersion` recorded, no gate) → admin verifies via API →
  settings refresh verification without re-login, Legal card shows accepted vs current, `PATCH /advertisers/me`
  saves name + preference → top-up with `Idempotency-Key` (same key + payload replays with `Idempotent-Replayed:
  true` and no second payment; same key + different payload → `409 IDEMPOTENCY_KEY_REUSED { inProgress: false }`)
  → wizard with frequency cap 2 (persisted on the draft) → upload `apps/api/prisma/seed-assets/eid-promo.mp4` →
  "Processing media" badge → `ready` after ~5 s via the 5 s poll with probe facts (480×270 · H264 · 20 kbps · mov),
  `mediaUrl` = 720p transcode + generated poster → review shows cap + media badge → submit → detail shows cap + probe
  → invoice under `@media print` renders only the document (aside/header/`.print-hidden` all `display: none`) →
  change password → sessions revoked → re-login with the new password.
- Every route rendered in light and dark at 1440×900 and the dashboard at 390×844 with zero console errors/warnings
  (screenshots kept outside the repo).

## Known issues / not done

- Seeded demo creatives point at `commondatastorage.googleapis.com`; previews show "Preview unavailable" when that host
  is blocked or offline. Uploaded creatives (MinIO `localhost:9000`) preview fine.
- Paused campaigns cannot increase their budget from the portal yet (the API allows it via `PATCH`); the detail page
  explains the state and offers pause/resume only.
- Forgot-password depends on API support (none yet); it points to support.
- The terms document is requested in English only; Amharic/Oromo/Tigrinya legal copy would need a locale switch.
- The media-processing poll is per mounted page (detail page or wizard); leaving the page stops it and the next visit
  resumes it. Reviewer-side "reprocess media" is an admin action, so a failed creative can only be replaced here.
- Recharts + jsdom make the dashboard component test slow on a cold start (timeout raised to 20 s for that file);
  the new full-shell / user-event heavy test files use the same 20 s budget.
