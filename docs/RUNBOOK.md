# Operations runbook

Day-2 operations for the Rewarded Ads Platform ("Gize"). Companion to `docs/ARCHITECTURE.md` (why) and
`docs/SCALING.md` (later). Everything here works against the docker compose stack; the same commands apply to a
single-VM deployment of the same images.

## 1. Daily / weekly checks

| When   | Check                                                                                        | Where                                                               |
| ------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Daily  | Open alerts (ledger drift, payout failure rate, account minting, spend velocity, OTP spikes) | Admin → Alerts (`GET /admin/alerts?acknowledged=false`)             |
| Daily  | Withdrawal queue (held first/large withdrawals), failed payouts to retry                     | Admin → Withdrawals                                                 |
| Daily  | KYC queue                                                                                    | Admin → KYC (`GET /admin/kyc`)                                      |
| Daily  | Ledger reconciliation ran and reported 0 drift                                               | `ledger_reconciliation_runs` (hourly job); LEDGER_DRIFT alert       |
| Weekly | Fraud dashboard: flagged rate, open high/critical flags                                      | Admin → Fraud                                                       |
| Weekly | Backups exist and the newest one restores (see §3 drill)                                     | `backups/`                                                          |
| Weekly | Pending account-deletion requests about to execute; blocked ones (in-flight withdrawals)     | Admin → Deletion requests                                           |
| Weekly | Media pipeline failures (`ads.media_status = 'failed'`) → reprocess or ask for re-upload     | Admin → Ad review (media status badge, "reprocess media")           |

Security log channel (`channel=security`, `SECURITY_LOG_PATH`) is the audit-grade stream: ship it to your SIEM.

## 2. Backups

`scripts/backup.ps1` (Windows) / `scripts/backup.sh` (Linux/macOS) write `backups/<timestamp>/`:

```
db.dump          pg_dump custom format (compressed) of the whole database, via `docker exec rap-postgres`
db.summary.txt   users / ledger rows / ledger sum at backup time (used to verify a restore)
media/           mirror of the S3 bucket (creatives, transcodes, posters, private KYC docs, data exports) via minio/mc
manifest.json    timestamp, bucket, git commit
```

```powershell
pwsh scripts/backup.ps1               # database + media, keeps the newest 14
pwsh scripts/backup.ps1 -SkipMedia    # database only (fast; media can be re-mirrored from the bucket)
```

Schedule it (Task Scheduler / cron) at least daily; copy `backups/` off the host (object storage in another region).
The database is the source of truth for money: the coin ledger and the advertiser wallet ledger are append-only, so a
restore can never "lose" a credit silently — the reconciliation job flags any drift after a restore.

Production note: replace this with managed PostgreSQL PITR + bucket versioning/replication (see `SCALING.md`), and
keep these scripts for ad-hoc snapshots before risky migrations.

## 3. Restore drill (run monthly; ~10 minutes)

Goal: prove a backup restores into a working stack and the money identities hold.

1. Take a fresh backup of the current state so the drill is reversible: `pwsh scripts/backup.ps1`.
2. Note the expected figures: `Get-Content backups/<latest>/db.summary.txt`.
3. Restore an OLDER backup (destructive, stops the API while restoring):
   `pwsh scripts/restore.ps1 -Backup backups/<older>` → type `RESTORE`.
   The script: stops `rap-api` → `pg_restore --clean --if-exists` → `prisma migrate deploy` (applies migrations newer
   than the dump) → mirrors `media/` back into the bucket → starts the API → prints users / ledger rows / ledger sum /
   `drift_users` and `GET /health/ready`.
4. Verify:
   - `drift_users=0` (cached balances equal the ledger sums);
   - the printed counts match that backup's `db.summary.txt`;
   - log in to the admin dashboard, open a user, play a seeded ad in the portal preview (media restored);
   - `POST /admin/alerts/run-rules` (super_admin) runs cleanly.
5. Restore the fresh backup from step 1 the same way, verify again, and record the drill (date, backup id, duration,
   anomalies) in your ops log.

If `pg_restore` fails on a constraint, the dump predates a migration that added it: restore into an empty database
(`docker compose down -v postgres` for a throwaway environment) and let `migrate deploy` bring it forward.

## 4. Jobs (BullMQ) and what to do when they stop

| Queue            | Job                                  | Schedule / trigger              | Symptom when broken                                 |
| ---------------- | ------------------------------------ | ------------------------------- | --------------------------------------------------- |
| `payouts`        | initiate + poll partner status       | on withdrawal release           | withdrawals stuck in `pending`/`processing`         |
| `reconciliation` | ledger vs cached balance             | `RECONCILIATION_CRON` (hourly)  | no new `ledger_reconciliation_runs` rows            |
| `alerts`         | rule evaluation                      | `ALERT_RULES_CRON` (5 min)      | no alerts although payouts fail                     |
| `media`          | probe + transcode + poster           | on creative upload / reprocess  | ads stuck in `processing` (approval refused)        |
| `data-rights`    | data exports, due deletions, cleanup | on request / `DATA_RIGHTS_CRON` | exports stuck `pending`; deletions not executed     |
| `notifications`  | push delivery                        | on notification                 | `push_status = pending` piling up                   |

Workers run inside the API process when `QUEUES_ENABLED=true` (compose default). Redis down ⇒ jobs queue up in memory
until reconnect; a restart of `rap-api` re-registers the repeatable schedulers (`upsertJobScheduler`, idempotent).
Manual triggers: `POST /admin/alerts/run-rules`, `POST /admin/ads/:id/reprocess-media`, `POST /admin/deletion-requests/:id/execute`.

## 5. Common incidents

**Payout partner outage** — `PAYOUT_FAILURE_RATE` alert. The registry fails over telebirr → Chapa automatically; a
withdrawal that failed on both is `failed` with the coins refunded (reversing ledger entry). Retry from Admin →
Withdrawals once the partner recovers (`POST /admin/withdrawals/:id/retry`, max `PAYOUT_MAX_ATTEMPTS`).

**LEDGER_DRIFT alert** — never edit `users.coin_balance`. Inspect the user's ledger (`GET /admin/users/:id`); repair
through the ledger path (`reconciliation` source type) and open a fraud investigation; the append-only triggers make
tampering visible.

**Account minting / OTP spike** — check the fingerprint/IP in Admin → Fraud, suspend the accounts (sessions and access
tokens die immediately via the Redis denylist), consider lowering `OTP_RATE_LIMIT_PER_IP_PER_HOUR` at the edge.

**Creative stuck in `processing`** — the media job runs one at a time with a `MEDIA_JOB_TIMEOUT_SECONDS` time-box.
Check `rap-api` logs for `media.processing_failed`; `reprocess-media` re-queues. In containers ffmpeg comes from
`apk add ffmpeg` (`MEDIA_FF*_PATH`); on developer machines run `pnpm media:tools` once.

**User locked out after suspension is lifted** — reinstate revokes nothing further; the user simply logs in again
(old access tokens were denylisted at suspension time, refresh tokens revoked).

**Support needs to "see what the user sees"** — `POST /admin/users/:id/impersonate` (support/super_admin, reason
required) returns a 10-minute read-only token; paste it into the mobile web build or call the API. Every read is
audited (`impersonation.read`); any write attempt is refused and audited (`impersonation.write_blocked`).

## 6. Data-subject requests

- Export: the user taps Profile → Privacy → "Download my data" (`POST /users/me/data-export`); the job writes a gzipped
  JSON archive under `private/exports/` and notifies with a presigned link (`DATA_EXPORT_URL_TTL_SECONDS`); archives are
  deleted after `DATA_EXPORT_RETENTION_DAYS`.
- Deletion: `POST /users/me/delete-request` → executed after `ACCOUNT_DELETION_GRACE_DAYS` by the hourly job (or
  immediately by support via `POST /admin/deletion-requests/:id/execute`). Blocked while withdrawals are in flight.
  Execution anonymises the user row (phone → `deleted:<id>`, name/DOB/device/IP removed), deletes push tokens,
  notifications, payout destinations and KYC documents, revokes sessions — and **retains** the coin ledger, ad
  completions, withdrawals (destination anonymised) and audit rows as financial records that no longer identify a
  person. Document your legal basis for the retention period.

## 7. Secrets and configuration changes

All configuration is environment-only (`.env.example` documents every variable). After changing `.env`:
`docker compose up -d api` (recreates the container). Rotating `JWT_ACCESS_SECRET` logs everyone out (access tokens
fail verification; refresh tokens still rotate into new access tokens, so users reconnect transparently within 15
minutes). Rotating `S3_*` credentials requires updating MinIO/S3 first, then the API.
