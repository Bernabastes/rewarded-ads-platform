# @rap/admin-web — Gize Admin

Internal admin console for the Rewarded Ads Platform (Ethiopia): ad review, user / advertiser management, fraud
triage, the withdrawal queue with dual approval, two-step manual coin adjustments, revenue, audit log and platform
configuration. React 19 + TypeScript strict + Vite 7 + Tailwind CSS v4, talking to the NestJS API through the
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
pnpm --filter @rap/admin-web test              # vitest + testing-library + msw (63 tests)
pnpm --filter @rap/admin-web build             # vite build → dist/
pnpm --filter @rap/admin-web preview           # serve dist/ on :5174
```

The API must be running (Docker container `rap-api`, or `pnpm dev:api`) at `VITE_API_URL`; CORS already allows
`http://localhost:5174`. Health: `GET http://localhost:3000/health/ready`.

### Environment variables

| Variable       | Default                 | Purpose                                                                        |
| -------------- | ----------------------- | ------------------------------------------------------------------------------ |
| `VITE_API_URL` | `http://localhost:3000` | Origin of the API. `API_BASE_PATH` (`/api/v1`) from `@rap/shared` is appended. |

### Demo accounts (seeded; password `Admin123!`)

| Email             | Role          | What you can do in the console                                                              |
| ----------------- | ------------- | ------------------------------------------------------------------------------------------- |
| `super@rap.et`    | `super_admin` | Everything                                                                                  |
| `reviewer@rap.et` | `ad_reviewer` | Ad review queue, campaign moderation, ad reports                                            |
| `support@rap.et`  | `support`     | Users (suspend/ban/reinstate), advertiser verification, fraud, reports, app installs, audit |
| `finance@rap.et`  | `finance`     | Withdrawals, coin adjustments, revenue, fraud, audit (users/campaigns read-only)            |
| `finance2@rap.et` | `finance`     | Second finance account — use it to give the _second_ approval                               |

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
    domain/
      review-rules.ts      banned-topics checklist gating, rejection-reason composer
      finance-rules.ts     dual-approval state (approvals[] vs me), adjustment self-approval guard, retry rules
    hooks/                 use-theme (light/dark/system), use-hotkeys (token map), use-list-params (URL state),
                           use-misc (debounce, media query, clipboard)
    utils/                 cn, format (ETB/coins/dates/relative), json-diff (audit before/after), csv (export)
  components/
    ui/                    Button, Input/Textarea/NativeSelect/Field, Badge/StatusBadge/SeverityBadge, Card,
                           Dialog/Sheet, ConfirmDialog/ReasonDialog, Tabs/Tooltip/Checkbox/DropdownMenu,
                           DataTable (TanStack Table + react-virtual, sticky header, expandable rows) + PaginationBar,
                           StatCard/CountUp (Framer Motion), Skeleton*, Empty/Error/NoAccess states, JsonView/DiffView
    layout/                AppShell (topbar, page transitions, "g" sequences, ? help), Sidebar (role-aware, live
                           queue counters), CommandPalette (cmdk)
    guards/                RequireAuth, RedirectIfAuthed, RequireRole, BootSplash
  features/<area>/         one folder per page area (overview, review, campaigns, reports, installs, users,
                           advertisers, fraud, withdrawals, adjustments, revenue, audit, config, auth, errors)
  test/                    vitest setup, MSW server + handlers + fixtures, renderWithProviders helper
  styles/globals.css       Tailwind v4 @theme tokens, light/dark variables, fonts, utilities, overlay keyframes
```

### Routing

`react-router` v7 data router. `/login` is public; everything else sits under `<RequireAuth>` → `<AppShell>`.
Detail views that are drawers keep their id in the URL (`/withdrawals/:id`, `/adjustments/:id`, `/fraud/:id`,
`/review/:adId`) so any record is deep-linkable and the browser back button closes the panel. List filters,
tabs and pagination live in the query string (`useListParams`) so views are shareable and survive reloads.

### RBAC

The server is authoritative (`403 ROLE_NOT_ALLOWED`). The UI mirrors the matrix in `src/lib/auth/rbac.ts`
(copied from `apps/api/src/modules/admin/controllers/admin.controllers.ts`):

| Area                                   | super_admin | ad_reviewer | support | finance |
| -------------------------------------- | :---------: | :---------: | :-----: | :-----: |
| Overview, platform config              |      ✓      |      ✓      |    ✓    |    ✓    |
| Ad review queue, approve/reject ads    |      ✓      |      ✓      |         |         |
| Ad detail (read)                       |      ✓      |      ✓      |    ✓    |         |
| Campaign lists & detail                |      ✓      |      ✓      |    ✓    |    ✓    |
| Campaign approve/reject                |      ✓      |      ✓      |         |         |
| Campaign pause/resume                  |      ✓      |      ✓      |    ✓    |         |
| Ad reports                             |      ✓      |      ✓      |    ✓    |         |
| Users (list/detail)                    |      ✓      |             |    ✓    |    ✓    |
| Users suspend/ban/reinstate            |      ✓      |             |    ✓    |         |
| Advertisers (list/detail)              |      ✓      |      ✓      |    ✓    |    ✓    |
| Advertiser verify/reject               |      ✓      |             |    ✓    |         |
| Fraud dashboard + actions              |      ✓      |             |    ✓    |    ✓    |
| Withdrawals, coin adjustments, revenue |      ✓      |             |         |    ✓    |
| Audit log                              |      ✓      |             |    ✓    |    ✓    |
| App-install verification               |      ✓      |             |    ✓    |         |

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

`Ctrl/⌘ K` command palette · `?` shortcut help · `Ctrl/⌘ ⇧ L` theme · `g` then `o r c p i u v f w a e l g` jump to a
section · in the review queue `J/K` (or arrows) move, `1–8` toggle a banned-topic checkbox, `⇧ A` tick all,
`A` approve (only when 8/8 and nothing is flagged), `R` reject, `Esc` closes panels · `Ctrl/⌘ Enter` submits
reason dialogs.

---

## What each page does

| Route           | Highlights                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/login`        | Email + password, field-level validation, explains expired / revoked sessions, silent restore on reload.                                                                                                                                                                                                                                                                                                                                                                                                                |
| `/`             | Count-up metrics for every queue the role can act on, today's completions / flagged share / revenue, 7-day fraud filter chart, shortcuts. Refreshes every 30 s.                                                                                                                                                                                                                                                                                                                                                         |
| `/review`       | Split pane: pending / approved / rejected tabs, list with thumbnails and open-report markers, media player, campaign + advertiser (verification) context, attention questions with `correctIndex`, **banned-topics checklist rendered from `BANNED_TOPICS` — Approve stays disabled until 8/8**, "Flag" marks a topic as present (blocks approval, pre-fills the reject category), structured reject dialog with stored-reason preview, optimistic queue removal, decision record + checklist snapshot on history tabs. |
| `/campaigns`    | Status tabs, spend/budget progress, valid vs raw completions; detail with 30-day chart, fraud-filtered rate, creatives table, approve / reject (refund) / pause / resume with reasons.                                                                                                                                                                                                                                                                                                                                  |
| `/ad-reports`   | Open / reviewed / dismissed; close a report with a note and optionally pull the ad (reason required).                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `/app-installs` | Verify (credits the user) or reject install claims.                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `/users`        | Search by phone / name, status and trust-score filters, "has open flags" (current page), dense table. Detail: profile, stats, ledger (with highlight from adjustment links), withdrawals, fraud flags, devices / shared-device evidence, audit trail with JSON diffs; suspend / ban / reinstate with mandatory reason.                                                                                                                                                                                                  |
| `/advertisers`  | Pending verification / verified / rejected; detail with registration details, wallet + lifetime spend, campaigns; verify / reject with reason.                                                                                                                                                                                                                                                                                                                                                                          |
| `/fraud`        | Weekly flagged %, open flags by severity (donut), by rule (bars), daily trend; virtualised flags table with severity colouring and filters (state, severity, rule, user); drawer with metadata JSON, sibling-flag awareness — **the dismiss confirmation states when dismissing will credit the completion**; escalate (−10 trust) / suspend user (reason).                                                                                                                                                             |
| `/withdrawals`  | Tabs per status; first-withdrawal marker, dual-approval progress; drawer with user, masked destination (reveal toggle), approvals list, provider info; **Approve disabled when the current admin is already in `approvals[]`**, "1 of 2" progress with explanation, reject (refund) with reason, retry failed payouts (≤ 3 attempts).                                                                                                                                                                                   |
| `/adjustments`  | Two-step workflow: create (user combobox, ± coins with ETB preview and balance-after, reason, reference), list by status; drawer with decision trail; **Approve disabled for the requester**, cancel own pending request, executed requests link to the ledger entry and audit rows.                                                                                                                                                                                                                                    |
| `/revenue`      | Presets / custom UTC range, revenue-over-time area chart, take-rate donut, top advertisers, by action type, daily table, CSV export (daily + advertisers).                                                                                                                                                                                                                                                                                                                                                              |
| `/audit`        | Filters (search, action prefix, actor type / id, target type / id, date range), virtualised table, expandable rows with before/after diff (changed keys highlighted) + raw JSON + metadata, CSV export of the page. Target ids link to their record.                                                                                                                                                                                                                                                                    |
| `/config`       | Read-only effective platform config with `@rap/shared` defaults for comparison, mock-provider flags, fraud thresholds.                                                                                                                                                                                                                                                                                                                                                                                                  |

---

## Verification

- `pnpm --filter @rap/admin-web typecheck | lint | test | build` and root `pnpm typecheck | lint | test` pass.
- Vitest (63 tests): API client (refresh on `TOKEN_EXPIRED`, single in-flight refresh with queued retries, logout on
  `REFRESH_TOKEN_REUSED` / invalid token, proactive refresh, anonymous requests, network errors), RBAC matrix,
  banned-topics gating, dual-approval + self-approval guards, JSON diff, CSV escaping, field-error mapping, hotkey
  tokens, palette ranking; component tests with MSW for the login page, review pane, withdrawal sheet (already-approved
  admin blocked, second admin releases, reject requires reason, `DUAL_APPROVAL_SAME_ADMIN` toast) and the adjustment
  form / sheet (validation, `INSUFFICIENT_BALANCE` mapping, self-approval block, executed links).
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

## Known gaps / next steps

- No admin-side creation of fraud flags (`POST /fraud/flags`) or trust recompute UI; both endpoints exist.
- Media preview relies on the browser's codecs; headless Chromium without proprietary codecs shows the designed
  "media could not be loaded" fallback with a link to the source URL.
- The users list filters trust score server-side but "has open flags" only on the current page (see above).
- No i18n layer: the console is English-only (internal tool); user-facing strings that could be localised are
  centralised in components, not extracted.
- Playwright E2E scripts used for verification live outside the repo (session artifacts) and are not part of CI.
