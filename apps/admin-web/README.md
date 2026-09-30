# @rap/admin-web — Gize Admin

Internal admin console for the Rewarded Ads Platform (Ethiopia): ad review (with the media-pipeline gate), user /
advertiser management, KYC queue, fraud triage, money-day alerts, referrals, account-deletion requests, read-only
user impersonation, the withdrawal queue with dual approval, two-step manual coin adjustments, revenue, audit log and
platform configuration. React 19 + TypeScript strict + Vite 7 + Tailwind CSS v4, talking to the NestJS API through the
`@rap/shared` contract.

> **Brand placeholder.** The product name **"Gize"** (Amharic ጊዜ, "time") is a working title chosen for this build.
> It lives in one place — `src/lib/brand.ts` (`BRAND_NAME`, `BRAND_NAME_AM`, `APP_NAME`) — so it can be swapped
> without touching any page.

---

## Run it

```bash
pnpm install                                   # from the repo root (also builds @rap/shared)
cp apps/admin-web/.env.example apps/admin-web/.env   # optional; defaults to http://localhost:3000
pnpm --filter @rap/admin-web dev               # http://localhost:5174 (strict port)

pnpm --filter @rap/admin-web typecheck         # tsc (app + node configs)
pnpm --filter @rap/admin-web lint              # eslint (root flat config + react-hooks)
pnpm --filter @rap/admin-web test              # vitest + testing-library + msw (98 tests)
pnpm --filter @rap/admin-web build             # vite build → dist/
pnpm --filter @rap/admin-web preview           # serve dist/ on :5174
```

The API must be running (Docker container `rap-api`, or `pnpm dev:api`) at `VITE_API_URL`; CORS already allows
`http://localhost:5174`. Health: `GET http://localhost:3000/health/ready`.

**Another port / same-origin mode.** When :5174 is taken (e.g. by the nginx container `rap-admin-web`) run the dev
server on any port and let Vite proxy the API so the browser stays same-origin and CORS never applies:

```bash
VITE_API_URL=/ pnpm --filter @rap/admin-web exec vite --port 5176 --strictPort
# PowerShell:  $env:VITE_API_URL='/'; pnpm --filter @rap/admin-web exec vite --port 5176 --strictPort
```

`vite.config.ts` forwards `/api/*` to `VITE_DEV_PROXY_TARGET` (default `http://localhost:3000`); `VITE_API_URL=/`
(or empty) makes the client call the relative `/api/v1`.

### Environment variables

| Variable                | Default                 | Purpose                                                                                                   |
| ----------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `VITE_API_URL`          | `http://localhost:3000` | Origin of the API. `API_BASE_PATH` (`/api/v1`) from `@rap/shared` is appended. `/` = same-origin (proxy). |
| `VITE_DEV_PROXY_TARGET` | `http://localhost:3000` | Where the Vite dev/preview server forwards `/api/*` (dev only).                                           |

### Demo accounts (seeded; password `Admin123!`)

| Email             | Role          | What you can do in the console                                                                                          |
| ----------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `super@rap.et`    | `super_admin` | Everything, incl. "Run alert rules now"                                                                                 |
| `reviewer@rap.et` | `ad_reviewer` | Ad review queue (media gate, reprocess), campaign moderation, ad reports                                                |
| `support@rap.et`  | `support`     | Users (suspend/ban/reinstate, impersonate), KYC, advertiser verification, fraud, alerts, referrals, deletions, audit    |
| `finance@rap.et`  | `finance`     | Withdrawals, coin adjustments, revenue, KYC, alerts, referrals, fraud, audit (users/campaigns read-only)                 |
| `finance2@rap.et` | `finance`     | Second finance account — use it to give the _second_ approval                                                           |

---

## Architecture

```
src/
  main.tsx                 entry: fonts + globals.css, QueryClient, <App/>
  app/
    App.tsx                session bootstrap (useAuthBootstrap) + RouterProvider
    router.tsx             route tree; every page is lazy, wrapped in ErrorBoundary + Suspense + <RequireRole>
    navigation.ts          sidebar sections / command-palette items / "g + key" shortcuts (single source)
    providers.tsx          TanStack QueryClient (retry policy, background-error toasts), Tooltip provider, Toaster
  lib/
    brand.ts               BRAND_NAME placeholder + storage prefix
    env.ts                 VITE_API_URL → apiOrigin / apiBaseUrl
    api/
      client.ts            fetch wrapper: bearer auth, proactive + reactive refresh, single in-flight refresh,
                           queued retries, auth-loss callback, ApiError envelopes, query-string builder
      token-store.ts       in-memory tokens mirrored to localStorage (+ cross-tab sync)
      api.ts               singletons: tokenStore, authStore, api (wired to force logout on refresh failure)
      endpoints.ts         typed functions per resource, all paths from API_ROUTES (@rap/shared)
      errors.ts            ApiError, field-error mapping for react-hook-form, code → friendly message
      query-keys.ts        TanStack Query key factory (consistent invalidation)
      types.ts             local widening of shared types for fields the API returns but the contract omits
    auth/
      auth-store.ts        tiny external store (useSyncExternalStore) for { status, admin, lastLogoutReason }
      use-auth.ts          useAuth() → login / logout / can(); useAuthBootstrap() restores + keeps sessions warm
      rbac.ts              ACCESS matrix mirroring the API's @Roles decorators; can(role, key); role labels
      impersonation-store.ts  in-memory "view as user" session (token, expiry timer, countdown hook) - never persisted
    domain/
      review-rules.ts      banned-topics checklist gating, rejection-reason composer, media-pipeline gate (MEDIA_NOT_READY)
      finance-rules.ts     dual-approval state (approvals[] vs me), adjustment self-approval guard, retry rules
      kyc-rules.ts         provider pre-check parsing / grading, reviewer warnings, presigned-link expiry
      data-rights-rules.ts deletion execute block (in-flight withdrawals), overdue detection
      config-labels.ts     labels for the mock-provider flags
    hooks/                 use-theme (light/dark/system), use-hotkeys (token map), use-list-params (URL state),
                           use-misc (debounce, media query, clipboard, ticking clock), use-queue-counters (sidebar badges)
    utils/                 cn, format (ETB/coins/dates/relative), json-diff (audit before/after), csv (export), ids (uuid)
  components/
    ui/                    Button, Input/Textarea/NativeSelect/Field, Badge/StatusBadge/SeverityBadge/media + alert tones,
                           Card, Dialog (+ bare/hideHeader for the palette)/Sheet, ConfirmDialog/ReasonDialog,
                           Tabs/Tooltip/Checkbox/DropdownMenu, DataTable (TanStack Table + react-virtual, sticky header,
                           expandable rows, plain fallback when the viewport cannot be measured) + PaginationBar,
                           StatCard/CountUp (Framer Motion), Skeleton*, Empty/Error/NoAccess states, JsonView/DiffView
    layout/                AppShell (topbar, impersonation banner, page transitions, "g" sequences, ? help), Sidebar
                           (role-aware, live queue counters incl. KYC / alerts / deletions), CommandPalette (cmdk, pinned input)
    guards/                RequireAuth, RedirectIfAuthed, RequireRole, BootSplash
  features/<area>/         one folder per page area (overview, review, campaigns, reports, installs, users (+ view-as),
                           kyc, alerts, referrals, deletion, advertisers, fraud, withdrawals, adjustments, revenue,
                           audit, config, auth, errors)
  test/                    vitest setup, MSW server + handlers + fixtures, renderWithProviders helper
  styles/globals.css       Tailwind v4 @theme tokens, light/dark variables, fonts, utilities, overlay keyframes
```

### Routing

`react-router` v7 data router. `/login` is public; everything else sits under `<RequireAuth>` → `<AppShell>`.
Detail views that are drawers keep their id in the URL (`/withdrawals/:id`, `/adjustments/:id`, `/fraud/:id`,
`/review/:adId`, `/kyc/:id`) so any record is deep-linkable and the browser back button closes the panel. List
filters, tabs and pagination live in the query string (`useListParams`) so views are shareable and survive reloads
(e.g. `/review?status=pending&mediaStatus=failed` opens the review queue filtered to creatives whose media pipeline
failed; the filter chips next to the Pending/Approved/Rejected tabs drive `GET /admin/ads/review-queue?mediaStatus=`).
`/users/:id/view-as` is the read-only impersonation panel (needs an in-memory session; a reload shows an explanation).

### RBAC

The server is authoritative (`403 ROLE_NOT_ALLOWED`). The UI mirrors the matrix in `src/lib/auth/rbac.ts`
(copied from `apps/api/src/modules/admin/controllers/admin.controllers.ts` and the Phase 4A module controllers):

| Area                                   | super_admin | ad_reviewer | support | finance |
| -------------------------------------- | :---------: | :---------: | :-----: | :-----: |
| Overview, platform config              |      ✓      |      ✓      |    ✓    |    ✓    |
| Ad review queue, approve/reject ads    |      ✓      |      ✓      |         |         |
| Reprocess media                        |      ✓      |      ✓      |         |         |
| Ad detail (read)                       |      ✓      |      ✓      |    ✓    |         |
| Campaign lists & detail                |      ✓      |      ✓      |    ✓    |    ✓    |
| Campaign approve/reject                |      ✓      |      ✓      |         |         |
| Campaign pause/resume                  |      ✓      |      ✓      |    ✓    |         |
| Ad reports                             |      ✓      |      ✓      |    ✓    |         |
| Users (list/detail)                    |      ✓      |             |    ✓    |    ✓    |
| Users suspend/ban/reinstate            |      ✓      |             |    ✓    |         |
| Impersonate (read-only "view as user") |      ✓      |             |    ✓    |         |
| KYC queue, approve/reject              |      ✓      |             |    ✓    |    ✓    |
| Alerts (list, acknowledge)             |      ✓      |             |    ✓    |    ✓    |
| Alerts: run rules now                  |      ✓      |             |         |         |
| Referrals                              |      ✓      |             |    ✓    |    ✓    |
| Deletion requests (execute/cancel)     |      ✓      |             |    ✓    |         |
| Advertisers (list/detail)              |      ✓      |      ✓      |    ✓    |    ✓    |
| Advertiser verify/reject               |      ✓      |             |    ✓    |         |
| Fraud dashboard + actions              |      ✓      |             |    ✓    |    ✓    |
| Withdrawals, coin adjustments, revenue |      ✓      |             |         |    ✓    |
| Audit log                              |      ✓      |             |    ✓    |    ✓    |
| App-install verification               |      ✓      |             |    ✓    |         |

> The brief described alerts as "all roles read", but `GET /admin/alerts` is gated to support / finance / super_admin
> on the API (`ad_reviewer` gets 403), so the page is hidden from reviewers too.

`can(role, key)` drives: which sidebar sections / palette items render, `<RequireRole>` on every route (renders a
designed "no access" state instead of the page), and per-action buttons inside pages (e.g. finance sees users but
no Suspend button). Any `403` the server still returns is rendered through `describeError` (friendly text keyed on
`code`, never on `message`).

### Data layer

- **TanStack Query** for all server state; keys from `query-keys.ts`; mutations invalidate the affected families
  (`['withdrawals']`, `['users']`, `overview`, …) and patch the detail cache with the server response so drawers
  update instantly. Queues poll (`refetchInterval`) so the sidebar counters stay live.
- **Auth**: `POST /auth/admin/login` → tokens; role/permissions always come from `GET /admin/me`. The client
  refreshes proactively 20 s before expiry and reactively on `401 TOKEN_EXPIRED`; concurrent callers share one
  refresh and are retried with the new token. Any refresh failure (incl. `REFRESH_TOKEN_REUSED`) or a non-expiry
  401 clears the session and the login page explains why. A 30 s timer keeps long-lived tabs refreshed.
- **Errors**: `ApiError { status, code, details }`; `400 VALIDATION_ERROR` details are mapped onto form fields
  (`applyFieldErrors`), other codes go to `sonner` toasts. Every mutation has a success and a failure toast.
- **Idempotency**: `POST /admin/coin-adjustments` carries an `Idempotency-Key` (one UUID per "Submit" intent, reused
  on retries of the same payload, rotated after every server response). `409 IDEMPOTENCY_KEY_REUSED` closes the form
  and refreshes the list (`details.inProgress` distinguishes "still running" from "different payload").
- **Impersonation**: `POST /admin/users/:id/impersonate` returns a 10-minute read-only user token. It is kept only in
  `impersonationStore` (module memory - never localStorage, never the admin `ApiClient`), sent explicitly as the
  bearer of `anonymous` requests so the client never tries to refresh it, and dropped on expiry / logout / auth loss.
  The view-as panel calls `/users/me`, `/users/me/balance`, `/users/me/ledger`, `/ads/feed`, `/withdrawals` and
  `/users/me/notifications`; a 401 marks the session expired, a 403 `IMPERSONATION_READ_ONLY` renders a blocked state.
- **Live queue counters**: `useQueueCounters` merges `GET /admin/overview` with one-row list requests for pending KYC
  (`meta.total`), open alerts (`meta.openCount`) and pending deletion requests, each only when the role may call it.
- **Shared contract**: enums, `API_ROUTES`, `ErrorCode`, `BANNED_TOPICS`, `PLATFORM_DEFAULTS`, money helpers and
  all admin types are imported from `@rap/shared`. `src/lib/api/types.ts` only widens a few response fields the API
  returns but the shared types don't declare yet (see "API gaps").

### Theming & design system

- Tailwind v4 `@theme` tokens in `globals.css`: forest (primary), terracotta (accent), warm stone (neutral),
  semantic success/warning/danger/info; severity scale low=info, medium=warning, high=accent, critical=danger.
- Mode-dependent surfaces are CSS variables (`--surface-*`, `--text-*`, `--primary`, …) exposed as utilities
  (`bg-bg`, `bg-surface`, `text-fg`, `text-fg-muted`, `border-border`, `bg-primary`, …). Dark mode is the
  `html.dark` class; `useTheme` persists light / dark / system and an inline script in `index.html` applies the
  stored preference before first paint.
- Fonts are self-hosted via Fontsource: Inter Variable (UI), Noto Sans Ethiopic (Amharic names/titles render
  without tofu), JetBrains Mono Variable (ids, JSON, phone numbers). Tables use tabular numerals.
- Motion: Framer Motion for page transitions, count-ups and queue row enter/exit; overlay keyframes in CSS.
  `prefers-reduced-motion` disables both (`useReducedMotion` + a global media query).
- Density: 14 px base, 32 px controls, 40 px table rows, virtualised tables (`@tanstack/react-virtual`) for the
  audit log and fraud flags, split-pane review, right-hand drawers for record detail.

### Keyboard

`Ctrl/⌘ K` command palette (the search box stays pinned while the list scrolls) · `?` shortcut help · `Ctrl/⌘ ⇧ L`
theme · `g` then `o r c p i u k n d v f t w a e l g` jump to a section (k = KYC, n = referrals, d = deletion
requests, t = alerts) · in the review queue `J/K` (or arrows) move, `1–8` toggle a banned-topic checkbox, `⇧ A` tick
all, `A` approve (only when 8/8, nothing flagged **and the media is ready**), `R` reject, `Esc` closes panels · in the
KYC queue `J/K` move, `A` approve…, `R` reject…, `Z` zoom the front document (`←/→` switch documents) ·
`Ctrl/⌘ Enter` submits reason dialogs.

---

## What each page does

| Route                | Highlights                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/login`             | Email + password, field-level validation, explains expired / revoked sessions, silent restore on reload.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `/`                  | Count-up tiles for every queue the role can act on — incl. **open alerts, pending KYC, pending deletion requests** — today's completions / flagged share / revenue, 7-day fraud filter chart, shortcuts. Refreshes every 30 s.                                                                                                                                                                                                                                                                                                                                       |
| `/review`            | Split pane: pending / approved / rejected tabs, list with thumbnails, open-report markers and a **media-status chip**, media player, **media pipeline card** (status, declared → probed duration, `WxH codec`, poster, **Reprocess media**), campaign + advertiser context, attention questions, banned-topics checklist — **Approve stays disabled until 8/8 and while `mediaStatus` is `processing` / `failed`** (the queue polls every 10 s while something is processing), structured reject dialog, optimistic queue removal, decision record on history tabs. |
| `/campaigns`         | Status tabs, spend/budget progress, valid vs raw completions; detail with 30-day chart, fraud-filtered rate, creatives table, approve / reject (refund) / pause / resume with reasons.                                                                                                                                                                                                                                                                                                                                                                             |
| `/ad-reports`        | Open / reviewed / dismissed; close a report with a note and optionally pull the ad (reason required).                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `/app-installs`      | Verify (credits the user) or reject install claims.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `/users`             | Search by phone / name, status and trust-score filters, dense table. Detail: profile, stats, **KYC card** (tier, latest submission, pre-check, link to the queue), **deletion-request card** (scheduled date, execute block explanation), **referral stats** (invite code, invited / paid / bonus), ledger, withdrawals, fraud flags, devices, audit trail; suspend / ban / reinstate with mandatory reason; **Impersonate (read-only)** → reason/ticket dialog → `/users/:id/view-as`.                                                                                     |
| `/users/:id/view-as` | What the user's app shows: profile + consent state, balance / ledger checksum / ledger, ad feed with daily-cap and frequency-cap meta, withdrawals (masked), notifications — all through the read-only token, with a persistent banner "Viewing as {phone} — read-only, expires in mm:ss", no write actions anywhere, expiry → banner turns red and the panel closes.                                                                                                                                                                                              |
| `/kyc`               | Pending / approved / rejected tabs, id-type filter, search (phone / name / last 4). Drawer: the three **presigned documents** (5-minute links — fetched fresh on every open, live "expires in mm:ss" countdown, refresh, zoom lightbox with `←/→`), submitted name / DOB vs profile with match badges, **duplicate-identity** warning (links to the matching last-4 searches), **registry pre-check** card (score, matches, MOCK badge, raw JSON), warnings summary; **Approve** (optional note) / **Reject** (reason shown to the user), toasts, optimistic queue removal, `J/K/A/R/Z` hotkeys. |
| `/alerts`            | Money-day alerts with state / type / severity / date filters, severity colouring, expandable rows with the **payload JSON** and deliveries, **Acknowledge** (409 `ALERT_ALREADY_ACKNOWLEDGED` → "refresh"), **Run rules now** (super admin) with a per-rule raised / checked summary, notifier pills (`log · mock`), sidebar badge from `meta.openCount`. Reachable from the palette ("Run alert rules now").                                                                                                                                                       |
| `/referrals`         | Metrics cards (total / paid / bonus coins paid as platform cost / rejected / last 7 days), top referrers, table with status, referrer / referee (links to users), bonuses, **rejection reason** (tooltip explains `self_referral_device`, …), signup IP / device fingerprint, created / qualified / paid dates; filters by status / referrer / referee id.                                                                                                                                                                                                             |
| `/deletion-requests` | Pending / executed / cancelled tabs, `scheduledFor` with grace period and "due" marker, in-flight withdrawals count — **Execute is disabled with an explanation while > 0** —, **Execute now** / **Cancel request** dialogs (optional note) that spell out that anonymisation keeps the ledger, withdrawals and audit rows.                                                                                                                                                                                                                                        |
| `/advertisers`       | Pending verification / verified / rejected; detail with registration details, wallet + lifetime spend, campaigns; verify / reject with reason.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `/fraud`             | Weekly flagged %, open flags by severity (donut), by rule (bars), daily trend; virtualised flags table with severity colouring and filters; drawer with metadata JSON, sibling-flag awareness — **the dismiss confirmation states when dismissing will credit the completion**; escalate (−10 trust) / suspend user (reason).                                                                                                                                                                                                                                       |
| `/withdrawals`       | Tabs per status; first-withdrawal marker, dual-approval progress; drawer with user, masked destination (reveal toggle), **partner-confirmed account holder + verified-at** (or "not verified" for known destinations), approvals list, provider info; **Approve disabled when the current admin is already in `approvals[]`**, "1 of 2" progress, reject (refund) with reason, retry failed payouts (≤ 3 attempts).                                                                                                                                                       |
| `/adjustments`       | Two-step workflow: create (user combobox, ± coins with ETB preview, reason, reference, **Idempotency-Key per intent**), list by status; drawer with decision trail; **Approve disabled for the requester**, cancel own pending request, executed requests link to the ledger entry and audit rows.                                                                                                                                                                                                                                                                  |
| `/revenue`           | Presets / custom UTC range; cards for platform revenue, **referral bonuses (platform cost)** and **net platform revenue**, spend, payouts, top-ups; revenue-over-time chart (+ net line), take-rate donut, top advertisers, by action type, daily table with referral-bonus and net columns, CSV export (daily incl. the new columns + advertisers).                                                                                                                                                                                                                  |
| `/audit`             | Filters ("Action or target type" search, **Actor** = admin / advertiser email, user phone or id sent as `actor=` and resolved server-side, with a status chip, action prefix, actor type, target type / id, date range), virtualised table showing the server-side **actor label (email / phone) next to every actor**, expandable rows with before/after diff + raw JSON + metadata, CSV export of the page (incl. actor label). Target ids link to their record (incl. KYC submissions, alerts, deletion requests).                                                                                                                  |
| `/config`            | Read-only effective platform config with `@rap/shared` defaults for comparison; economics, completion rules, fraud engine, **KYC & payout destinations, frequency caps & referrals, data rights & alert-rule thresholds**; all seven mock-provider flags labelled (`sms`, `payouts`, `paymentGateway`, `push`, `idVerification`, `alerts`, `destinationLookup`).                                                                                                                                                                                                       |

---

## Verification

- `pnpm --filter @rap/admin-web typecheck | lint | test | build` and root `pnpm typecheck | lint | test` pass.
- Vitest (98 tests): API client (refresh on `TOKEN_EXPIRED`, single in-flight refresh with queued retries, logout on
  `REFRESH_TOKEN_REUSED` / invalid token, proactive refresh, anonymous requests, network errors), RBAC matrix (incl.
  the Phase 4A routes), banned-topics gating, **media-pipeline gating**, dual-approval + self-approval guards,
  **KYC pre-check grading / warnings / link expiry**, **deletion execute block**, **impersonation store (memory-only
  token, timer, expiry)**, JSON diff, CSV escaping, field-error mapping, hotkey tokens, palette ranking; component
  tests with MSW for the login page, review pane (checklist + **processing / failed / duration-corrected media**),
  withdrawal sheet, adjustment form / sheet, **KYC queue (list, drawer, approve + optimistic removal, reject requires a
  reason, `KYC_NOT_PENDING`, role guard)**, **alerts (list, ack, `ALERT_ALREADY_ACKNOWLEDGED`, run rules summary,
  empty state)**, **view-as panel (impersonation bearer only, banner countdown, no write actions, expiry closes the
  panel, `IMPERSONATION_READ_ONLY`, no-session state)**, **command palette (input pinned outside the scrolling list,
  new entries + keywords, role gating)** and **audit actor filter (server-side `actor=` round-trip in the URL, `meta.actor` chip with a link to the
  user, unknown actor → empty page + alert chip, legacy `actorId=` deep links, no per-row user lookups)**, plus the
  **review-queue media filter (chips → `?mediaStatus=`, shared-URL restore, count-aware empty state)**.
- Live E2E (Playwright, Chromium, against the seeded Docker API through the Vite proxy on :5176 — 148 checks, all
  passing, **0 console errors** across 12 routes × 4 roles × light + dark): support approved `+251911001233` (now
  `id_verified`) and rejected `+251911001918` with a reason from the KYC drawer (documents, 05:00 countdown, zoom,
  mismatch warnings, MOCK badge; `J`/`Z` hotkeys); super acknowledged all three seeded alerts one per run
  (`openCount` 3→2→1→0, sidebar badge matched), ran the rules (4-rule summary), expanded payloads, and the API refused
  a second ack with `409 ALERT_ALREADY_ACKNOWLEDGED`; referrals metrics + rejected shared-device row
  (`+251911002466 → +251911002740`); deletion queue showed the seeded pending request (left untouched) and, for a
  fresh user created through the user API, Cancel (with note) then a second request executed early (user became
  `deleted`, ledger kept, `Execute` had been enabled with 0 in-flight withdrawals); support impersonated
  `+251911000137` — banner "Viewing as … — read-only, expires in 10:00", balance / ledger / feed loaded with the
  impersonation bearer, no write buttons in the panel, a direct `PATCH /users/me` with that token returned
  `403 IMPERSONATION_READ_ONLY`, `impersonation.issued` landed in the audit log, End session cleared everything; the
  reviewer used **Reprocess media** on a pending creative → `processing` chip in queue + pane, Approve disabled with the
  explanation even at 8/8, the API answered `422 MEDIA_NOT_READY`, and once the worker finished the gate lifted by
  polling without a reload (nothing was approved); the duration-corrected creative showed `20s → 15s` + probe
  dimensions; revenue daily table / CSV gained referral-bonus and net columns; the withdrawal drawer showed the
  partner-confirmed holder; `Idempotency-Key` replay returned the same adjustment with `Idempotent-Replayed: true`,
  a different payload → `409 IDEMPOTENCY_KEY_REUSED`, and the UI create sent a UUID key; audit `Actor` resolved
  `finance@rap.et` → admin id (14 filtered rows) and `+251911002192` → user id with the phone shown on user rows;
  `/config` listed the 7 mock flags; the palette on `/config` in dark mode kept its input pinned while the list was
  scrolled to the bottom. Screenshots and the JSON report were kept outside the repo (session artifacts).
- Manual E2E with Playwright against the live API and all five accounts: reviewer approved and rejected creatives
  through the checklist gate (reject reason stored as composed); support reinstated then re-suspended
  `+251911002877` and saw both actions in the audit trail; support escalated and dismissed fraud flags; finance@ saw
  Approve disabled on the seeded 650 ETB withdrawal it had already approved, finance2@ gave the second approval and
  the payout moved to `processing`; finance@ could not approve its own coin adjustment, finance2@ executed it and the
  ledger entry / audit links resolved; a new adjustment was created through the UI and cancelled by its requester;
  audit filters, JSON diffs, revenue CSV download, command palette, `g` shortcuts and the theme toggle were exercised.
  Every route was rendered for every role in light and dark with zero console errors; restricted routes show the
  designed no-access state. Screenshots were kept outside the repo.

---

## Design decisions & assumptions

- **Brand**: "Gize" is a placeholder (see top). Sub-brand "Gize Admin" is visible in the sidebar and login.
- **Token storage**: tokens are kept in memory and mirrored to `localStorage` so reloads keep the session and tabs
  stay in sync. For an internal tool behind SSO/VPN this is an accepted trade-off; the safer alternative is an
  httpOnly refresh cookie, which the API does not offer today (see gaps).
- **Role source**: the login response's `admin` object is ignored for authorisation; `GET /admin/me` is fetched right
  after login and on every boot so role changes take effect without re-login (matches the server guard).
- **Optimistic UI** is limited to removing a reviewed ad from the queue; money-related mutations always re-read the
  server response before updating the UI.
- **Reason minimum** is 5 characters, matching the API DTOs (`MinLength(5)`); notes are optional where the API says so.
- **"Has open flags" user filter** is client-side on the current page because the API has no such filter; the UI says
  so next to the checkbox.
- **Attempts cap** for payout retries is taken from the API default (`PAYOUT_MAX_ATTEMPTS=3`); the config endpoint
  does not expose it, so the UI disables Retry at 3 and otherwise relies on the server's `WITHDRAWAL_NOT_REVIEWABLE`.
- **Revenue range** is sent as `from=YYYY-MM-DD` / `to=YYYY-MM-DDT23:59:59.999Z` so the last day is inclusive.
- **Mock banner**: when `GET /admin/config` reports any `mocks.*` true, the topbar shows a "Mock mode" badge.
- **Dates** are shown in the browser locale (en-GB style, 24 h) with UTC day keys for charts, matching the API's UTC
  day buckets.
- **Impersonation token** is deliberately not persisted: a reload of `/users/:id/view-as` shows a "no active session"
  explanation instead of restoring the token. The banner auto-dismisses 20 s after expiry.
- **KYC document links** are presigned for 5 minutes, so the drawer never serves a cached detail (`staleTime: 0`,
  `gcTime: 0`) and shows a countdown computed from the shortest `expiresInSeconds`; images fade out when expired and a
  "Refresh links" button re-fetches. Pre-check and profile mismatches are **warnings, not blockers** — the admin decides.
- **Media gate** is client-side mirrored (`mediaApproveBlock`) and server-enforced (`422 MEDIA_NOT_READY`); while a
  visible creative is `processing` the queue / detail poll every 10 s so the gate lifts on its own.
- **Deletion "Execute"** is disabled client-side from `pendingWithdrawals` (the list row) and the API still enforces
  `DELETION_BLOCKED_PENDING_WITHDRAWALS`; both dialogs state that the ledger, withdrawals and audit rows are retained.
- **Audit actor filter is server-side** (Phase 4D): the Actor box sends what was typed verbatim as
  `GET /admin/audit-log?actor=` (admin / advertiser email, user phone in any Ethiopian format, or an id) and reads
  `meta.actorResolved` + `meta.actor { id, actorType, label }` for the status chip. An unknown actor yields an empty
  page and a red "No admin, advertiser or user matches …" chip rather than silently showing everything. Rows are
  labelled from `actorLabel`, so there are no per-row user lookups any more; legacy `?actorId=` links still work.
- **Alerts for reviewers**: hidden (see RBAC note) - the API returns 403 for `ad_reviewer`.
- **DataTable virtualisation** falls back to plain rows whenever the virtualizer cannot measure a viewport (jsdom,
  `display: none` ancestors) instead of rendering an empty table.

## API gaps found during Phase 2 (resolved in Phase 3 unless noted)

> Status after the Phase 3 integration: items 1, 2, 3, 6 and 7 are **fixed in the API / `@rap/shared`**
> (`ToBoolean` query transformer, widened shared types, `GET /admin/advertisers/:id/wallet`, `payoutMaxAttempts` in
> `GET /admin/config`, `permissions` in the login response); item 9 is fixed (`msw: false` in `pnpm-workspace.yaml`).
> Items 4, 5 and 8 remain as documented client-side behaviour.

1. **`GET /admin/fraud/flags?resolved=false` returns resolved flags.** The DTO uses `@Type(() => Boolean)`, so the
   string `"false"` is coerced to `true`. The client sends `resolved=` (empty string → `false`) for the "open" filter
   (`fraudApi.flags`). Fix upstream: use a string→boolean transform.
2. **Shared types miss a few fields the API returns**: `reviewNote` and `bannedTopics` on review items, `bankCode`
   and `attempts` on admin withdrawals, `lastIp` on user detail, `analytics` + `advertiser` on admin campaign detail,
   `payoutDestinationFull` is declared but `bankCode` is not. Widened locally in `src/lib/api/types.ts`.
3. **Advertiser wallet ledger / payments** are not exposed to admins (`GET /admin/advertisers/:id` returns balance,
   lifetime spend and campaigns only). The detail page explains this; a read-only admin endpoint would complete spec §7.
4. **No per-completion list for a user** — the user detail shows completion counts and the flags attached to flagged
   completions instead.
5. **No "has open flags" / "shared device" server filters** for users; the devices tab derives shared-device
   evidence from `DEVICE_SHARED_ACCOUNTS` / `MULTI_ACCOUNT_RING` flags of the user.
6. **`PAYOUT_MAX_ATTEMPTS`** is not part of `GET /admin/config`.
7. **Admin login response omits `permissions`**, so `/admin/me` is always fetched (one extra request at login).
8. **Audit log `q`** only searches `action` / `targetType` on the server; the UI labels the box accordingly.
9. **Tooling note**: `pnpm install` inside this app appends `msw: set this to true or false` to the root
   `pnpm-workspace.yaml` `allowBuilds` block (pnpm 11 build-script policy). It was reverted here because root files
   are out of scope; adding `msw: false` there is the permanent fix (msw's postinstall only prints a message).

## API gaps found during Phase 4B (admin UI for the Phase 4A backend)

> Status after Phase 4C/4D: items 1, 2, 3, 4, 5 and 7 are **fixed in the API / `@rap/shared`** and the UI now uses
> the server-side contract (enriched deletion rows, `actorLabel` + `actor=` with `meta.actor`, overview counters,
> `duplicateIdentityUsers`, alerts readable by `ad_reviewer`, `?mediaStatus=` filter chips). Items 6 and 8 are
> expected behaviour. The text below is kept as the historical record of what was found.

All worked around client-side at the time; none blocked the features.

1. **`POST /admin/deletion-requests/:id/execute|cancel` return a bare `DeletionRequestItem`** (no `user`,
   `pendingWithdrawals`, …) although the natural type is `AdminDeletionRequestItem` like the list rows. The UI reads
   the phone for its toast from the cached list row. Returning the enriched row would let drawers update in place.
2. **No `actorPhone` on audit rows** (only `actorEmail` for admins) and **no admin directory endpoint** — the audit
   "Actor" filter resolves emails through recent admin audit rows and phones through the users search, and user-actor
   phones need one `GET /admin/users/:id` per distinct id per page. `actorPhone` / `actorDisplay` on
   `AuditLogItem`, or an `actorEmail=` / `actorPhone=` query, would remove ~25 requests per page.
3. **`AdminOverview` has no Phase 4A counters** (pending KYC, open alerts, pending deletion requests); the sidebar
   badges and overview tiles issue one-row list requests instead (`limit=1`, reading `meta.total` /
   `meta.openCount`). Adding `pendingKyc`, `openAlerts`, `pendingDeletionRequests` to `GET /admin/overview` would
   save three polls.
4. **`AdminKycDetail.duplicateIdentityUsers` is a count only** — the drawer can't link to the other accounts; it links
   to KYC searches on the same last-4 digits instead. Returning the user ids (support/super_admin) would allow direct
   links.
5. **`GET /admin/alerts` is not readable by `ad_reviewer`** (403) although the brief said "all roles read"; the UI
   follows the API. Also `meta.notifiers` / `meta.openCount` are not declared in `@rap/shared` (typed locally as
   `AlertsMeta`).
6. **Alert rule dedupe** means "Run rules now" rarely raises anything on demo data; the result dialog therefore shows
   "clear" for most rules — expected, but worth a note for demos.
7. **`GET /admin/ads/review-queue` cannot filter by `mediaStatus`**; the queue shows a chip per row and polls faster
   while anything is processing, but a `mediaStatus=` filter would help reviewers triage failed uploads.
8. **KYC `reject` DTO's `reason` minimum is 3 chars** (other admin DTOs use 5); the UI mirrors 3 for KYC.

## Known gaps / next steps

- No admin-side creation of fraud flags (`POST /fraud/flags`) or trust recompute UI; both endpoints exist.
- Media preview relies on the browser's codecs; headless Chromium without proprietary codecs shows the designed
  "media could not be loaded" fallback with a link to the source URL.
- The users list filters trust score server-side but "has open flags" only on the current page (see above).
- No i18n layer: the console is English-only (internal tool); user-facing strings that could be localised are
  centralised in components, not extracted.
- The view-as panel covers the read endpoints the brief listed (`/users/me`, balance, ledger, feed, withdrawals,
  notifications); `/users/me/summary`, `/users/me/kyc`, `/users/me/referrals` and offers could be added the same way.
- Referral filters take user ids; a phone-based lookup (like the audit Actor box) would be friendlier.
- Playwright E2E scripts used for verification live outside the repo (session artifacts) and are not part of CI.
