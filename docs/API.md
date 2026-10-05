# API guide for the frontend teams

Human-readable companion to the machine contract:

- **OpenAPI**: `docs/openapi.json` (generated from code with `pnpm --filter @rap/api openapi:export`), live at
  `GET /api/docs-json`; Swagger UI at `http://localhost:3000/api/docs`.
- **Types & constants**: `@rap/shared` (`API_ROUTES`, `API_BASE_PATH`, `ErrorCode`, enums, `PLATFORM_DEFAULTS`,
  `BANNED_TOPICS`, `UPLOAD_LIMITS`, request/response types under `types/*`).

## Conventions

| Topic        | Rule                                                                                                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base URL     | `http://<host>:3000/api/v1` (`API_BASE_PATH`). Health probes live at `/health` and `/health/ready` (no prefix).                                                                                                                       |
| Auth         | `Authorization: Bearer <accessToken>`. Access tokens last 15 min (`expiresIn`); refresh with `POST /auth/refresh` (single-use rotating refresh token).                                                                                |
| Errors       | Always `{ statusCode, code, message, details? }`. **Branch/localise on `code`** (`ErrorCode` in `@rap/shared`), never on `message`.                                                                                                   |
| Validation   | `400 VALIDATION_ERROR` with `details: [{ field, messages[] }]`.                                                                                                                                                                       |
| Pagination   | `?page=1&limit=20` (max 100) → `{ data: T[], meta: { page, limit, total, ...extras } }`.                                                                                                                                              |
| Ids / dates  | UUIDs; ISO-8601 UTC timestamps (`2026-09-24T07:55:26.375Z`); calendar dates `YYYY-MM-DD`.                                                                                                                                             |
| Money        | ETB amounts are JSON numbers with 2 decimals (`amountEtb`); coins are integers. Conversion rate comes from the server (`coinsPerEtb`).                                                                                                |
| Status codes | `200` reads/actions, `201` creates (Nest default for POST), `204` deletes/logout, `401` auth, `403` forbidden/account state, `404`, `409` state conflicts, `422` insufficient balance, `429` rate limits, `503` provider unavailable. |
| CORS         | Origins from `CORS_ORIGINS` (defaults include `http://localhost:5173`, `:5174`, `:8081`).                                                                                                                                             |
| Mock mode    | `GET /admin/config` → `mocks: { sms, payouts, paymentGateway, push }`; mock checkout pages and `devCode` exist only when enabled.                                                                                                     |

### Error codes you must handle

| Code                                                                                                                                                                                                                                               | Where                                              | Client behaviour                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------- |
| `UNAUTHORIZED`, `INVALID_TOKEN`, `TOKEN_EXPIRED`                                                                                                                                                                                                   | any                                                | `TOKEN_EXPIRED` → refresh once, then retry; others → log out                 |
| `REFRESH_TOKEN_REUSED`                                                                                                                                                                                                                             | `/auth/refresh`                                    | Force re-login (token theft detection)                                       |
| `PROFILE_INCOMPLETE`                                                                                                                                                                                                                               | `/ads/*`, `/offers/*`, `POST /withdrawals`         | Send the user to the complete-profile screen                                 |
| `AGE_RESTRICTED`                                                                                                                                                                                                                                   | complete-profile, any request after                | Respectful blocking screen (Amharic default); account cannot be used         |
| `ACCOUNT_SUSPENDED`, `ACCOUNT_BANNED`                                                                                                                                                                                                              | any                                                | Blocking screen with support contact                                         |
| `OTP_INVALID`, `OTP_EXPIRED` (**400**), `OTP_TOO_MANY_ATTEMPTS`, `OTP_RATE_LIMITED` (429)                                                                                                                                                             | OTP flow (login + destination_change)              | Inline messages; `details.retryAfterSeconds` / `details.attemptsRemaining`. Business errors are never 401 (only token problems are) |
| `DAILY_LIMIT_REACHED`                                                                                                                                                                                                                              | feed/watch/complete                                | "Come back tomorrow" state (`meta.dailyRemaining === 0`)                     |
| `AD_NOT_AVAILABLE`, `AD_ALREADY_COMPLETED`, `TOO_MANY_WATCH_ATTEMPTS`                                                                                                                                                                              | watch session start                                | Refresh the feed                                                             |
| `WATCH_DURATION_INSUFFICIENT`, `HEARTBEAT_CONTINUITY_FAILED`, `ATTENTION_CHECK_FAILED`, `ATTENTION_ANSWER_REQUIRED`, `WATCH_SESSION_EXPIRED`, `WATCH_DURATION_EXCESSIVE`, `FRAUD_REJECTED`, `CAMPAIGN_BUDGET_EXHAUSTED`                            | `reasonCode` on a `rejected` completion (HTTP 201) | Show "not rewarded" state with a friendly reason; allow retry where sensible |
| `BELOW_MIN_WITHDRAWAL`, `INSUFFICIENT_BALANCE`, `INVALID_PAYOUT_DESTINATION`, `WITHDRAWAL_PENDING_EXISTS`, `WITHDRAWAL_RATE_LIMITED`, `PAYOUT_METHOD_UNAVAILABLE`                                                                                  | withdrawals                                        | Inline validation using `GET /withdrawals/config`                            |
| `ADVERTISER_NOT_VERIFIED`, `INSUFFICIENT_WALLET_BALANCE`, `CAMPAIGN_INVALID_STATE`, `CAMPAIGN_HAS_NO_ADS`, `UPLOAD_TYPE_NOT_ALLOWED`                                                                                                               | advertiser portal                                  | Guide to verification / billing / fix state                                  |
| `ROLE_NOT_ALLOWED`, `DUAL_APPROVAL_SAME_ADMIN`, `DUAL_APPROVAL_ROLE_REQUIRED`, `ADJUSTMENT_SELF_APPROVAL_FORBIDDEN`, `ADJUSTMENT_NOT_PENDING`, `WITHDRAWAL_NOT_REVIEWABLE`, `AD_NOT_PENDING`, `REJECTION_REASON_REQUIRED`, `FLAG_ALREADY_RESOLVED` | admin                                              | Disable actions proactively based on role/state; show the reason             |
| `CONSENT_REQUIRED` (403)                                                                                                                                                                                                                           | `/ads/*`, `/offers/*`, `POST /withdrawals`, campaign submit | Show the consent screen for `details.requiresConsent` kinds, then `POST /users/me/consents` (or `/advertisers/me/consents`) and retry |
| `CONSENT_VERSION_OUTDATED` (409)                                                                                                                                                                                                                   | consents                                           | Reload `GET /legal/current` and accept the current version                  |
| `DESTINATION_NOT_VERIFIED`, `DESTINATION_OTP_REQUIRED`, `DESTINATION_NOT_FOUND` (422)                                                                                                                                                              | `POST /withdrawals`, destinations                  | NEW destination: `resolve` → OTP request/verify (the verify response reveals the account name) → retry; NOT_FOUND (now raised by `otp/verify`) = ask the user to check the number |
| `KYC_REQUIRED` (422)                                                                                                                                                                                                                               | `POST /withdrawals`                                | Explain the monthly limit (`details.thresholdEtb`, `projectedEtb`) and open the KYC flow          |
| `KYC_SUBMISSION_PENDING`, `KYC_ALREADY_VERIFIED`, `KYC_NOT_PENDING`                                                                                                                                                                                | KYC                                                | Show the pending state / disable resubmission                                |
| `IDEMPOTENCY_KEY_REUSED` (409)                                                                                                                                                                                                                     | money POSTs with `Idempotency-Key`                 | `details.inProgress` true → retry the SAME request shortly (the finished response is replayed); false → the client sent a different payload with an old key: generate a new key. `details.resourceId` (withdrawal / payment / adjustment id) is set once the original request finished, so clients can open that resource instead of re-posting |
| `FREQUENCY_CAP_REACHED`                                                                                                                                                                                                                            | `reasonCode` on a `rejected` completion            | "You've reached today's limit for this advertiser" – refresh the feed        |
| `MEDIA_NOT_READY` (422)                                                                                                                                                                                                                            | admin ad approve                                   | Disable Approve while `mediaStatus` is `processing`/`failed`; offer "reprocess media" |
| `REFERRAL_CODE_INVALID`, `REFERRAL_SELF_NOT_ALLOWED`, `REFERRAL_ALREADY_APPLIED`                                                                                                                                                                   | `POST /auth/otp/verify` with `referralCode`        | Inline error on the code field (the login itself did not happen; retry without the code or with a valid one) |
| `DELETION_REQUEST_PENDING`, `DELETION_BLOCKED_PENDING_WITHDRAWALS`, `DELETION_REQUEST_NOT_PENDING`, `DATA_EXPORT_IN_PROGRESS`                                                                                                                      | data rights                                        | Show the existing request / explain the block                                |
| `IMPERSONATION_READ_ONLY` (403)                                                                                                                                                                                                                    | any mutation with an impersonation token           | Admin UI: hide/disable write actions while impersonating                     |
| `ALERT_ALREADY_ACKNOWLEDGED` (409)                                                                                                                                                                                                                 | `POST /admin/alerts/:id/ack`                       | Refresh the list                                                             |
| `LOGIN_RATE_LIMITED` (429), `ACCOUNT_LOCKED` (423)                                                                                                                                                                                                 | admin / advertiser login, admin MFA step           | Show "too many attempts" with `details.retryAfterSeconds`; never reveal whether the account exists (Phase 5) |
| `MFA_CODE_INVALID` (400), `MFA_TOKEN_INVALID` (401), `MFA_SETUP_REQUIRED` (403), `PASSWORD_CHANGE_REQUIRED` (403), `MFA_ALREADY_ENABLED` / `MFA_NOT_ENABLED`, `LAST_SUPER_ADMIN` (409)                                                                | admin login step 2, every admin route, admin management | Code field error / restart the login / send the admin to "My security" (only `/admin/me`, MFA setup and change-password answer) / disable the last super-admin demotion (Phase 5) |
| `DESTINATION_LOOKUP_LIMIT` (429)                                                                                                                                                                                                                   | `resolve`, destination `otp/verify`                | "You can verify at most N destinations per day" (`details.limit`, `retryAfterSeconds`) (Phase 5) |
| `MEDIA_SOURCE_NOT_ALLOWED` (400)                                                                                                                                                                                                                   | `POST /campaigns/:id/ads`                          | Upload through the presign endpoint; only `creatives/<advertiserId>/…` keys are accepted (Phase 5) |
| `PAYMENT_VERIFICATION_MISMATCH` (400)                                                                                                                                                                                                              | Chapa webhook (server-to-server)                   | Not client-facing; the payment stays `pending` and is investigated (Phase 5) |
| `CAMPAIGN_UNDERFUNDED` (422)                                                                                                                                                                                                                       | `POST /admin/campaigns/:id/approve`                | Explain that the reservation does not cover the budget; reject so the advertiser resubmits (Phase 5b New-1) |
| `CAMPAIGN_NOT_CHARGEABLE` (422)                                                                                                                                                                                                                    | `POST /admin/fraud/flags/:id/dismiss`              | The campaign is no longer live / funded; the flag stays open – escalate or confirm instead (Phase 5b New-6) |
| `SERVICE_UNAVAILABLE` (503) with `details.retryAfterSeconds`                                                                                                                                                                                       | login / MFA / destination resolve / any authenticated route | Redis-backed security control failed closed; retry shortly, do NOT treat as a lost session (Phase 5b New-5) |
| `415` (`VALIDATION_ERROR`)                                                                                                                                                                                                                         | any `/auth/*` POST without an `application/json` body | Send JSON (Phase 5b New-3) |

### Idempotency keys on money POSTs (Phase 4A)

`POST /withdrawals`, `POST /billing/topups`, `POST /admin/coin-adjustments`, `POST /offers/surveys/:id/complete` and
`POST /offers/app-installs/:id/complete` accept an optional `Idempotency-Key` header (1–128 chars of `[A-Za-z0-9_-:.]`,
scoped per authenticated actor, valid 24 h). Generate a fresh UUID per user intent (e.g. per "Submit" tap) and reuse
it on network retries:

- same key + same payload → the stored response is replayed (same status code) with `Idempotent-Replayed: true`;
- same key + different payload → `409 IDEMPOTENCY_KEY_REUSED` (`details.inProgress: false`);
- same key while the first request is still running → `409 IDEMPOTENCY_KEY_REUSED` (`details.inProgress: true`);
- error responses are not memoised: after a 4xx/5xx the same key may be retried.

`IDEMPOTENCY_KEY_HEADER` / `IDEMPOTENT_REPLAYED_HEADER` / `IDEMPOTENT_ENDPOINTS` live in `@rap/shared`.

---

## Legal (`/legal`, public) and consent

| Method | Path                                                 | Notes                                                                                                                                                                       |
| ------ | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/legal/current?locale=am\|en\|om\|ti&audience=user\|advertiser` | `CurrentLegalDocumentsResponse` – one `LegalDocumentItem` per kind (`terms`, `privacy`; advertisers: `terms` only) in the locale (falls back to `en`). Markdown + URL. |
| GET    | `/users/me/consents`                                 | `{ consents: UserConsentState[], requiresConsent: LegalDocumentKind[] }` (also embedded in `UserProfile`)                                                                     |
| POST   | `/users/me/consents`                                 | `AcceptConsentDto { kind, version }` – `version` must be the current one → updated state                                                                                     |
| GET/POST | `/advertisers/me/consents`                         | → `AdvertiserConsentState` (`consents[]`, `requiresConsent[]`, `acceptedTermsVersion`, `currentTermsVersion`, `requiresTermsAcceptance`). `AdvertiserProfile` carries the same three version fields; campaign submit needs the current version |

Mobile: after `otp/verify` (and after `complete-profile`) check `user.requiresConsent`; when non-empty show the consent
screen (render `contentMarkdown` from `/legal/current`) before the home feed – every `/ads/*`, `/offers/*` and
`POST /withdrawals` call returns `403 CONSENT_REQUIRED` until accepted. Publishing a new version re-triggers the screen.
Advertiser portal: send `termsVersion` in `POST /auth/advertiser/register`; show a banner with an "Accept" action when
`requiresTermsAcceptance` is true.

---

## Auth (`/auth`)

| Method | Path                               | Auth       | Body → Response                                                                                                     |
| ------ | ---------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| POST   | `/auth/otp/request`                | public     | `{ phoneNumber }` → `{ phoneNumber, expiresInSeconds, resendAfterSeconds, devCode? }`                               |
| POST   | `/auth/otp/verify`                 | public     | `{ phoneNumber, code, deviceId?, deviceFingerprint?, referralCode? }` → `{ tokens, user, isNewUser, referralApplied? }` (`referralCode` honoured on the FIRST login only; invalid → 400 `REFERRAL_CODE_INVALID`) |
| POST   | `/auth/users/complete-profile`     | user       | `{ fullName, dateOfBirth?: 'YYYY-MM-DD', dateOfBirthEthiopian?: { year, month 1–13, day }, languagePreference? }` – exactly one DOB form; Ethiopian dates are converted/validated server-side (Pagume, leap years) → `UserProfile` (403 `AGE_RESTRICTED` if < 18) |
| POST   | `/auth/advertiser/register`        | public     | `AdvertiserRegisterDto` (+ `termsVersion?` from `GET /legal/current?audience=advertiser`) → `{ tokens, advertiser }` (verificationStatus `pending`) |
| POST   | `/auth/advertiser/login`           | public     | `{ email, password }` → `{ tokens, advertiser }`. Throttled per IP / per account (`429 LOGIN_RATE_LIMITED`), locked after 5 consecutive failures (`423 ACCOUNT_LOCKED`, `details.retryAfterSeconds`) – Phase 5 |
| POST   | `/auth/admin/login`                | public     | `{ email, password }` → `{ tokens, admin }` (`admin.role`) **or**, when the admin has TOTP enabled, `AdminMfaChallengeResponse { mfaRequired: true, mfaToken, expiresIn: 300 }` (no tokens yet). Same throttle / lockout as the advertiser login – Phase 5 |
| POST   | `/auth/admin/login/mfa`            | public     | `AdminMfaLoginDto { mfaToken, code }` → `{ tokens, admin }`. `400 MFA_CODE_INVALID` (counts toward the lockout), `401 MFA_TOKEN_INVALID` (expired / already used – start over) – Phase 5 |
| POST   | `/auth/refresh`                    | public     | body mode (mobile): `{ refreshToken }` → `AuthTokens`. **Cookie mode** (web, Phase 5): header `X-Auth-Mode: cookie` + `credentials: 'include'`, empty body → `CookieModeAuthTokens { accessToken, expiresIn, tokenType, authMode: 'cookie' }`; the rotated refresh token is set as the httpOnly `rap_refresh` cookie (path `/api/v1/auth`, SameSite=Strict, Secure) and never appears in the body |
| POST   | `/auth/logout`                     | public     | `{ refreshToken }` (+ the current access token as Bearer) → 204. The refresh family is revoked AND the presented access token is denylisted immediately (F2). Cookie mode: `X-Auth-Mode: cookie`, empty body – the `rap_refresh` cookie carries the token and is cleared |
| POST   | `/auth/advertiser/change-password` | advertiser | `{ currentPassword, newPassword }` → `ChangePasswordResponse { changed: true, sessionsRevoked: true }` (all refresh tokens revoked; re-login required) |

Mobile onboarding flow: `otp/request` → `otp/verify` → if `user.profileComplete === false` → `complete-profile` →
`PATCH /users/me` for language → home. Store tokens in secure storage; on `401 TOKEN_EXPIRED` refresh and retry once.

## Users (`/users`, user token)

| Method | Path                         | Response                                                                                                                                                            |
| ------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/users/me`                  | `UserProfile`                                                                                                                                                       |
| PATCH  | `/users/me`                  | `{ fullName?, languagePreference?, notificationPrefs? }` → `UserProfile`                                                                                            |
| GET    | `/users/me/summary`          | `UserSummary` – balance, today's completions vs cap, totals, unread notifications, available ads/offers                                                             |
| GET    | `/users/me/balance`          | `BalanceResponse` – `coinBalance`, `etbEquivalent`, `coinsPerEtb`, `ledgerChecksum`, `conversionNote`. **Only source of truth for the balance.**                    |
| GET    | `/users/me/ledger`           | `Paginated<LedgerEntry>` (signed `amount`, `balanceAfter`, `sourceType`)                                                                                            |
| GET    | `/users/me/notifications`    | `Paginated<NotificationItem>`; `POST /users/me/notifications/:id/read`                                                                                              |
| POST   | `/users/me/push-tokens`      | `{ token, platform, deviceId? }`; `DELETE /users/me/push-tokens/:token`                                                                                             |
| GET    | `/users/me/recently-watched` | `{ data: RecentlyWatchedItem[] }` � last 20 ads the user opened (from server-side watch sessions), newest first, with a `reported` flag for the "report an ad" flow |
| POST   | `/users/me/ad-reports`       | `{ adId, reason, details? }` → `AdReport` (one per user per ad)                                                                                                     |
| GET    | `/users/me/kyc`              | `MyKycResponse` – `kycTier`, latest submission, `canSubmit`, `requiredAboveMonthlyEtb`, `monthlyPayoutTotalEtb`, upload limits                                        |
| POST   | `/users/me/kyc/uploads/presign` | `KycPresignDto { kind: document_front\|document_back\|selfie, contentType, sizeBytes }` → `KycPresignResponse` (presigned PUT into the PRIVATE prefix; `publicUrl` is empty on purpose; echoes `kind`) |
| POST   | `/users/me/kyc`              | `CreateKycSubmissionDto` (idType, idNumber, fullName, DOB Gregorian or Ethiopian, document keys) → `KycSubmissionItem` (pending). One pending at a time                |
| GET    | `/users/me/referrals`        | `MyReferralsResponse` – my code, `shareText` (en/am), `shareUrl`, bonus amounts, totals, `referredBy` (`bonusCoins` quotes the configured referee bonus while `pending`), list of invited friends |
| POST   | `/users/me/data-export`      | 202 → `DataExportItem` (async). `GET /users/me/data-export` (list) / `GET /users/me/data-export/:id` (`downloadUrl` presigned when `ready`)                         |
| POST   | `/users/me/delete-request`   | `{ reason? }` → `DeletionRequestItem` (`scheduledFor` = now + 14 days). `GET` → `MyDeletionRequestResponse { request: DeletionRequestItem \| null }` (always a JSON object); `DELETE /users/me/delete-request` cancels while pending. 409 while withdrawals are in flight |

`UserProfile` now also carries `dateOfBirthEthiopian`, `kycTier`, `referralCode`, `consents[]` and `requiresConsent[]`.
A `UserStatus` of `deleted` exists (anonymised accounts); tokens of such accounts fail with `INVALID_TOKEN`.

## Ads (`/ads`, user token, verified adult)

| Method | Path                                 | Notes                                                                                                                                                                      |
| ------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/ads/feed?page&limit`               | `Paginated<AdFeedItem, AdFeedMeta>`; `meta.dailyRemaining`, `meta.hiddenByFrequencyCap` (ads hidden today by campaign/advertiser caps). Empty when cap reached or trust too low. |
| GET    | `/ads/:id`                           | `AdDetail` (+ `minWatchSeconds`, `heartbeatIntervalSeconds`, `alreadyCompleted`)                                                                                           |
| POST   | `/ads/:id/watch-sessions`            | `{ deviceFingerprint, deviceId? }` → `WatchSessionResponse` (`sessionId`, `minWatchSeconds`, `heartbeatIntervalSeconds`, `expiresAt`, `rewardCoins`, `attentionQuestion?`) |
| POST   | `/ads/watch-sessions/:sid/heartbeat` | `{ positionSeconds? }` → `{ ok, heartbeatCount, elapsedSeconds, serverTime }` – call every `heartbeatIntervalSeconds` while playing                                        |
| POST   | `/ads/watch-sessions/:sid/complete`  | `{ attentionAnswerIndex? }` → `AdCompletionResult` `{ status: valid                                                                                                        | flagged | rejected, coinReward, newBalance, reasonCode, replayed }` |

Player rules for the mobile app:

1. Start the session when playback starts; play for at least `minWatchSeconds` (server-timed – pausing the video does
   not pause the clock, so keep the video and the session together).
2. Heartbeat every `heartbeatIntervalSeconds` (calls faster than half the interval are ignored). Without heartbeats
   (≥ 60% of expected, last one recent) the completion is rejected.
3. When the video ends, show the attention question (if provided) and call `complete` with the chosen option index.
4. Render the result from `status`: `valid` → coin animation with `coinReward`; `flagged` → "under review"; `rejected` →
   `reasonCode` message. Then re-fetch `/users/me/balance`.
5. Completion is idempotent – on network errors retry the same call; `replayed: true` means it had already been processed
   and `newBalance` is the user's CURRENT balance (F3).
6. If the app is killed mid-watch, discard the session locally (the server expires it); starting a new session for the same
   ad is allowed up to 3 times per day.
7. Frequency caps (Phase 4A): each campaign allows `frequencyCapPerUserPerDay` rewarded completions per user per UTC day
   (advertiser-set, 1–5) and a user may complete at most `ADVERTISER_IMPRESSION_CAP_PER_USER_PER_DAY` (3) distinct ads of
   the same advertiser per day. Capped ads simply disappear from the feed (`meta.hiddenByFrequencyCap` counts them for
   the empty state); a race at completion time yields `rejected` with `reasonCode: FREQUENCY_CAP_REACHED`.

## Offers (`/offers`, user token, verified adult)

| Method | Path                                | Notes                                                                                        |
| ------ | ----------------------------------- | -------------------------------------------------------------------------------------------- |
| GET    | `/offers?type=survey                | app_install`                                                                                 | `Paginated<OfferListItem>` sorted by reward; `completionStatus` shows what the user already did |
| GET    | `/offers/surveys/:id`               | `SurveyDetail` with `questions[]` (`single_choice`, `multi_choice`, `rating`, `text`)        |
| POST   | `/offers/surveys/:id/complete`      | `{ answers: [{ questionId, value }] }` → `OfferCompletionResult` (credited immediately)      |
| GET    | `/offers/app-installs/:id`          | `AppInstallOfferDetail` (`storeUrl`, `instructions`)                                         |
| POST   | `/offers/app-installs/:id/complete` | `{ deviceFingerprint, proof? }` → `pending_verification` (credited after admin verification) |
| GET    | `/offers/me/completions`            | `Paginated<OfferCompletionHistoryItem>`                                                      |

## Withdrawals (`/withdrawals`, user token)

| Method | Path                                    | Notes                                                                                                                                                                                                                                                                       |
| ------ | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/withdrawals/config`                   | `WithdrawalConfig` – `minWithdrawalEtb`, `coinsPerEtb`, `largeWithdrawalThresholdEtb`, `dailyRequestLimit`, `methods[]`, `conversionNote`, **`kycTier`, `kycRequiredAboveMonthlyEtb`, `monthlyPayoutTotalEtb`, `destinationResolveTtlMinutes`, `knownDestinations[]`** |
| GET    | `/withdrawals/destinations`             | `PayoutDestinationItem[]` – destinations the user verified/used (masked); `known: true` = usable without lookup/OTP                                                                                                                                                         |
| POST   | `/withdrawals/destinations/resolve`     | `ResolveDestinationDto { payoutMethod, payoutDestination, bankCode? }` → `ResolveDestinationResponse { accountName, normalizedDestination, provider, mock, known, otpRequired, lookupPerformed, lookupsRemainingToday, validUntil }`. **Phase 5 (#11):** for a NEW destination NO partner lookup happens yet – `accountName: null, provider: null, otpRequired: true, lookupPerformed: false`; known / OTP-fresh destinations are looked up and the name returned (`422 DESTINATION_NOT_FOUND`). Every partner lookup counts toward `DESTINATION_LOOKUPS_PER_DAY` (`429 DESTINATION_LOOKUP_LIMIT`) |
| POST   | `/withdrawals/destinations/otp/request` | sends a `destination_change` OTP to the user's own phone → `{ phoneNumber (masked), expiresInSeconds, resendAfterSeconds, devCode? }`                                                                                                                                       |
| POST   | `/withdrawals/destinations/otp/verify`  | `VerifyDestinationOtpDto { code, payoutMethod, payoutDestination, bankCode? }` → `VerifyDestinationOtpResponse` (= `PayoutDestinationItem` + `normalizedDestination, provider, mock, validUntil`). **Phase 5:** after a valid code the partner lookup runs here and `accountName` is revealed (`422 DESTINATION_NOT_FOUND`, `429 DESTINATION_LOOKUP_LIMIT`); `400 OTP_INVALID \| OTP_EXPIRED`, `429 OTP_TOO_MANY_ATTEMPTS` |
| POST   | `/withdrawals`                          | `{ amountEtb, payoutMethod, payoutDestination? \| payoutDestinationId?, destinationName?, bankCode? }` (+ `Idempotency-Key`) → `WithdrawalItem`. **`payoutDestinationId`** (a `knownDestinations[].id`) replaces the number for KNOWN destinations – the server resolves it, no lookup/OTP, nothing stored on-device (`400 INVALID_PAYOUT_DESTINATION` for foreign/wrong-method ids, `422 DESTINATION_NOT_VERIFIED` when never used). Status `flagged_for_review` (first / large / low trust) or `pending`. Coins are held immediately. |
| GET    | `/withdrawals?status`                   | `Paginated<WithdrawalItem>` (destination masked)                                                                                                                                                                                                                            |
| GET    | `/withdrawals/:id`                      | `WithdrawalItem` – poll for `processing → completed \| failed` (failed = coins refunded)                                                                                                                                                                                    |

Gates evaluated by `POST /withdrawals`, in order: minimum → destination format → method available → daily request
limit → *(inside the transaction, under `SELECT … FROM users FOR UPDATE` – Phase 5 #12)* single in-flight (also
enforced by a partial unique index) → balance → **KYC tier** (`phone_only` users: completed + in-flight payouts of the
rolling 30 days + this request must stay **strictly below** `kycRequiredAboveMonthlyEtb`; a projected total **at or
above** it (≥ 1 000 ETB by default — inclusive boundary, Phase 4D product decision) → `422 KYC_REQUIRED` with
`details.projectedEtb`) →
**destination verification** (a destination never used for a successful request needs an OTP verify – which performs
the partner lookup – within the last `destinationResolveTtlMinutes`, else `422 DESTINATION_NOT_VERIFIED` /
`DESTINATION_OTP_REQUIRED`).

Recommended mobile flow for a new destination (Phase 5 order): user enters the number → `resolve` (no name yet:
"Send to this telebirr account? We'll show the account holder after you confirm the code") → `otp/request` → enter
code → `otp/verify` → the response reveals "**Abebe Tesfaye**" (`mock: true` in demo) → `POST /withdrawals` with
`normalizedDestination`. Known destinations (chips from `knownDestinations`) skip straight to the request.
`WithdrawalItem.destinationAccountName` / `destinationVerifiedAt` show what was verified.

Status meanings for the UI: `flagged_for_review` "under review by our team" (show `reviewReasons`), `pending` "queued",
`processing` "sending to <provider>", `needs_manual_review` "the partner has not confirmed the transfer yet; our finance
team is verifying it – coins stay reserved" (Phase 5 #7), `completed`, `failed` (`failureReason`, coins returned),
`rejected` (coins returned). `IN_FLIGHT_WITHDRAWAL_STATUSES` in `@rap/shared` lists the statuses that block a new
request / account deletion.

## Advertisers (`/advertisers`, advertiser token)

| Method | Path              | Notes                                                                                                                       |
| ------ | ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/advertisers/me` | `AdvertiserProfile` � fresh `verificationStatus`, `walletBalanceEtb`, `notificationPrefs` (poll after registering)          |
| PATCH  | `/advertisers/me` | `{ businessName?, contactPhone?, notificationPrefs? }` ? `AdvertiserProfile` (registration number / email are not editable) |

## Campaigns (`/campaigns`, advertiser token)

| Method   | Path                               | Notes                                                                                                                                                                    |
| -------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET      | `/campaigns/overview`              | `AdvertiserOverview` – cards + 30-day daily series (`spendEtb`, `validCompletions`, `rawViews`)                                                                          |
| GET      | `/campaigns?status&page&limit`     | `Paginated<CampaignSummary>`                                                                                                                                             |
| POST     | `/campaigns`                       | `CreateCampaignDto` (+ `frequencyCapPerUserPerDay?` 1–5, default 1) → `CampaignSummary` (draft). `rewardPerActionEtb`/`rewardCoins` are computed by the server.                |
| GET      | `/campaigns/:id`                   | `CampaignDetail` (`ads[]`)                                                                                                                                               |
| PATCH    | `/campaigns/:id`                   | draft/rejected: any field; paused: budget increase (+dates/text) only                                                                                                    |
| DELETE   | `/campaigns/:id`                   | draft only → 204                                                                                                                                                         |
| POST     | `/campaigns/:id/submit`            | reserves the budget from the wallet → `pending_review` (`422 INSUFFICIENT_WALLET_BALANCE`, `403 ADVERTISER_NOT_VERIFIED`, `403 CONSENT_REQUIRED` (terms), `400 CAMPAIGN_HAS_NO_ADS` for video campaigns) |
| POST     | `/campaigns/:id/pause` / `resume`  | active ⇄ paused (resume refused while `pausedReason = admin_paused` or budget exhausted)                                                                                 |
| POST     | `/campaigns/uploads/presign`       | `{ fileName, contentType, sizeBytes }` → `{ method: 'PUT', uploadUrl, headers, storageKey, publicUrl, expiresInSeconds }`                                                |
| GET/POST | `/campaigns/:id/ads`               | list / add creative `CreateAdDto` (`storageKey` from presign or `mediaUrl`, `mediaType`, `durationSeconds`, `attentionQuestions?`)                                       |
| DELETE   | `/campaigns/:id/ads/:adId`         | non-approved creatives only                                                                                                                                              |
| GET      | `/campaigns/:id/analytics?from&to` | `CampaignAnalytics` – `totals` (rawViews, rawCompletions, valid/flagged/rejected, `fraudFilteredRate`, spend, remaining, uniqueUsers) + `daily[]`                        |

Upload flow: `presign` → `PUT uploadUrl` with the file and the returned `headers` → `POST /campaigns/:id/ads` with
`storageKey`. Limits: video mp4/webm ≤ 100 MB, image jpeg/png/webp ≤ 5 MB (`UPLOAD_LIMITS`).

Media pipeline (Phase 4A): every video creative is created with `mediaStatus: processing` and a `media.process` job
runs ffprobe (true duration, codec, dimensions → `mediaProbe`), corrects `durationSeconds` when the declared value is
off by more than 1 s (`mediaStatus: duration_corrected`, `durationDeclaredSeconds` / `durationProbedSeconds` kept),
transcodes to a 720p H.264 MP4 that becomes `mediaUrl` (the upload stays reachable as `originalMediaUrl` server-side)
and generates a poster when no `thumbnailUrl` was supplied. Terminal states: `ready`, `duration_corrected`, `failed`
(`mediaError`). Poll `GET /campaigns/:id/ads` after upload and show a "processing" badge; reviewers cannot approve
while `processing`/`failed` (`422 MEDIA_NOT_READY`) and can trigger `POST /admin/ads/:id/reprocess-media`. Only
`ready`/`duration_corrected` ads are served in the feed; the watch session `minWatchSeconds` uses the probed duration.

## Billing (`/billing`, advertiser token unless noted)

| Method | Path                                 | Notes                                                                                                                                                                                                                                                                                                                  |
| ------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/billing/balance`                   | `WalletBalanceResponse` (`balanceEtb`, `reservedEtb`, lifetime totals)                                                                                                                                                                                                                                                 |
| GET    | `/billing/ledger`                    | `Paginated<AdvertiserLedgerEntry>`                                                                                                                                                                                                                                                                                     |
| POST   | `/billing/topups`                    | `{ amountEtb (=100), returnUrl? }` ? `TopupResponse` � redirect the browser to `checkoutUrl`. The gateway (and the mock checkout) sends the browser back to `returnUrl` (default `<ADVERTISER_WEB_URL>/billing?topup=<txRef>`) **with `paymentId` and `txRef` appended**; `TopupResponse.returnUrl` is that final URL. |
| GET    | `/billing/payments`, `/payments/:id` | `Paginated<PaymentItem>`; detail re-verifies pending payments with the gateway                                                                                                                                                                                                                                         |
| GET    | `/billing/invoices`, `/invoices/:id` | `Paginated<InvoiceItem>` (JSON line items)                                                                                                                                                                                                                                                                             |
| POST   | `/billing/webhooks/chapa`            | public, signature-verified gateway webhook                                                                                                                                                                                                                                                                             |
| GET    | `/billing/mock-checkout/:txRef`      | public HTML page (mock mode only; its script is served from `�/mock-checkout/assets/checkout.js`, so it works under the API CSP). `POST �/:txRef/pay { outcome: 'success'\|'failed' }` ? `{ txRef, paymentId, status, returnUrl }`.                                                                                    |

## Admin (`/admin`, admin token; role-gated)

| Area                     | Endpoints                                                                                                                                                                                                                                                                                            | Roles                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Home                     | `GET /admin/me` (role + permissions), `GET /admin/overview` (counters incl. Phase 4 queues `pendingKyc`, `openAlerts`, `pendingDeletionRequests`, `adsMediaProcessing`, `adsMediaFailed`), `GET /admin/config` (effective platform config incl. `payoutMaxAttempts`, minimums and mock flags) | all admins                                                            |
| Ad review                | `GET /admin/ads/review-queue?status&mediaStatus`, `GET /admin/ads/:id` (incl. `attentionQuestions` with `correctIndex`, `bannedTopics`), `POST /admin/ads/:id/approve { bannedTopicsChecklist: { checks: {alcohol: true, …}, notes? }, note? }`, `POST /admin/ads/:id/reject { reason, bannedTopicsChecklist? }` | ad_reviewer, super_admin (`GET :id` also support)                     |
| Campaign moderation      | `GET /admin/campaigns?status&advertiserId`, `GET /admin/campaigns/:id` (+analytics), `POST …/approve { note? }`, `…/reject { reason }`, `…/pause { reason }`, `…/resume`                                                                                                                             | ad_reviewer, super_admin (pause/resume + support; lists also finance) |
| Ad reports               | `GET /admin/ad-reports?status`, `POST /admin/ad-reports/:id/review { outcome, note?, rejectAd?, rejectionReason? }`                                                                                                                                                                                  | ad_reviewer, support, super_admin                                     |
| Users                    | `GET /admin/users?q&status&minTrustScore&maxTrustScore`, `GET /admin/users/:id` (stats, flags, ledger, withdrawals), `POST /admin/users/:id/suspend                                                                                                                                                  | ban                                                                   | reinstate { reason }` | support, super_admin (lists also finance) |
| Advertisers              | `GET /admin/advertisers?status&q`, `GET /admin/advertisers/:id`, `POST …/verify { note? }`, `POST …/reject { reason }`                                                                                                                                                                               | support, super_admin (lists: + finance, ad_reviewer)                  |
| Fraud dashboard          | `GET /admin/fraud/metrics`, `GET /admin/fraud/flags?severity&resolved&userId&flagType`, `GET /admin/fraud/flags/:id`, `POST …/dismiss { note? }`, `…/escalate { note? }`, `…/suspend-user { reason }`                                                                                                | support, finance, super_admin                                         |
| Withdrawal queue         | `GET /admin/withdrawals?status&userId`, `GET /admin/withdrawals/:id` (approvals, full destination), `POST …/approve { note? }`, `…/reject { reason }`, `…/retry`, **`POST …/resolve-manual-review { outcome: 'completed' \| 'failed', reason, providerReference? }`** (Phase 5 #7: decide a `needs_manual_review` payout – `completed` keeps the coin hold, `failed` refunds it; `409 WITHDRAWAL_NOT_REVIEWABLE` otherwise) | finance, super_admin                                                  |
| Coin adjustments         | `GET /admin/coin-adjustments?status&userId`, `POST /admin/coin-adjustments { userId, amount, reason, reference? }`, `GET …/:id`, `POST …/:id/approve { note? }` (different admin), `…/reject { reason }`, `…/cancel` (requester)                                                                     | finance, super_admin                                                  |
| Revenue                  | `GET /admin/revenue/overview?from&to` → `RevenueOverview` (totals, daily, byAdvertiser, byActionType)                                                                                                                                                                                                | finance, super_admin                                                  |
| Audit log                | `GET /admin/audit-log?actorId&actor&actorType&action&targetType&targetId&q&from&to` – `actor=` takes an admin email, advertiser email, user phone (any format) or uuid and is resolved server-side (unknown → empty page, `meta.actorResolved: false`; resolved → `meta.actor { id, actorType, label }`); rows carry `actorLabel` (admin email / user phone / advertiser email / "system") | finance, support, super_admin                                         |
| App-install verification | `GET /admin/offers/app-install-completions?status`, `POST …/:id/verify { note? }`, `…/:id/reject { reason }`                                                                                                                                                                                         | support, super_admin                                                  |
| KYC queue (4A)           | `GET /admin/kyc?status&idType&q` (default pending), `GET /admin/kyc/:id` (`AdminKycDetail`: 5-minute presigned `documents.front/back/selfie` URLs, `profileMatch`, `duplicateIdentityUsers: [{ id, phoneNumber, kycStatus }]` + `duplicateIdentityCount`, provider pre-check), `POST /admin/kyc/:id/approve { note? }` (→ user `id_verified`), `POST /admin/kyc/:id/reject { reason }` | support, finance, super_admin                                         |
| Alerts (4A)              | `GET /admin/alerts?type&severity&acknowledged&from&to` (`AdminAlertsMeta`: `meta.openCount`, `meta.notifiers`) – readable by **all four roles** (reviewers see spend-velocity alerts on campaigns they review); `POST /admin/alerts/:id/ack` (support, finance, super_admin); `POST /admin/alerts/run-rules` (super_admin) | read: all admins · ack: support, finance, super_admin · run: super_admin |
| Referrals (4A)           | `GET /admin/referrals?status&referrerId&refereeId` (`AdminReferralItem`), `GET /admin/referrals/metrics` (`AdminReferralMetrics`)                                                                                                                                                                   | support, finance, super_admin                                         |
| Deletion requests (4A)   | `GET /admin/deletion-requests?status` (default pending; `pendingWithdrawals` per row), `POST …/:id/execute { note? }` (anonymise now), `POST …/:id/cancel { note? }` – both return the same `AdminDeletionRequestItem` shape as a list row (incl. `user`, `pendingWithdrawals`)                     | support, super_admin                                                  |
| Impersonation (4A)       | `POST /admin/users/:id/impersonate { reason }` → `ImpersonationTokenResponse` (10-min READ-ONLY user token; audited on issue and on every request). `GET /admin/users/:id` now includes `kyc`, `deletionRequest`, `referralStats`                                                                    | support, super_admin                                                  |
| Media (4A)               | `POST /admin/ads/:id/reprocess-media` (re-run probe/transcode); review items carry `mediaStatus`, `mediaProbe`, `durationDeclaredSeconds`, `durationProbedSeconds`, `mediaError`                                                                                                                    | ad_reviewer, super_admin                                              |
| Advertiser wallet        | `GET /admin/advertisers/:id/wallet`                                                                                                                                                                                                                                                                  | support, finance, super_admin                                         |
| My security (Phase 5 #5, 5b New-7) | `POST /admin/me/change-password { currentPassword, newPassword }` → `AdminChangePasswordResponse` (clears `mustChangePassword`, revokes every session – sign in again); `POST /admin/me/mfa/setup { password }` → `MfaSetupResponse { secret, otpauthUri, issuer, account }` (pending until enabled; `401 INVALID_CREDENTIALS`, `409 MFA_ALREADY_ENABLED`); `POST /admin/me/mfa/enable { code, password }` → `MfaStatusResponse` (`400 MFA_CODE_INVALID`, `401 INVALID_CREDENTIALS`); `POST /admin/me/mfa/disable { code, password }` (`401 INVALID_CREDENTIALS`, `400 MFA_NOT_ENABLED`). All three share the login throttle / lockout (`429` / `423`). `GET /admin/me` exposes `mfaEnabled`, `mfaSetupRequired`, `mustChangePassword` | all admins (also while the account is in a pending security state) |
| Admin accounts (Phase 5 #5) | `GET /admin/admins` → `{ data: AdminAccountItem[], meta: { total } }`; `POST /admin/admins { email, fullName, role }` → `CreateAdminResponse { admin, temporaryPassword }` (shown ONCE; `mustChangePassword: true`; `409 EMAIL_ALREADY_REGISTERED`); `PATCH /admin/admins/:id/role { role, reason }` (revokes all of their sessions – the old role dies immediately; `409 LAST_SUPER_ADMIN`); `POST /admin/admins/:id/reset-password` → `ResetAdminPasswordResponse { admin, temporaryPassword }`; `PATCH /admin/admins/:id/active { active, reason }` (`409 LAST_SUPER_ADMIN` / self-deactivation) | super_admin |

`GET /admin/config` additionally exposes `kycRequiredAboveMonthlyEtb`, `defaultFrequencyCap`,
`advertiserImpressionCapPerUserPerDay`, `referralBonusCoins`, `refereeBonusCoins`, `referralMaxPerReferrerPerDay`,
`accountDeletionGraceDays`, `destinationResolveTtlMinutes`, `alerts {…thresholds}` and `mocks.idVerification / alerts /
destinationLookup`. `GET /admin/revenue/overview` totals gain `referralBonusesEtb` (platform cost) and
`netPlatformRevenueEtb`; daily points gain `referralBonusesEtb`.

Impersonation UI rules: show a persistent banner "Viewing as <user> (read-only, expires HH:MM)" while the token is in
use, hide every write action, and never store the token beyond the session.

Admin UI rules: large withdrawals (`requiresDualApproval`) show `approvalsCount/2` and must disable "Approve" for an admin
already listed in `approvals`; coin adjustments must disable "Approve" for `requestedBy === me`. Every decision needs a
reason where the API requires one (`REJECTION_REASON_REQUIRED`). Approving an ad requires **every** key of
`BANNED_TOPICS` set to `true` in `bannedTopicsChecklist.checks`.

## Phase 4C contract changes (post-frontend-integration)

All backwards compatible. Summary for clients built against the Phase 4A contract:

| Change                                                                                                  | Who cares          |
| ------------------------------------------------------------------------------------------------------- | ------------------ |
| `POST /withdrawals` accepts `payoutDestinationId` (id from `knownDestinations[]`) instead of the number | mobile             |
| OTP business errors (`OTP_INVALID`, `OTP_EXPIRED`) are **400** on `/auth/otp/verify` AND `/withdrawals/destinations/otp/verify` (were 401); `OTP_TOO_MANY_ATTEMPTS` is 429 | mobile |
| `MyReferralsResponse.referredBy.bonusCoins` quotes the configured referee bonus while `pending`         | mobile             |
| `GET /users/me/delete-request` → `{ request: DeletionRequestItem \| null }` (never an empty body)       | mobile             |
| `KycPresignResponse` (echoes `kind`), `ChangePasswordResponse`, `AdvertiserConsentState`, `AdminAlertsMeta`, `AuditLogMeta`, `MyDeletionRequestResponse` typed in `@rap/shared` | all |
| `409 IDEMPOTENCY_KEY_REUSED` details gain `resourceId` (the created resource, once the first request finished; `null` while `inProgress`) | all |
| `POST /admin/deletion-requests/:id/execute\|cancel` return the list-row shape (`user`, `pendingWithdrawals`, …) | admin           |
| `AuditLogItem.actorLabel`; `GET /admin/audit-log?actor=` resolved server-side; `meta.actorResolved`      | admin              |
| `AdminOverview.pendingKyc / openAlerts / pendingDeletionRequests / adsMediaProcessing / adsMediaFailed` | admin              |
| `AdminKycDetail.duplicateIdentityUsers` is now `[{ id, phoneNumber, kycStatus }]` (+ `duplicateIdentityCount`) | admin          |
| `GET /admin/ads/review-queue?mediaStatus=`                                                              | admin              |
| `GET /admin/alerts` readable by `ad_reviewer` too (ack: support/finance/super_admin; run-rules: super_admin); admin `permissions[]` gain `kyc.review`, `alerts.view`, `alerts.ack`, `referrals.view`, `deletions.manage`, `users.impersonate` | admin |

### Phase 4D contract changes (QA clean-up, backwards compatible)

| Change                                                                                                   | Affects            |
| -------------------------------------------------------------------------------------------------------- | ------------------ |
| **KYC threshold is inclusive**: `422 KYC_REQUIRED` once rolling-30-day payouts + the request are **≥** `kycRequiredAboveMonthlyEtb` (exactly 1 000 ETB now requires KYC); message "Payouts of {threshold} ETB or more per 30 days require identity verification" | mobile |
| `GET /admin/audit-log` meta gains `actor: { id, actorType, label } \| null` next to `actorResolved` (filled for `actor=` and legacy `actorId=`; `actorType` is `null` for an unknown uuid) | admin |

## Phase 5 contract changes (security remediation)

Full write-up: `docs/SECURITY.md`. Behaviour changes a client can observe (everything else is server-side):

| # | Change | Affects |
| --- | ------ | ------- |
| #1 | Campaign submissions are keyed by `submissionSeq` (new field on `Campaign`); the wallet balance is asserted under the row lock on every submit (`422 INSUFFICIENT_WALLET_BALANCE`); `budgetEtb` of a draft/rejected campaign can only be changed while its net reservation is 0 (`409 CAMPAIGN_INVALID_STATE`) | advertiser |
| #2 | `POST /campaigns/:id/ads` requires `storageKey` from `POST /campaigns/uploads/presign` under `creatives/<advertiserId>/`; remote `mediaUrl` ingestion is gone – a URL is accepted only if it points at our own bucket under that prefix (`400 MEDIA_SOURCE_NOT_ALLOWED`). `mediaError` is now a generic category message | advertiser |
| #4 | OTP verification (`/auth/otp/verify`, `/withdrawals/destinations/otp/verify`) is rate limited per phone and per IP (`429 OTP_TOO_MANY_ATTEMPTS` also when the per-window limit is hit); a code is burned after `OTP_MAX_ATTEMPTS` wrong guesses | mobile |
| #5 | Password logins: `429 LOGIN_RATE_LIMITED`, `423 ACCOUNT_LOCKED { retryAfterSeconds }`. Admin TOTP MFA: login may answer `{ mfaRequired, mfaToken }` → `POST /auth/admin/login/mfa`; with `ADMIN_MFA_REQUIRED=true` finance/super_admin without TOTP get `403 MFA_SETUP_REQUIRED` everywhere except `/admin/me`, `/admin/me/mfa/*`, `/admin/me/change-password`; a temporary password → `403 PASSWORD_CHANGE_REQUIRED` with the same allow-list. New admin-management endpoints (see Admin table). `AdminProfile` gains `mfaEnabled`, `mfaSetupRequired`, `mustChangePassword` | admin, advertiser |
| #7 | New `WithdrawalStatus.needs_manual_review` (counts as in flight); `POST /admin/withdrawals/:id/resolve-manual-review`; `AdminOverview.withdrawalsNeedingManualReview`. Payouts are never auto-refunded on an ambiguous partner answer any more | mobile, admin |
| #11 | `resolve` no longer reveals the holder name for a NEW destination (`accountName: null`, `lookupPerformed: false`); `otp/verify` performs the lookup and returns it (`VerifyDestinationOtpResponse`). Per-user `429 DESTINATION_LOOKUP_LIMIT` (`lookupsRemainingToday`) | mobile |
| #12 | `POST /withdrawals` one-in-flight / first-withdrawal / KYC checks run inside the transaction; a race now yields `409 WITHDRAWAL_PENDING_EXISTS` instead of two holds | mobile |
| #13 | `@Roles` is evaluated against the admin's CURRENT role in the database (a role change takes effect on the next request even with an old access token; role changes also revoke all sessions) | admin |
| #15 | Concurrent refreshes of one refresh token: the loser is `401 REFRESH_TOKEN_REUSED` (family revoked) | all |
| #16 | Cookie refresh mode for browsers (`X-Auth-Mode: cookie`, `CookieModeAuthTokens`, `rap_refresh` cookie); `RefreshTokenDto.refreshToken` / `LogoutDto.refreshToken` are optional (required in body mode → `400 VALIDATION_ERROR`). Web consoles ship CSP / nosniff / frame-ancestors headers | web |
| #17 | Chapa webhook: only the payload-bound `Chapa-Signature` is accepted; `400 PAYMENT_VERIFICATION_MISMATCH` when verify() disagrees on amount / currency; a payment is marked failed only when verify() confirms it | advertiser (billing status polling unchanged) |
| A3a | Attention-check options arrive in a per-session random order (answer with the position in the list you were shown – clients already do); a wrong answer consumes the ad for the day (`400 AD_NOT_AVAILABLE` on retry, hidden from the feed) | mobile |

Production-only behaviour (env schema, `docs/SECURITY.md`): mock checkout routes return 404, Swagger is off, OTP values
are never logged, the seed refuses to run, and the API refuses to boot without real payment / SMS / storage / signing
credentials.

### Phase 5b contract changes (second-opinion audit)

| Item | Change | Affects |
| --- | ------ | ------- |
| New-1 | `PATCH /campaigns/:id` and `POST /campaigns/:id/submit` re-validate under the campaign row lock: a concurrent edit or submit answers `409 CAMPAIGN_INVALID_STATE` ("changed concurrently; reload and retry") instead of silently winning; `budgetEtb` can only change while the ledger holds nothing beyond `spentEtb` for the campaign. `POST /admin/campaigns/:id/approve` answers `422 CAMPAIGN_UNDERFUNDED { budgetEtb, budgetReservedEtb }` when the reservation does not cover the budget (reject + resubmit). A live campaign never pays more than `min(budgetEtb, budgetReservedEtb)` | advertiser, admin |
| New-2 | Payouts: a withdrawal whose partner outcome stays unknown after a retry / crash is parked as `needs_manual_review` (never `failed`); new critical alert type `PAYOUT_STUCK_PROCESSING` | admin, mobile (status only) |
| New-3 | Cookie refresh mode is selected by the `X-Auth-Mode: cookie` **header only** (`?mode=cookie` is ignored); every `/auth/*` POST must be `application/json` (`415` otherwise); cookie-mode login / register / mfa / refresh / logout from an origin that is not in `CORS_ORIGINS` (or a `Sec-Fetch-Site: cross-site` request) answer `403 FORBIDDEN` before any work | web |
| New-5 | When Redis is unreachable in production the login throttle / lockout, MFA replay guard + challenge single-use, destination lookup cap and the access-token denylist answer `503 SERVICE_UNAVAILABLE { retryAfterSeconds: 5 }` instead of allowing (retry, do not sign the user out) | all |
| New-6 | `POST /admin/fraud/flags/:id/dismiss` on a flag attached to a flagged completion answers `422 CAMPAIGN_NOT_CHARGEABLE { campaignId, campaignStatus, remainingReservedEtb }` when the campaign is no longer live or has no reserved budget left – the flag stays open (escalate / confirm it instead); the completion is released BEFORE the flag is resolved | admin |
| New-7 | `POST /admin/me/mfa/setup { password }` and `POST /admin/me/mfa/enable { code, password }` now require the current password (`401 INVALID_CREDENTIALS`); setup, enable, disable and `POST /auth/admin/login/mfa` share the login throttle – wrong codes / passwords count toward the lockout (`429 LOGIN_RATE_LIMITED`, `423 ACCOUNT_LOCKED`). An `mfaToken` is never accepted as a Bearer token (`401 INVALID_TOKEN`) | admin |
| #5 note | The hard lockout is keyed per account **and source IP**: `423 ACCOUNT_LOCKED` means *this IP* is locked out of the account for `LOGIN_LOCKOUT_SECONDS`; the owner can still sign in from another address. The per-account `429 LOGIN_RATE_LIMITED` window stays as the soft throttle (an IP that completed a login for the account in the last `LOGIN_TRUSTED_IP_HOURS` is exempt from it) | admin, advertiser |
| New-8 | Account deletion also clears `user_consents.ip_address/device_id` and the deletion request's own `ip_address` (server-side; the consent kind/version/time survive as legal proof) | – |

Local setup change: `docker compose` now requires `REDIS_PASSWORD` in `.env` and `REDIS_URL` must carry it
(`redis://:<password>@localhost:6379`); copy the new lines from `.env.example`.
## Boolean query parameters

Boolean filters (`?resolved=false`) accept `true|false|1|0|yes|no`; they are parsed server-side with a dedicated
transformer (a plain `Boolean("false")` coercion bug was fixed in Phase 3), so `resolved=false` really returns only open flags.

## Admin login response

`POST /auth/admin/login` returns `admin` with the same shape as `GET /admin/me` (`role`, `roles[]`, `permissions[]`),
so dashboards can gate navigation immediately after login without a second request.

## Fraud (`/fraud`, admin token: support/finance/super_admin)

`GET /fraud/rules`, `POST /fraud/flags` (manual flag), `POST /fraud/flags/:id/resolve { resolution, note }`,
`POST /fraud/users/:id/recompute-trust`.

## Demo data cheat-sheet

- Approved ads with attention questions live in campaigns "Buna Time - Morning Roast launch" and "Save with AddisPay".
- Withdrawal queue: one first-time hold (75 ETB), one large (650 ETB) with 1/2 approvals from `finance@rap.et` –
  approve with `finance2@rap.et` or `super@rap.et`.
- Coin adjustment awaiting second approval: requested by `finance@rap.et` – approve with `super@rap.et`/`finance2@rap.et`.
- Users `+251911002466`, `+251911002603`, `+251911002740` share a device fingerprint (fraud flags); `+251911003151` is
  banned; `+251911002877` / `+251911003014` are suspended.
- Phase 4A: legal documents v1.0 (`terms`, `privacy`, en + am) are published and every seeded user/advertiser has
  accepted them (new accounts must accept before `/ads`, `/offers`, `POST /withdrawals`).
- KYC queue: 3 pending submissions (`+251911001233` Fayda, `+251911001644` national id, `+251911001918` Fayda with a
  registry name mismatch), 3 approved (`+251911000137`, `+251911000411`, `+251911000685` are `id_verified`), 1 rejected
  (`+251911002192`).
  Document links are placeholder PNGs from the private prefix.
- Referrals: `+251911000137` (code `779HLB`) referred two paid friends and `+251911000411` (`88CJ7D`) one; two
  `pending` (referrers `+251911000548` / `+251911000822`), one `qualified` – referrer daily cap (`+251911000959`) and
  one `rejected` – shared device (`+251911002466` → `+251911002740`, flags on both). Every user has a 6-char
  `referralCode` (deterministic per seed).
- Alerts: 4 seeded (`PAYOUT_FAILURE_RATE` acknowledged, `ACCOUNT_MINTING` critical, `SPEND_VELOCITY`, `OTP_SPIKE`
  open). `POST /admin/alerts/run-rules` evaluates the live rules.
- One pending account-deletion request (`+251911002192`, scheduled in 12 days) for the deletion queue.
- Payout destinations of users with withdrawal history are `known` (no lookup/OTP needed); any other number is NEW and
  goes through resolve → OTP. In MOCK mode a destination ending in `0000` is "not found".
