# @rap/mobile — User mobile app (Phase 2)

**Status: stub.** This folder is reserved for the Phase 2 mobile session. Only this folder (and the root
`pnpm-lock.yaml`) may be modified by that session.

## Planned stack

- Expo (React Native, managed workflow, Expo Router), TypeScript strict
- State: Zustand (+ TanStack Query for server state is recommended)
- i18n: `i18next` + `react-i18next`, **Amharic (`am`) default**, English secondary, `om`/`ti` ready
  (fonts must render Ethiopic — e.g. Noto Sans Ethiopic)
- Animation: `react-native-reanimated` (coin-earned animation: subtle, never slot-machine-like)
- Video: `expo-video` / `expo-av`
- Secure storage for tokens: `expo-secure-store`
- Device fingerprint: stable hash from `expo-application` / `expo-device` values + installation id

## Consuming the API

- Base URL: `http://<host>:3000/api/v1` (`API_BASE_PATH` from `@rap/shared`).
- Import the contract: `import { API_ROUTES, ErrorCode, PLATFORM_DEFAULTS, type AdFeedItem } from '@rap/shared'`.
  The root `pnpm install` builds `@rap/shared`; `pnpm-workspace.yaml` already uses `nodeLinker: hoisted`
  (flat node_modules) which Metro requires.
- Auth flow: `POST /auth/otp/request` → `POST /auth/otp/verify` (tokens + `isNewUser`) →
  if `user.profileComplete === false`: `POST /auth/users/complete-profile` (server computes age; `403 AGE_RESTRICTED`
  must show a respectful blocking screen) → feed.
- Refresh: `POST /auth/refresh` with the rotating refresh token on `401 TOKEN_EXPIRED`.
- Every ad watch: `POST /ads/:id/watch-sessions` (send `deviceFingerprint`) → heartbeat every
  `heartbeatIntervalSeconds` → `POST /ads/watch-sessions/:sid/complete` (with `attentionAnswerIndex` when a question
  was returned). Never trust a client-side "finished" event; render the server `status`.
- Never compute the balance locally — always re-fetch `GET /users/me/balance`.
- Full endpoint guide: `docs/API.md`; machine-readable spec: `docs/openapi.json`; Swagger UI at `/api/docs`.

## Demo data

Seeded demo users (OTP is echoed in the API response when `OTP_DEV_ECHO=true`): see root `README.md`.
