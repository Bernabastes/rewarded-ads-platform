# @rap/mobile — Gize user mobile app

The consumer surface of the Rewarded Ads Platform: watch ads and complete offers, earn coins, withdraw Birr.
Expo SDK 57 (React Native 0.86, React 19), TypeScript strict, Expo Router, Amharic-first.

> **Brand name is a placeholder.** "Gize" (Amharic ጊዜ = "time"; promise «ጊዜዎ ዋጋ አለው» / "your time has value")
> lives in a single constant, `BRAND_NAME` / `BRAND_NAME_AM` in `src/config.ts`, plus the `common.appName`
> i18n keys and `app.json` (`name`, `slug`, `scheme`, bundle ids). Rename there.

## Run it

```powershell
pnpm install                          # at the repo root (also builds @rap/shared)
cd apps/mobile
Copy-Item .env.example .env           # then edit EXPO_PUBLIC_API_URL if needed

pnpm start                            # Expo dev server (press w / a / i)
pnpm web                              # Expo web on http://localhost:8081
```

The API must be running (`docker start rap-api` or `pnpm dev:api` at the root) — see the root README.

| Script                                | What it does                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| `pnpm --filter @rap/mobile typecheck` | `tsc --noEmit` (strict, typed routes)                                            |
| `pnpm --filter @rap/mobile lint`      | ESLint 10 flat config + `react-hooks` + the local **no hardcoded JSX text** rule |
| `pnpm --filter @rap/mobile test`      | Jest (`jest-expo`) — 78 unit/component tests                                     |
| `pnpm --filter @rap/mobile build`     | `expo export --platform web` → `dist/` (static web build, ~5.5 MB with fonts)    |

### Environment variables (`.env`, only `EXPO_PUBLIC_*` reach the bundle)

| Variable                       | Default                    | Notes                                                                                                                                                                                                                                                             |
| ------------------------------ | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_API_URL`          | `http://localhost:3000`    | API origin **without** `/api/v1`. On a **physical device use your computer's LAN IP** (`http://192.168.x.y:3000`); `localhost` on the phone is the phone. The API's `CORS_ORIGINS` must include the Expo web origin (`http://localhost:8081` is already allowed). |
| `EXPO_PUBLIC_SUPPORT_TELEGRAM` | `SUPPORT_CONTACT_DEFAULTS` | Telegram support link shown in Profile / blocked screens.                                                                                                                                                                                                         |
| `EXPO_PUBLIC_SUPPORT_PHONE`    | `SUPPORT_CONTACT_DEFAULTS` | Support phone (`tel:` link).                                                                                                                                                                                                                                      |
| `EXPO_PUBLIC_EAS_PROJECT_ID`   | _(empty)_                  | Needed for Expo push tokens on real devices. Empty → push registration silently no-ops.                                                                                                                                                                           |

### Demo credentials

Any new Ethiopian number (`09…`/`07…`, `+2519…`) creates a fresh user; the dev API echoes the OTP (`devCode`, shown
under the code boxes in development builds) and accepts `123456`. Seeded users, banned/suspended accounts and the
fraud-ring devices are listed in the root README and `docs/API.md`.

## Native builds (not run in this environment)

There is no Android SDK / Xcode on the machine this was built on, so **native builds were not executed**. Everything
was verified with typecheck, ESLint, Jest and an Expo-web render smoke test against the live API (see
[Verification](#verification)). To build natively:

```powershell
cd apps/mobile
npx expo prebuild                     # generate android/ and ios/ (managed workflow, safe to regenerate)
npx expo run:android                  # needs Android Studio / SDK + a device or emulator
npx expo run:ios                      # macOS + Xcode only

# Cloud builds
npm i -g eas-cli
eas login
eas build:configure                   # writes eas.json and sets extra.eas.projectId in app.json
eas build --profile development --platform android
```

Expo Go **cannot** run this app fully: `expo-video`, `expo-secure-store` and remote push need a development build.

## Architecture

```
apps/mobile
├─ app/                        # expo-router file routes (typed)
│  ├─ _layout.tsx              # providers, fonts, splash, auth hydration, Stack.Protected guards
│  ├─ index.tsx                # entry hub → onboarding / complete-profile / blocked / tabs
│  ├─ (onboarding)/            # welcome, language, phone, otp
│  ├─ complete-profile.tsx     # name + DOB (server computes age; AGE_RESTRICTED → blocked)
│  ├─ blocked.tsx              # age-restricted / suspended / banned
│  ├─ (tabs)/                  # index (home feed), offers, wallet, profile
│  ├─ ad/[id].tsx, ad/result.tsx
│  ├─ offers/survey/[id].tsx, offers/app-install/[id].tsx
│  ├─ wallet/withdraw.tsx, wallet/withdrawals/{index,[id]}.tsx
│  ├─ notifications.tsx, report-ad.tsx, settings/*
├─ src/
│  ├─ api/                     # ApiClient (refresh queue), errors, typed endpoints, TanStack Query hooks
│  ├─ auth/                    # secure token store, auth store, session hydration / sign-in / sign-out
│  ├─ device/fingerprint.ts    # stable device id + SHA-256 fingerprint (SecureStore)
│  ├─ components/ui/           # Text, Button, Card, Input, OtpInput, Skeleton, EmptyState, Badge, Toast, …
│  ├─ components/illustrations # inline-SVG state illustrations
│  ├─ features/                # feed, watch (player + session hook), wallet, withdrawals, offers, auth, profile
│  ├─ i18n/                    # i18next init + locales/{am,en,om,ti}.json
│  ├─ notifications/           # push registration + deep-link resolution
│  ├─ stores/prefsStore.ts     # Zustand (persisted UI prefs only)
│  ├─ theme/                   # tokens, ThemeProvider/useTheme, fonts
│  └─ utils/                   # format, storage, errorMessage
├─ eslint/i18n-plugin.mjs      # local ESLint rule: no hardcoded user-facing JSX text
├─ test/                       # Jest setup, render helpers, Reanimated mock, screen tests
└─ scripts/generate-assets.mjs # regenerates icon / splash / favicon from the flat coin mark
```

### State & data layer

- **Server state = TanStack Query** (`src/api/queries/*`). The coin balance is **only ever** `GET /users/me/balance`;
  `invalidateMoney()` refetches balance/summary/ledger after every completion or withdrawal. The `newBalance` in a
  completion response is never written into UI state.
- **Auth**: tokens in `expo-secure-store` (web dev falls back to `localStorage`); `ApiClient` attaches the bearer token,
  on a 401 performs **one** `POST /auth/refresh` shared by all concurrent callers (queued retries), retries once, and
  on refresh failure (incl. `REFRESH_TOKEN_REUSED`) clears tokens and signs out. 403 `AGE_RESTRICTED` /
  `ACCOUNT_SUSPENDED` / `ACCOUNT_BANNED` flip the auth store into a blocked state → blocking screen.
- **UI prefs = Zustand + AsyncStorage** (`prefsStore`): theme mode, language, welcome seen, recently opened ads
  (used by "Report a bad ad" from Profile).
- **Errors** are always localised on the stable `code` (`errors.codes.<CODE>` keys), never on the server message;
  429s show `details.retryAfterSeconds`; 400 validation maps `details[].field` to the matching input.

### Ad watch flow (`src/features/watch`)

`useWatchSession`: `POST /ads/:id/watch-sessions` (with device fingerprint) → heartbeat every
`heartbeatIntervalSeconds` with the player position → on playback end show the attention question (if any) →
`POST …/complete` through `completeWithRetry` (retries network/5xx only; the endpoint is idempotent, `replayed: true`
is surfaced in the UI) → result screen by `status` → balance refetch. Playback is cut at the declared ad duration.

The in-progress session is persisted to AsyncStorage after every change. At relaunch `decideResume` returns
`resume` (heartbeat gap ≤ 1.5 intervals), `retry_complete` (app died after asking the server to complete →
re-send the idempotent completion; never double-credits) or `discard` (server-expired / continuity broken → the user
is told and can watch the ad again). Network loss pauses the video and shows an overlay; the server clock keeps
running, which the copy says honestly.

### Theming

Typed tokens in `src/theme/tokens.ts` (forest / terracotta / warm stone, semantic colours, radii 8/12/16/24, soft
shadows, type scale) with full light and dark palettes; `useTheme()` everywhere (no CSS-in-JS library). Mode =
system / light / dark, persisted. Motion via Reanimated (Tappable spring, skeleton pulse, coin-earned settle +
count-up, screen fades); every animation respects reduce-motion. Coins are the flat two-tone mark (`CoinMark`) —
no gradients or metallic cues anywhere.

### i18n

`i18next` + `react-i18next`, resources bundled (`src/i18n/locales`). **Amharic is the default**; English is complete;
`om` (Afaan Oromo) and `ti` (Tigrinya) are partial and fall back `om/ti → am → en` (proven by `i18n.test.ts`, which
also enforces am/en key parity and interpolation parity). All copy goes through `t()` — the local ESLint rule
`gize-i18n/no-hardcoded-jsx-text` fails the build on literal JSX text or literal `title`/`label`/`placeholder`/…
props. Language switching updates the UI instantly and `PATCH /users/me { languagePreference }`.

**Fonts**: Noto Sans Ethiopic 400/500/600/700 + Inter 400/500/600/700, loaded with `useFonts` before the splash
hides. The `Text` primitive picks the family per string (Ethiopic detection) and per UI language so Amharic never
renders as tofu and Latin keeps Inter; on web a fallback stack is attached for mixed-script strings.

## Verification

Run here (Windows, no Android SDK/Xcode):

1. `pnpm --filter @rap/mobile typecheck | lint | test | build` — all green (78 tests / 11 suites).
2. **Expo-web smoke against the live API** (Playwright driving system Chrome, screenshots kept outside the repo):
   welcome (Amharic) → language → phone → OTP (dev code) → complete profile → home feed (balance, daily
   progress, cards) → ad pre-roll → watch session with heartbeats → attention question → **`valid` completion,
   +100 coins, balance refetched** → wallet ledger → withdrawal validation (below minimum blocks) → sign out →
   seeded user → withdrawal 50 ETB via telebirr → status `flagged_for_review` (first withdrawal) with review reasons,
   timeline and polling → withdrawal history → offers + survey intro → notifications → dark mode → language switch to
   English (synced to API) → about → banned account blocking screen → under-18 `AGE_RESTRICTED` blocking screen.

Not verified here: real device playback/push, landscape on device, SMS autofill, haptics.

## Design decisions & assumptions

- **Brand**: "Gize" placeholder (see top). Ethiopic wordmark ጊዜ is shown when the UI language is Ethiopic.
- **Styling**: typed theme + `StyleSheet`/inline styles (no NativeWind) to keep the bundle small and the tokens
  type-safe; web export is ~5.5 MB including 8 font files.
- **Date of birth**: three auto-advancing numeric fields (Gregorian DD/MM/YYYY) rather than a native picker —
  identical on web and native, no extra dependency; the value is sent as `YYYY-MM-DD` and the age preview uses the same
  `calculateAge` as the server. An Ethiopian-calendar input is a known gap.
- **Interrupted watch sessions**: resume only inside a 1.5-heartbeat grace window; otherwise discard with a friendly
  notice (the server would reject the completion anyway). Completions that were already sent are retried, never
  re-started.
- **Report an ad** from Profile lists the last 20 ads opened on this device (no server-side "watched ads" list for
  users); from the player/result screen the ad is pre-selected.
- **Video longer than the declared duration** is cut at the declared length (the reward is for the declared ad).
- **Push**: Expo push tokens are registered with `POST /users/me/push-tokens` after sign-in when an EAS project id is
  configured on a physical device; web / Expo Go / simulators no-op. Notification taps deep-link via
  `resolveNotificationTarget` (withdrawal → its status screen, rewards → wallet, offers → the offer).
- **Web** is a development/demo target only (SecureStore falls back to `localStorage`).

## API notes / gaps (worked around client-side during Phase 2)

> Status after the Phase 3 integration: seeded media is now self-hosted on MinIO (no third-party CDN);
> `GET /users/me/recently-watched` exists (the report-an-ad screen still uses the on-device list; wiring the endpoint is a
> follow-up); `reviewReasons` is typed as `WithdrawalReviewReason | string` in `@rap/shared` and the API value
> `low_trust_score` now has its own translation.

- Seeded ad thumbnails and most seeded video URLs point at Google's public sample bucket, which returns **403 from
  this network** (Chrome reports `ERR_BLOCKED_BY_ORB`). Cards fall back to a placeholder when a thumbnail fails;
  the smoke test uses the MinIO-hosted creative ("test creative"). A real deployment would serve all media from the
  platform's object storage/CDN.
- `WithdrawalItem.reviewReasons` is an untyped string list; the app maps the known values
  (`first_withdrawal`, `large_amount`, `low_trust`) and falls back to a generic "routine check" line.
- `POST /users/me/ad-reports` returns `409 CONFLICT` for a duplicate report; shown as "already reported".
- No dedicated "recently watched ads" endpoint (see Report an ad above).
- `OfferListItem.completionStatus` drives the "completed / pending verification" badges; there is no per-offer
  "attempts left" so exhausted offers simply disappear from the list.

## Known gaps

- Native (Android/iOS) builds, real-device playback and push were not exercised in this environment.
- Ethiopian-calendar date entry; Afaan Oromo / Tigrinya translations are partial by design (fallback proven).
- No offline queue for actions other than the idempotent completion retry.
- Player landscape layout is implemented but only verified in portrait on web.
