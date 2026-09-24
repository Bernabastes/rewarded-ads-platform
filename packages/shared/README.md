# @rap/shared

Shared contract package consumed by the API and all three frontends.

- `enums` – string enums mirroring the Prisma schema (`UserStatus`, `WithdrawalStatus`, …)
- `ErrorCode` – stable machine-readable error codes returned in the API error envelope
- `PLATFORM_DEFAULTS`, `BANNED_TOPICS`, `UPLOAD_LIMITS`, … – platform constants (server values win)
- `etbToCoins`, `coinsToEtb`, `computeRewardEtb`, `calculateAge`, `normalizeEthiopianPhone` – money/age helpers
- `API_BASE_PATH`, `API_ROUTES` – route constants
- `types/*` – request DTOs and response shapes for every endpoint

Built with tsup to CJS (`dist/index.js`, used by Node/Metro) and ESM (`dist/index.mjs`, used by Vite).
`pnpm install` at the repo root builds it automatically (root `postinstall`); run `pnpm --filter @rap/shared build`
after editing sources.

```ts
import { API_ROUTES, ErrorCode, etbToCoins, type UserProfile } from '@rap/shared';
```
