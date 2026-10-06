# Security assessment summary – Gize Rewarded Advertising Platform

**Audience:** CISO / executive sponsor · **Date:** 2026-10-06 · **Status:** remediation programme complete,
**Conditional GO** from the third independent verifier (conditions closed in Phase 5c) · **Owner:** platform team

This is the one-page view of the whole security programme. Engineering detail (threat model, controls, every finding
with commit and regression test) is in [`SECURITY.md`](SECURITY.md); operational hardening is checked off in its §4.

## 1. Scope

| In scope | Out of scope (see residual risk) |
| --- | --- |
| NestJS API (`apps/api`): authentication (OTP, password, TOTP), the coin ledger and advertiser wallet, ad-completion verification and fraud engine, withdrawals and payout partners, campaign budget lifecycle, KYC and data rights, admin RBAC and dual approval, webhooks, media ingestion | Native mobile binaries (iOS / Android builds – only the Expo web build and the API contract were exercised) |
| Infrastructure as shipped: `docker-compose.yml`, nginx SPA images, MinIO bucket policy, Redis / Postgres exposure, image provenance | Edge / CDN / WAF configuration of the eventual hosting provider (HSTS, DDoS, geo-blocking) |
| The two web consoles' token handling, CSP and CSRF posture | Payout partner systems themselves (telebirr, Chapa) and the SMS / id-verification gateways |
| Seed data, demo credentials and production boot gates | Physical / people / vendor-management controls |

## 2. Methodology

Three independent reviews plus two live penetration-test rounds, each followed by remediation with
fail-before / pass-after regression tests and a re-verification:

| Round | Type | Output |
| --- | --- | --- |
| Audit 1 (2026-09-30) | Read-only code audit of the API with file:line evidence | 17 findings: 1 CRITICAL, 3 HIGH, 8 MEDIUM, 5 LOW |
| Pentest 1 (2026-09-30) | Live, authenticated black/grey-box test of the local stack – money races, replay, authorisation, tenancy, webhooks, SSRF; **324 sanitised request/response probes** (`live-pentest.mjs`, `round2-pentest.mjs`) | 1 EXPLOITABLE (D2 SSRF), 1 SUSPICIOUS (A3a attention-check guessing), 13 BLOCKED, 2 N/A |
| Remediation Phase 5 | 17 findings + A3a + D2 fixed, one commit each (`docs/SECURITY.md` §3) | pentest re-run **16 / 16 BLOCKED** (150 probes) |
| Audit 2 (second opinion) | Independent re-read of every Phase 5 fix and test | 16 / 19 confirmed FIXED; #1 and #14 partial → New-1 (HIGH) … New-9 |
| Remediation Phase 5b | New-1 … New-9 + lockout-DoS note fixed, concurrency regression for the budget race | §3b of `SECURITY.md` |
| Audit 3 (third verifier) | Review of the Phase 5b diff | **Conditional GO**: New-1 … New-9 CLOSED; New-10 (MEDIUM) + 6 residuals |
| Remediation Phase 5c | New-10 + residuals fixed; final pentest re-run with a New-10 probe | **17 / 17 BLOCKED** (167 probes) – §3c |

Totals: **3 code audits, 2 pentest rounds + 2 full re-runs, 641 live probes, 28 tracked findings, 0 open.**
Every fix carries an automated regression test (API: 414 unit + 8 database-backed e2e tests; 1 e2e test replays the
critical budget race 20 times).

## 3. Findings by severity and status

| Severity | Count | Examples | Status |
| --- | --- | --- | --- |
| CRITICAL | 1 | #1 campaign budget reservation replay (advertiser could run a 10 M ETB campaign for 500 ETB) – re-opened once as a race (New-1) and closed with row locks, pinned claims, a spend cap at the reservation and an approval / resume funding gate | **Closed** (`b9e1c28`, `b06e231`, `6546edc`) |
| HIGH | 4 | #2 SSRF via creative URL (exploited live), #3 trusted `X-Forwarded-For`, #4 OTP brute force, #5 no login throttling / admin MFA | **Closed** |
| MEDIUM | 10 | #6–#12 (reversal key collision, ambiguous payout outcomes, production gates, OTP logging, open bucket / data stores, destination lookup oracle, withdrawal TOCTOU), New-2 payout "not found" semantics, New-10 TOTP guessing with a stolen password | **Closed** |
| LOW / INFO | 13 | #13–#17, New-3 … New-9 residuals (CSRF in cookie mode, MFA key fallback, unauthenticated Redis, flagged-completion charging, MFA throttling, deletion scrub residue, stray file), New-5 fail-open signal | **Closed** |

What "closed" means here: the code path is changed, a regression test fails on the old code and passes on the new,
the live probe (where one exists) is BLOCKED on the rebuilt stack, and the change is documented for the client teams.

## 4. Controls now in place (summary)

- **Money:** single ledger write path with DB-level append-only triggers; every money gate (completion, withdrawal,
  campaign budget edit / submit / approve / resume, payment settlement) runs under a row lock with guarded atomic
  claims; a campaign can never pay beyond what the advertiser's wallet actually reserved; dual approval for large
  payouts and manual coin adjustments; idempotency keys on every money POST.
- **Payouts:** partner calls are time-boxed and classified; only a partner's documented "order not found" (on its
  documented HTTP statuses) ever counts as "never sent", and `PAYOUT_LOOKUP_STRICT` (production default) parks even
  those for a human until the contracts are confirmed; interrupted payouts resume via partner lookup; stuck payouts
  are parked and alerted – **nothing is ever auto-refunded while money may be in flight**.
- **Identity:** OTP verification is throttled, atomically counted, constant-time and burned; password logins are
  throttled per IP and per account with a per-account+IP lockout; admin TOTP MFA with encrypted secrets, password
  re-authentication for enrolment, replay guard and an account-wide failure cap; roles are read from the database on
  every request; refresh tokens rotate with reuse detection; browsers hold them in httpOnly cookies selected by a
  custom header only, JSON-only, origin-checked.
- **Data:** identity numbers are keyed HMACs; bucket policy denies `private/*`; account deletion scrubs every
  PII-bearing table while keeping financial facts; Redis is authenticated and network-isolated; security controls that
  depend on Redis fail closed in production.
- **Boot gates:** a production process refuses to start with mock payment / payout / SMS providers, default
  credentials, wildcard CORS, weak or shared keys, debug switches or Swagger enabled.

## 5. Residual-risk register

| # | Residual risk | Likelihood / impact | Mitigation in place | Owner / due |
| --- | --- | --- | --- | --- |
| R1 | **Payout partner endpoints and "not found" semantics unconfirmed** (telebirr outTradeNo query and codes; Chapa transfer verify reply) – implemented from public guides | Medium / High (double payout or refund-while-in-flight if a partner's answer means something else) | `PAYOUT_LOOKUP_STRICT=true` parks every not-found for a human; `needs_manual_review` queue + alerts; mock mode answers the safe branch | Finance + partner integration; before first real payout |
| R2 | **HSTS / TLS termination at the edge** not part of the repo (compose serves plain HTTP locally) | Low / Medium | `Secure` cookies, CSP, `X-Frame-Options`, nosniff shipped by the SPA images; `TRUST_PROXY_HOPS` documented | Platform ops; at deployment |
| R3 | **`style-src 'unsafe-inline'` in the console CSP** (required by the UI libraries' inline styles) | Low / Low (`script-src` is strict; no inline scripts) | nonce-based styles tracked as a UI-library upgrade | Frontend; next UI dependency bump |
| R4 | **Capacity-protecting limits fail open** when Redis is unavailable (OTP *request* limits, fraud velocity counters in open mode) – by design, so an outage degrades to "slower fraud detection", not "no logins" | Low / Low | security-identity controls fail closed in production; DB counts remain authoritative for fraud; every fail-open logs `auth.denylist_unavailable` | Accepted |
| R5 | **Native mobile binaries not pentested** (jailbreak / root detection, certificate pinning, secure storage on device) | Medium / Medium | all money decisions are server-side; refresh tokens in Keychain / Keystore; attention checks and timing enforced server-side | Mobile; before store release |
| R6 | **No third-party / external penetration test yet** – all reviews were internal (AI-assisted) and local | Medium / High (unknown unknowns) | 641-probe script and all evidence retained for the external tester; staging mirrors compose | Security; before public launch |
| R7 | Legacy sha256 KYC hashes (pre-#14) do not match HMAC ones | Low / Low | demo data reseeded; offline re-hash procedure documented for a real database | Data; before KYC go-live |
| R8 | Seeded demo admins / advertisers with known passwords | High if left / High | seed refuses to run in production; checklist requires deleting seeded accounts and creating admins via `POST /admin/admins` | Ops; at go-live |

## 6. Go-live preconditions

1. All "Enforced at boot" items in `SECURITY.md` §4 satisfied (the API will not start otherwise): dedicated
   `JWT_ACCESS_SECRET`, `KYC_HASH_KEY`, `MFA_ENCRYPTION_KEY`; real Chapa / telebirr / SMS credentials; non-default
   storage credentials; explicit CORS origins; authenticated Redis; Swagger and debug switches off.
2. **Partner confirmation (R1):** written confirmation of telebirr's and Chapa's transfer-lookup contracts; keep
   `PAYOUT_LOOKUP_STRICT=true` until then; a staging run with real 1 ETB payouts including a forced timeout that lands
   in *Needs manual review*.
3. `ADMIN_MFA_REQUIRED=true`; seeded accounts deleted; real admins created through the admin-management API;
   `ADMIN_MFA_BRUTE_FORCE`, `PAYOUT_STUCK_PROCESSING`, `LEDGER_DRIFT` and `PAYOUT_FAILURE_RATE` alerts routed to
   an on-call rota.
4. Edge: TLS with HSTS, `TRUST_PROXY_HOPS` set to the real proxy depth, WAF / rate limiting in front of the API,
   data stores unreachable from the internet (R2).
5. **External penetration test (R6)** against staging, scoped to this document, with the retained probe scripts as
   a starting point; findings triaged through the same fix-with-regression-test process.
6. Operations: backups + restore drill passed, `scripts/audit-reservations.mjs` scheduled weekly with 0
   discrepancies, `needs_manual_review` reviewed daily, security log stream shipped to a SIEM.
7. Legal sign-off on the seeded terms / privacy texts and the retention basis for anonymised financial records.

## 7. Evidence trail

- Audit reports and sanitised pentest evidence: session artefacts `files/security/` (`api-audit.md`,
  `live-pentest.md`, `pentest/evidence.json`, `live-pentest-rerun.md`, re-run console logs).
- Fix commits: `git log --grep "security"` on `main`; one commit per finding with the test named in `SECURITY.md`.
- Live verification per release: `pnpm test` (787 unit tests across workspaces: shared 12, API 414, mobile 145, advertiser 106, admin 110), API e2e (8, DB-backed), `pnpm smoke`,
  `scripts/demo-flow.mjs`, `scripts/audit-reservations.mjs`, `live-pentest.mjs`.

Responsible disclosure: see `SECURITY.md` §5 (contact placeholder to be set before launch).
