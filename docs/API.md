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
| `OTP_INVALID`, `OTP_EXPIRED`, `OTP_TOO_MANY_ATTEMPTS`, `OTP_RATE_LIMITED`                                                                                                                                                                          | OTP flow                                           | Inline messages; `details.retryAfterSeconds` / `details.attemptsRemaining`   |
| `DAILY_LIMIT_REACHED`                                                                                                                                                                                                                              | feed/watch/complete                                | "Come back tomorrow" state (`meta.dailyRemaining === 0`)                     |
| `AD_NOT_AVAILABLE`, `AD_ALREADY_COMPLETED`, `TOO_MANY_WATCH_ATTEMPTS`                                                                                                                                                                              | watch session start                                | Refresh the feed                                                             |
| `WATCH_DURATION_INSUFFICIENT`, `HEARTBEAT_CONTINUITY_FAILED`, `ATTENTION_CHECK_FAILED`, `ATTENTION_ANSWER_REQUIRED`, `WATCH_SESSION_EXPIRED`, `WATCH_DURATION_EXCESSIVE`, `FRAUD_REJECTED`, `CAMPAIGN_BUDGET_EXHAUSTED`                            | `reasonCode` on a `rejected` completion (HTTP 201) | Show "not rewarded" state with a friendly reason; allow retry where sensible |
| `BELOW_MIN_WITHDRAWAL`, `INSUFFICIENT_BALANCE`, `INVALID_PAYOUT_DESTINATION`, `WITHDRAWAL_PENDING_EXISTS`, `WITHDRAWAL_RATE_LIMITED`, `PAYOUT_METHOD_UNAVAILABLE`                                                                                  | withdrawals                                        | Inline validation using `GET /withdrawals/config`                            |
| `ADVERTISER_NOT_VERIFIED`, `INSUFFICIENT_WALLET_BALANCE`, `CAMPAIGN_INVALID_STATE`, `CAMPAIGN_HAS_NO_ADS`, `UPLOAD_TYPE_NOT_ALLOWED`                                                                                                               | advertiser portal                                  | Guide to verification / billing / fix state                                  |
| `ROLE_NOT_ALLOWED`, `DUAL_APPROVAL_SAME_ADMIN`, `DUAL_APPROVAL_ROLE_REQUIRED`, `ADJUSTMENT_SELF_APPROVAL_FORBIDDEN`, `ADJUSTMENT_NOT_PENDING`, `WITHDRAWAL_NOT_REVIEWABLE`, `AD_NOT_PENDING`, `REJECTION_REASON_REQUIRED`, `FLAG_ALREADY_RESOLVED` | admin                                              | Disable actions proactively based on role/state; show the reason             |

---

## Auth (`/auth`)

| Method | Path                               | Auth       | Body → Response                                                                                                     |
| ------ | ---------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| POST   | `/auth/otp/request`                | public     | `{ phoneNumber }` → `{ phoneNumber, expiresInSeconds, resendAfterSeconds, devCode? }`                               |
| POST   | `/auth/otp/verify`                 | public     | `{ phoneNumber, code, deviceId?, deviceFingerprint? }` → `{ tokens, user, isNewUser }`                              |
| POST   | `/auth/users/complete-profile`     | user       | `{ fullName, dateOfBirth: 'YYYY-MM-DD', languagePreference? }` → `UserProfile` (403 `AGE_RESTRICTED` if < 18)       |
| POST   | `/auth/advertiser/register`        | public     | `AdvertiserRegisterDto` → `{ tokens, advertiser }` (verificationStatus `pending`)                                   |
| POST   | `/auth/advertiser/login`           | public     | `{ email, password }` → `{ tokens, advertiser }`                                                                    |
| POST   | `/auth/admin/login`                | public     | `{ email, password }` → `{ tokens, admin }` (`admin.role`)                                                          |
| POST   | `/auth/refresh`                    | public     | `{ refreshToken }` → `AuthTokens`                                                                                   |
| POST   | `/auth/logout`                     | public     | `{ refreshToken }` → 204                                                                                            |
| POST   | `/auth/advertiser/change-password` | advertiser | `{ currentPassword, newPassword }` ? `{ changed, sessionsRevoked }` (all refresh tokens revoked; re-login required) |

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

## Ads (`/ads`, user token, verified adult)

| Method | Path                                 | Notes                                                                                                                                                                      |
| ------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/ads/feed?page&limit`               | `Paginated<AdFeedItem, AdFeedMeta>`; `meta.dailyRemaining`. Empty when cap reached or trust too low.                                                                       |
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
5. Completion is idempotent – on network errors retry the same call; `replayed: true` means it had already been processed.
6. If the app is killed mid-watch, discard the session locally (the server expires it); starting a new session for the same
   ad is allowed up to 3 times per day.

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

| Method | Path                  | Notes                                                                                                                                                                                                    |
| ------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/withdrawals/config` | `WithdrawalConfig` – `minWithdrawalEtb`, `coinsPerEtb`, `largeWithdrawalThresholdEtb`, `dailyRequestLimit`, `methods[] { method, label, destinationHint, destinationKind, available }`, `conversionNote` |
| POST   | `/withdrawals`        | `{ amountEtb, payoutMethod, payoutDestination, destinationName?, bankCode? }` → `WithdrawalItem`. Status `flagged_for_review` (first / large / low trust) or `pending`. Coins are held immediately.      |
| GET    | `/withdrawals?status` | `Paginated<WithdrawalItem>` (destination masked)                                                                                                                                                         |
| GET    | `/withdrawals/:id`    | `WithdrawalItem` – poll for `processing → completed                                                                                                                                                      | failed` (failed = coins refunded) |

Status meanings for the UI: `flagged_for_review` "under review by our team" (show `reviewReasons`), `pending` "queued",
`processing` "sending to <provider>", `completed`, `failed` (`failureReason`, coins returned), `rejected` (coins returned).

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
| POST     | `/campaigns`                       | `CreateCampaignDto` → `CampaignSummary` (draft). `rewardPerActionEtb`/`rewardCoins` are computed by the server.                                                          |
| GET      | `/campaigns/:id`                   | `CampaignDetail` (`ads[]`)                                                                                                                                               |
| PATCH    | `/campaigns/:id`                   | draft/rejected: any field; paused: budget increase (+dates/text) only                                                                                                    |
| DELETE   | `/campaigns/:id`                   | draft only → 204                                                                                                                                                         |
| POST     | `/campaigns/:id/submit`            | reserves the budget from the wallet → `pending_review` (`422 INSUFFICIENT_WALLET_BALANCE`, `403 ADVERTISER_NOT_VERIFIED`, `400 CAMPAIGN_HAS_NO_ADS` for video campaigns) |
| POST     | `/campaigns/:id/pause` / `resume`  | active ⇄ paused (resume refused while `pausedReason = admin_paused` or budget exhausted)                                                                                 |
| POST     | `/campaigns/uploads/presign`       | `{ fileName, contentType, sizeBytes }` → `{ method: 'PUT', uploadUrl, headers, storageKey, publicUrl, expiresInSeconds }`                                                |
| GET/POST | `/campaigns/:id/ads`               | list / add creative `CreateAdDto` (`storageKey` from presign or `mediaUrl`, `mediaType`, `durationSeconds`, `attentionQuestions?`)                                       |
| DELETE   | `/campaigns/:id/ads/:adId`         | non-approved creatives only                                                                                                                                              |
| GET      | `/campaigns/:id/analytics?from&to` | `CampaignAnalytics` – `totals` (rawViews, rawCompletions, valid/flagged/rejected, `fraudFilteredRate`, spend, remaining, uniqueUsers) + `daily[]`                        |

Upload flow: `presign` → `PUT uploadUrl` with the file and the returned `headers` → `POST /campaigns/:id/ads` with
`storageKey`. Limits: video mp4/webm ≤ 100 MB, image jpeg/png/webp ≤ 5 MB (`UPLOAD_LIMITS`).

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
| Home                     | `GET /admin/me` (role + permissions), `GET /admin/overview` (counters), `GET /admin/config` (effective platform config incl. `payoutMaxAttempts`, minimums and mock flags)                                                                                                                           | all admins                                                            |
| Ad review                | `GET /admin/ads/review-queue?status`, `GET /admin/ads/:id` (incl. `attentionQuestions` with `correctIndex`, `bannedTopics`), `POST /admin/ads/:id/approve { bannedTopicsChecklist: { checks: {alcohol: true, …}, notes? }, note? }`, `POST /admin/ads/:id/reject { reason, bannedTopicsChecklist? }` | ad_reviewer, super_admin (`GET :id` also support)                     |
| Campaign moderation      | `GET /admin/campaigns?status&advertiserId`, `GET /admin/campaigns/:id` (+analytics), `POST …/approve { note? }`, `…/reject { reason }`, `…/pause { reason }`, `…/resume`                                                                                                                             | ad_reviewer, super_admin (pause/resume + support; lists also finance) |
| Ad reports               | `GET /admin/ad-reports?status`, `POST /admin/ad-reports/:id/review { outcome, note?, rejectAd?, rejectionReason? }`                                                                                                                                                                                  | ad_reviewer, support, super_admin                                     |
| Users                    | `GET /admin/users?q&status&minTrustScore&maxTrustScore`, `GET /admin/users/:id` (stats, flags, ledger, withdrawals), `POST /admin/users/:id/suspend                                                                                                                                                  | ban                                                                   | reinstate { reason }` | support, super_admin (lists also finance) |
| Advertisers              | `GET /admin/advertisers?status&q`, `GET /admin/advertisers/:id`, `POST …/verify { note? }`, `POST …/reject { reason }`                                                                                                                                                                               | support, super_admin (lists: + finance, ad_reviewer)                  |
| Fraud dashboard          | `GET /admin/fraud/metrics`, `GET /admin/fraud/flags?severity&resolved&userId&flagType`, `GET /admin/fraud/flags/:id`, `POST …/dismiss { note? }`, `…/escalate { note? }`, `…/suspend-user { reason }`                                                                                                | support, finance, super_admin                                         |
| Withdrawal queue         | `GET /admin/withdrawals?status&userId`, `GET /admin/withdrawals/:id` (approvals, full destination), `POST …/approve { note? }`, `…/reject { reason }`, `…/retry`                                                                                                                                     | finance, super_admin                                                  |
| Coin adjustments         | `GET /admin/coin-adjustments?status&userId`, `POST /admin/coin-adjustments { userId, amount, reason, reference? }`, `GET …/:id`, `POST …/:id/approve { note? }` (different admin), `…/reject { reason }`, `…/cancel` (requester)                                                                     | finance, super_admin                                                  |
| Revenue                  | `GET /admin/revenue/overview?from&to` → `RevenueOverview` (totals, daily, byAdvertiser, byActionType)                                                                                                                                                                                                | finance, super_admin                                                  |
| Audit log                | `GET /admin/audit-log?actorId&actorType&action&targetType&targetId&q&from&to`                                                                                                                                                                                                                        | finance, support, super_admin                                         |
| App-install verification | `GET /admin/offers/app-install-completions?status`, `POST …/:id/verify { note? }`, `…/:id/reject { reason }`                                                                                                                                                                                         | support, super_admin                                                  |

Admin UI rules: large withdrawals (`requiresDualApproval`) show `approvalsCount/2` and must disable "Approve" for an admin
already listed in `approvals`; coin adjustments must disable "Approve" for `requestedBy === me`. Every decision needs a
reason where the API requires one (`REJECTION_REASON_REQUIRED`). Approving an ad requires **every** key of
`BANNED_TOPICS` set to `true` in `bannedTopicsChecklist.checks`.

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
