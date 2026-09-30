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
| `pnpm --filter @rap/mobile test`      | Jest (`jest-expo`) — 143 unit/component tests                                    |
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

Expo Go **cannot** run this app fully: `expo-video`, `expo-secure-store`, `expo-image-picker` (camera) and remote push
need a development build. The `expo-image-picker` config plugin in `app.json` declares the camera / photo-library
permission strings used for KYC document capture.

## Architecture

```
apps/mobile
├─ app/                        # expo-router file routes (typed)
│  ├─ _layout.tsx              # providers, fonts, splash, auth hydration, Stack.Protected guards, consent gate
│  ├─ index.tsx                # entry hub → onboarding / complete-profile / consent / blocked / tabs
│  ├─ (onboarding)/            # welcome, language, phone (+ referral code, F6 rate-limit countdown), otp
│  ├─ complete-profile.tsx     # name + DOB in the Ethiopian OR Gregorian calendar (AGE_RESTRICTED → blocked)
│  ├─ consent.tsx              # terms + privacy acceptance (after sign-up and on 403 CONSENT_REQUIRED)
│  ├─ blocked.tsx              # age-restricted / suspended / banned
│  ├─ (tabs)/                  # index (home feed + referral card), offers, wallet (+ KYC allowance), profile
│  ├─ ad/[id].tsx, ad/result.tsx
│  ├─ offers/survey/[id].tsx, offers/app-install/[id].tsx
│  ├─ wallet/withdraw.tsx      # amount → method → destination verification → confirm (Idempotency-Key)
│  ├─ wallet/withdrawals/{index,[id]}.tsx
│  ├─ kyc/{index,submit}.tsx   # identity verification status + document submission
│  ├─ referrals.tsx            # invite friends: code, share / copy, invite statuses
│  ├─ legal/index.tsx          # re-read terms / privacy, accepted versions
│  ├─ privacy/index.tsx        # data export + account deletion request / cancel
│  ├─ notifications.tsx, report-ad.tsx, settings/*
├─ src/
│  ├─ api/                     # ApiClient (refresh queue, Idempotency-Key, consent hook), errors, endpoints, queries
│  ├─ auth/                    # secure token store, auth store (incl. consent state), session hydration / sign-out
│  ├─ device/fingerprint.ts    # stable device id + SHA-256 fingerprint (SecureStore)
│  ├─ components/ui/           # Text, Button, Card, Input, OtpInput, Skeleton, EmptyState, Badge, Toast, useCountdown, …
│  ├─ components/illustrations # inline-SVG state illustrations
│  ├─ features/                # feed, watch, wallet, withdrawals (destination flow, idempotent submit), auth (dob),
│  │                           # legal (consent), kyc (validation, presigned upload), referrals, privacy (export polling)
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
  on a 401 with a token code (`UNAUTHORIZED` / `INVALID_TOKEN` / `TOKEN_EXPIRED`) performs **one** `POST /auth/refresh`
  shared by all concurrent callers (queued retries), retries once, and on refresh failure (incl.
  `REFRESH_TOKEN_REUSED`) **or a second 401 after a successful refresh** (denylisted / deleted account, F2) clears
  tokens and signs out. Business 401s such as `OTP_INVALID` on the destination-OTP check are surfaced as-is (never
  retried, so a wrong code is not re-sent). Logout posts the refresh token **with the access token as Bearer** so the
  server can denylist it immediately. 403 `AGE_RESTRICTED` / `ACCOUNT_SUSPENDED` / `ACCOUNT_BANNED` flip the auth store
  into a blocked state → blocking screen; 403 `CONSENT_REQUIRED` marks `details.requiresConsent` in the auth store and
  the root layout pushes the consent screen on top of whatever the user was doing.
- **Money POSTs** send an `Idempotency-Key` (UUID per submit intent, reused for retries of the same payload). A
  `409 IDEMPOTENCY_KEY_REUSED { inProgress: true }` polls the withdrawal list instead of posting again;
  `inProgress: false` (stale key, different payload) retries once with a fresh key (`features/withdrawals/submitWithdrawal.ts`).
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

### Phase 4B screens (consent, Ethiopian DOB, destination verification, KYC, referrals, privacy)

- **Consent gate** (`app/consent.tsx`, `features/legal`). After `otp/verify` and `complete-profile` the entry hub checks
  `user.requiresConsent`; when non-empty the consent screen renders the current documents from
  `GET /legal/current?locale=<ui language>&audience=user` (markdown rendered natively: headings, paragraphs, bullets;
  link to the hosted `url`), one checkbox per document, then `POST /users/me/consents { kind, version }` per kind and a
  profile refresh. `409 CONSENT_VERSION_OUTDATED` reloads the documents and asks again. A `403 CONSENT_REQUIRED` from
  any endpoint later (new version published) pushes the same screen showing only `details.requiresConsent`; accepting
  pops back. Profile → *Terms and privacy* re-reads both documents with the accepted version / date.
- **Ethiopian calendar DOB** (`features/auth/dob.ts`, `DateOfBirthInput`). Toggle between Ethiopian (default when
  the UI language is Amharic) and Gregorian; Ethiopian entry is day + month picker (1–13 with Amharic and English
  names, Pagume showing its 5/6-day length for the typed year) + year. Conversion, validation (Pagume 6 only when
  `year % 4 === 3`, no future dates) and the live age preview all use the shared `@rap/shared/ethiopian-calendar`
  helpers, so the client agrees with the server; switching calendars converts a valid date instead of clearing it.
  Exactly one of `dateOfBirth` / `dateOfBirthEthiopian` is sent. Profile shows both dates.
- **Withdrawal destination verification** (`features/withdrawals/destinationFlow.ts`, `DestinationStep.tsx`). Pure
  reducer: `entry → resolving → resolved → otp_requesting → otp → verified`. A new number goes through
  `POST /withdrawals/destinations/resolve` → “Pay **{accountName}** on {method}?” (MOCK badge when `mock`, live
  countdown to `validUntil`) → `otp/request` → 6-box code (dev hint, resend timer) → `otp/verify` → verified card.
  `422 DESTINATION_NOT_FOUND` is inline (mock: numbers ending `0000`). `knownDestinations` appear as chips; because
  the API only returns them **masked**, the device remembers the full number of every destination it successfully
  submitted (`rememberedDestinations.ts`, AsyncStorage) — a remembered chip verifies in one tap, an unremembered one
  asks for the full number and the partner answers `known: true` (no OTP). `DESTINATION_NOT_VERIFIED` /
  `DESTINATION_OTP_REQUIRED` on submit (lookup TTL elapsed) send the user back to the destination step.
  `422 KYC_REQUIRED` opens a sheet with `details.projectedEtb` vs `thresholdEtb` and a CTA to KYC; the amount step and
  the wallet already show the rolling 30-day allowance for `phone_only` accounts. Withdrawal detail shows
  `destinationAccountName`.
- **KYC** (`app/kyc`, `features/kyc`). Status from `GET /users/me/kyc` (tier, latest submission with reason,
  `canSubmit`); form with id type (fayda / national_id / passport — no back page for passports), id number, full name,
  DOB in either calendar (prefilled from the profile) and photos. Each photo is picked with `expo-image-picker`
  (camera or library on device, `<input type="file">` on web), pre-checked against `uploadLimits`, then
  `POST /users/me/kyc/uploads/presign` → presigned PUT into the private prefix → `storageKey` goes into
  `POST /users/me/kyc`. `409 KYC_SUBMISSION_PENDING` / `KYC_ALREADY_VERIFIED` route back to the status screen.
- **Referrals** (`app/referrals.tsx`, `ReferralHomeCard`). Big code, Share (system sheet via `Share.share`; desktop
  web without a share sheet copies the text) and Copy (`expo-clipboard`), bonus explanation, totals and one row per
  invite with status chips (`pending` / `qualified` on hold / `paid` +coins / `rejected` with the reason). The phone
  screen has an optional “Have a referral code?” field; the code travels to `otp/verify` and referral errors
  (`REFERRAL_CODE_INVALID`, `REFERRAL_SELF_NOT_ALLOWED`, `REFERRAL_ALREADY_APPLIED`) are shown inline on the OTP screen,
  the code is dropped and the user verifies again without it.
- **Frequency caps**. Empty feed with `meta.hiddenByFrequencyCap > 0` shows “You have seen today's ads from these
  advertisers”; a `rejected` completion with `reasonCode FREQUENCY_CAP_REACHED` has its own result copy.
- **Privacy & data** (`app/privacy`, `features/privacy/dataExport.ts`). “Download my data” posts
  `POST /users/me/data-export` and polls the list every 2 s while `pending` / `processing`; a `ready` archive shows
  size, expiry and a Download button (`downloadUrl`). “Delete my account” confirms with an optional reason, shows
  `scheduledFor` + the grace period and offers Cancel (`DELETE /users/me/delete-request`);
  `DELETION_BLOCKED_PENDING_WITHDRAWALS` / `DELETION_REQUEST_PENDING` / `DATA_EXPORT_IN_PROGRESS` are localised.
- **Auth hardening / F6**. See *State & data layer* above; the phone screen turns a `429 OTP_RATE_LIMITED` into a live
  countdown on the button (`useCountdown`, shared with the OTP resend timers) instead of a static error.
- **Deep links**: `kyc_status` → KYC, `referral` → referrals, `data_export` / `account_deletion` → privacy.

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

1. `pnpm --filter @rap/mobile typecheck | lint | test | build` — all green (143 tests / 21 suites; the web export
   regenerates `.expo/types/router.d.ts` so the typed-route check covers the new screens).
2. **Expo-web smoke against the live API** (Playwright driving system Chrome, screenshots kept outside the repo):
   welcome (Amharic) → language → phone → OTP (dev code) → complete profile → home feed (balance, daily
   progress, cards) → ad pre-roll → watch session with heartbeats → attention question → **`valid` completion,
   +100 coins, balance refetched** → wallet ledger → withdrawal validation (below minimum blocks) → sign out →
   seeded user → withdrawal 50 ETB via telebirr → status `flagged_for_review` (first withdrawal) with review reasons,
   timeline and polling → withdrawal history → offers + survey intro → notifications → dark mode → language switch to
   English (synced to API) → about → banned account blocking screen → under-18 `AGE_RESTRICTED` blocking screen.
3. **Phase 4B Expo-web smoke** (same setup): NEW phone with referral code `779HLB` → OTP → Ethiopian DOB
   (5 Pagume 1985 → server stored `1993-09-10`, Pagume hint “5 days”) → consent (both documents, button disabled until
   ticked) → feed → Profile shows both dates → Legal (accepted v1.0) → Referrals (“referred by” card; the referrer's
   list shows the new user as `pending`) → Privacy: export requested → `ready` with download link, delete request
   (scheduled +14 days) → cancel → KYC: three images picked through the file input, presigned PUTs to MinIO, submit →
   `pending`. Withdrawal as a seeded `phone_only` user: wallet KYC allowance card → 50 ETB → telebirr → `…0000` →
   “could not find an account” inline → new number → “Pay Kebede Negash on telebirr? · Valid for 10:00” (MOCK) →
   wrong OTP → “4 attempts left” → correct OTP → verified → submit with `Idempotency-Key` → detail shows
   “Account holder: Kebede Negash”. Known-destination chip → verified in one tap. Forced `422 KYC_REQUIRED` → sheet
   (1,049.25 vs 1,000.00) → KYC screen. Forced feed responses: `hiddenByFrequencyCap: 3` empty state (Amharic),
   `403 CONSENT_REQUIRED { requiresConsent: ['privacy'] }` → consent screen with the privacy document only,
   `401 INVALID_TOKEN` after refresh → tokens cleared → onboarding. F6: second `otp/request` inside the window →
   button reads “Try again in 60s”, disabled, ticking.

Not verified here: real device playback/push, landscape on device, SMS autofill, haptics, native camera capture
(`expo-image-picker` was exercised through its web file chooser only).

## Design decisions & assumptions

- **Brand**: "Gize" placeholder (see top). Ethiopic wordmark ጊዜ is shown when the UI language is Ethiopic.
- **Styling**: typed theme + `StyleSheet`/inline styles (no NativeWind) to keep the bundle small and the tokens
  type-safe; web export is ~5.5 MB including 8 font files.
- **Date of birth**: three auto-advancing numeric fields (Gregorian DD/MM/YYYY) or the Ethiopian entry (day / month
  picker / year) rather than a native picker — identical on web and native, no extra dependency; the value is sent as
  `YYYY-MM-DD` or `{ year, month, day }` and the age preview uses the same `calculateAge` / calendar helpers as the
  server. The Ethiopian calendar is the default only for Amharic (Tigrinya speakers also see Ethiopic month names but
  start on Gregorian; flip the toggle).
- **Known destinations are masked by the API**, so “one-tap reuse” relies on the device remembering the full numbers
  it submitted (AsyncStorage, last 10). On a new device the chip asks the user to type the number; the partner lookup
  then reports `known: true` and no OTP is needed — the server contract, not the cache, decides.
- **Idempotency**: one UUID per submit intent (amount + method + destination + bank code); the key is kept across
  retries of the identical payload and discarded after success or after the payload changes.
- **KYC id number formats** are only checked loosely on the client (6–40 letters/digits, matching the API's length
  rule); the registry pre-check is server-side. Passports skip the back page; the API accepts `documentBackKey` as
  optional, so nothing is enforced beyond what the server requires.
- **Referral share text** comes from the server (`shareText.en` / `.am`); Afaan Oromo / Tigrinya UIs share the
  Amharic text (the product default) because the API ships only those two.
- **Data-export polling** runs every 2 s while an archive is `pending` / `processing` (React Query `refetchInterval`);
  the archive link is presigned and opened with `Linking.openURL`.
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

### Phase 4B API notes / gaps

- `WithdrawalConfig.knownDestinations[].destination` and `PayoutDestinationItem.destination` are **masked**; there is
  no server-side way to reuse a known destination without retyping it, hence the on-device memory described above. An
  unmasked `id`-based `payoutDestinationId` on `POST /withdrawals` would remove that workaround.
- `POST /withdrawals/destinations/otp/verify` answers a **401** `OTP_INVALID` for a wrong code (like the login OTP).
  The client distinguishes token 401s from business 401s by `code`; an unauthenticated-style 401 for a business rule is
  easy to mistake for an expired session in other clients.
- `MyReferralsResponse.referredBy.bonusCoins` is `0` while the referral is still `pending`; the "referred by" card
  therefore quotes the configured `bonusCoins.referee` rather than that field.
- `GET /users/me/delete-request` answers `200` with an empty body when there is no request; the client maps that to
  `null`.
- The KYC presign response carries an extra `kind` next to the campaign presign shape; typed locally as
  `KycPresignResponse`.
- `POST /auth/otp/request` has an hourly per-phone cap on top of the 60 s resend window; both surface as
  `429 OTP_RATE_LIMITED` with `retryAfterSeconds`, which the phone screen renders as a countdown (up to an hour).

## Known gaps

- Native (Android/iOS) builds, real-device playback, camera capture and push were not exercised in this environment.
- Afaan Oromo / Tigrinya translations are partial by design (fallback proven); the new Phase 4B strings exist in
  Amharic and English only.
- No offline queue for actions other than the idempotent completion retry (withdrawal submits keep their
  `Idempotency-Key` only for the lifetime of the screen).
- Player landscape layout is implemented but only verified in portrait on web.
- Legal documents are rendered from a small markdown subset (headings, paragraphs, bullets, no inline styling);
  anything richer should use the hosted `url`.
