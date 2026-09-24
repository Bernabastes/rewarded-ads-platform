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

Other scripts (run from the root with `--filter @rap/advertiser-web`, or inside the folder):

| Script      | What it does                                             |
| ----------- | -------------------------------------------------------- |
| `dev`       | Vite dev server on port 5173 (strict port)               |
| `build`     | Production build to `dist/` (route-level code splitting) |
| `preview`   | Serve the production build on 5173                       |
| `typecheck` | `tsc --noEmit` (strict, `noUnusedLocals`)                |
| `lint`      | ESLint 10 flat config (React hooks/compiler, a11y)       |
| `test`      | Vitest (jsdom + MSW), 55 tests                           |

Demo accounts (password `Advertiser123!`): `ads@habesha-coffee.et`, `growth@addisfintech.et` (verified, with data),
`hello@shegerfashion.et` (pending verification). Register new advertisers freely — they start in the pending state.

## Environment variables (`.env.example` → `.env.local`)

| Variable                      | Default                  | Purpose                                                                                                        |
| ----------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `VITE_API_URL`                | `http://localhost:3000`  | API origin; `API_BASE_PATH` (`/api/v1`) from `@rap/shared` is appended                                         |
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
    api/index.ts           typed endpoint functions (authApi, campaignsApi, billingApi) built on API_ROUTES
    api/upload.ts          presign → PUT (XHR progress, abort) → storageKey; dev proxy URL rewrite
    query/                 QueryClient defaults + query-key factory
    utils/                 format (ETB/dates/numbers), budget split math, CSV export, media (duration/validation), cn
    forms.ts               RHF helpers: server errors → fields / root banner, toastApiError
  components/
    ui/                    Button, Input/Textarea, Field, Card, Badge (+status badges), Dialog, ConfirmDialog, Select, Tabs,
                           Switch, Checkbox, DropdownMenu, Tooltip, Popover, Progress, Skeletons, Alert, Table/Pagination
    layout/                AppShell (sidebar, topbar, mobile drawer), PageHeader, BrandLogo, ThemeToggle, CommandPalette,
                           VerificationBanner
    charts/                chart-kit (themed tooltip/legend/axes), StatCard
    feedback/              EmptyState / ErrorState + inline SVG illustrations
    motion/                PageTransition, Stagger/StaggerItem, ChartReveal, CountUp (reduced-motion aware)
    theme/                 theme store (light / dark / system, persisted, applied before first paint via index.html)
  features/
    auth/                  AuthProvider (login/register/logout), AuthLayout, LoginPage, RegisterPage, password strength
    dashboard/             overview cards, spend/views charts, recent campaigns, wallet card, new-account empty state
    campaigns/             list (filter/search/sort), detail (timeline, budget, live counts, creatives, pause/resume/delete),
                           CampaignCard, submit flow (funds / verification dialogs), StatusTimeline, CreativePreview
    campaigns/wizard/      machine.ts (pure step state machine), schemas (zod), steps, CreativeUploader, WizardPage
    analytics/             FraudFilterPanel, completions/spend charts, funnel, CSV export, overview aggregate
    billing/               wallet, TopupDialog (+ in-app mock gateway), TopupReturnPanel (poll → receipt), payments,
                           invoices, ledger, printable InvoicePage
    settings/              profile, verification, notification prefs (local), appearance, security
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
  overview and billing keys. Campaign detail polls every 15 s while `active`/`pending_review`; the top-up return
  panel polls the payment every 2.5 s until it leaves `pending` (3 min cap).
- **Auth** is a tiny external store consumed with `useSyncExternalStore`. Access + refresh tokens and the
  `AdvertiserProfile` are stored in `localStorage` ("Keep me signed in", default) or `sessionStorage`. The API client
  refreshes proactively when the JWT `exp` is within 20 s and on any 401; one refresh is shared by concurrent requests
  and every queued request retries with the new token. A failed refresh (`REFRESH_TOKEN_REUSED`, expired) clears the
  session, shows a toast keyed on the error code and the guard redirects to `/login` remembering `from`.
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
  flips it to verified.
- **Transparent economics.** The budget step shows the per-action split using `computeRewardEtb` /
  `PLATFORM_DEFAULTS` ("viewer receives X, platform fee Y"), the coin equivalent and the estimated completions.
- **Charts are real** (Recharts) and themed through CSS variables so they follow light/dark automatically.
- **Command palette** (`Ctrl/⌘ K`) jumps to pages, actions and campaigns.

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
- **Verification status refresh**: there is no profile endpoint, so the cached profile is refreshed on login; the
  pending banner tells advertisers to sign in again after approval.
- **Notification preferences are stored on the device** (localStorage) until the API exposes advertiser-level
  preferences; the settings page says so.
- **No forgot-password / password change** in the UI because the API offers neither; both point to support.
- **Search & sort on the campaign list are client-side** (the API only filters by `status`); the list fetches one page
  of 100.

## API / infra gaps found and how the portal works around them

| Gap                                                                                                                                                                                                     | Workaround in the portal                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~`POST /campaigns/uploads/presign` returned an `uploadUrl` on the Docker-internal host `http://minio:9000`~~ **Fixed in the API (Phase 3)**: URLs are now signed for `S3_PUBLIC_ENDPOINT`              | The dev proxy (`VITE_UPLOAD_INTERNAL_ORIGIN` ? `/__media-upload/*`) stays available but is disabled by default; `resolveUploadUrl` is a no-op unless the variable is set.     |
| ~~The mock Chapa checkout page was blocked by its own CSP~~ **Fixed in the API**: the page script is served from `/billing/mock-checkout/assets/checkout.js` (no inline handlers)                       | The in-app "Test payment" dialog (public `POST /billing/mock-checkout/:txRef/pay`) is kept as the fastest demo path; the hosted mock page also works and redirects back.      |
| ~~The mock checkout ignored the custom `returnUrl`~~ **Fixed in the API**: it returns to the caller's `returnUrl` with `paymentId` + `txRef` appended                                                   | `/billing/return?paymentId&txRef` is the primary landing; `/billing?topup=�`, `tx_ref`, `trx_ref` and the `localStorage` txRef context remain as fallbacks for real gateways. |
| ~~No `GET /advertisers/me`, profile update, password change, notification preferences~~ **Added in the API**: `GET/PATCH /advertisers/me`, `POST /auth/advertiser/change-password`                      | The settings page still caches the profile from login; wiring the new endpoints into the settings UI is a follow-up (see "Before production").                                |
| ~~`PaymentItem`/`TopupResponse` `mock`/`returnUrl` missing from `@rap/shared`~~ **Fixed in `@rap/shared`**                                                                                              | `isMockPayment` now reads a declared field.                                                                                                                                   |
| `GET /campaigns` has no search/sort; ~~OpenAPI minimums differed from the shared constants~~ **Fixed**: `PLATFORM_DEFAULTS.MIN_CAMPAIGN_BUDGET_ETB` / `MIN_COST_PER_ACTION_ETB` are the source of truth | Client-side search/sort.                                                                                                                                                      |
| No attention pass-rate or demographics in `CampaignAnalytics`                                                                                                                                           | Explicitly _not_ shown (a card explains why) rather than inventing numbers.                                                                                                   |

## Verification performed

- `pnpm --filter @rap/advertiser-web typecheck | lint | test | build` all pass (55 tests).
- Manual E2E through the real UI against the live API with Playwright/Chromium: register → pending dashboard →
  wizard (validation, draft creation) → real WebM upload to MinIO via presign/PUT → attention question → review →
  submit blocked by verification (dialog) → admin verifies → re-login → submit blocked by funds (dialog) → guided
  top-up (mock gateway) → receipt → back to campaign → submit → in review → admin approves → active (live badge) →
  pause → resume → analytics (empty state) → billing history → invoices → printable invoice → settings → list search.
- Every route rendered in light and dark at 1440×900 and the dashboard at 390×844 with zero console errors/warnings
  (screenshots kept outside the repo).

## Known issues / not done

- Seeded demo creatives point at `commondatastorage.googleapis.com`; previews show "Preview unavailable" when that host
  is blocked or offline. Uploaded creatives (MinIO `localhost:9000`) preview fine.
- Paused campaigns cannot increase their budget from the portal yet (the API allows it via `PATCH`); the detail page
  explains the state and offers pause/resume only.
- Forgot-password, password change and notification preferences depend on API support (see above).
- Recharts + jsdom make the dashboard component test slow on a cold start (timeout raised to 20 s for that file).
