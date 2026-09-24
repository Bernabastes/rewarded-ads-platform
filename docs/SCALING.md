# Scaling notes

The MVP runs as a single Docker Compose stack (API + PostgreSQL + Redis + MinIO). Nothing in the design needs a
rewrite to reach tens of thousands of users; the pieces below change _where_ things run, not _how_.

## What already scales

- **Stateless API**: no in-process state; sessions are JWTs; rate limits and velocity counters live in Redis. Any
  number of API replicas can sit behind a load balancer.
- **Per-user serialisation, not global locks**: the ledger locks one `users` row per write; completions claim one
  watch-session row. Throughput scales with the number of users, not with total traffic.
- **Idempotency everywhere**: completions, ledger writes, webhooks and payouts are safe to retry, so at-least-once
  delivery from queues/load balancers is fine.
- **Workers are separable today**: `QUEUES_ENABLED=false` on API replicas; run the same image with
  `QUEUES_ENABLED=true` (and no public port) as the worker deployment. Payouts, notifications, reconciliation and fraud
  jobs already run through BullMQ.
- **Media never flows through the API**: presigned uploads to object storage (signed for the public S3_PUBLIC_ENDPOINT), public read via a CDN-able URL.
- **Frontends are static**: the advertiser portal and admin dashboard are nginx-served Vite builds (docker compose services) that can move to any CDN/object-storage hosting; the mobile app talks to the API only.

## Growth path

| Concern           | MVP                              | Next step                                                                                                                                                                                                                                   |
| ----------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database          | single Postgres container        | Managed PostgreSQL (e.g. RDS/Cloud SQL/Neon) with automated backups + PITR; PgBouncer in transaction mode; read replica for admin analytics/revenue queries (`AdminReportsService`, campaign analytics) via a second Prisma datasource.     |
| Hot tables        | indexes on user/campaign/date    | Partition `ad_completions`, `ad_watch_sessions`, `coin_ledger`, `audit_log` by month; archive old partitions to cold storage.                                                                                                               |
| Redis             | single container                 | Managed Redis with persistence (BullMQ needs it), separate logical DBs or instances for rate-limit counters vs queues.                                                                                                                      |
| API               | 1 process                        | N replicas behind an L7 load balancer/API gateway (TLS, WAF, edge rate limiting); horizontal pod autoscaling on CPU/RPS.                                                                                                                    |
| Workers           | in the API process               | Dedicated worker deployment(s) per queue with independent concurrency; payouts low concurrency, notifications high.                                                                                                                         |
| Fraud scoring     | synchronous rules in the request | Keep the cheap synchronous gate (hard verification), move heavy scoring (graph analysis, ML) to the `fraud` queue: completion → `flagged_pending_score` → async score → credit/reject. Feature store in Redis; batch jobs in the warehouse. |
| Media             | MinIO                            | S3/GCS + CDN (CloudFront/Cloudflare) with HLS transcoding pipeline (duration probe removes the advertiser-declared duration trust gap).                                                                                                     |
| Analytics         | SQL aggregates on OLTP           | Nightly/continuous export to a warehouse (BigQuery/ClickHouse) for revenue and campaign dashboards; keep OLTP queries for "today".                                                                                                          |
| Notifications     | FCM per token in worker          | FCM topics/batching (500 tokens per request), retry with backoff, token hygiene job.                                                                                                                                                        |
| Observability     | pino JSON + security channel     | OpenTelemetry traces (Nest 12 `@nestjs/observe` or OTEL SDK), Prometheus metrics (completions/min, flagged rate, queue depth, payout failures), SIEM ingestion of `channel=security`.                                                       |
| Multi-region / DR | single VM                        | Active/passive region with replicated Postgres; Redis is rebuildable (rate limits) except queue state – use replicated managed Redis.                                                                                                       |

## Capacity sketch

At 50 000 daily active users × 15 completions = 750 000 completions/day ≈ 9 writes/second average, ~50/second at
evening peak. Each completion is one short transaction (~6 statements) plus a few reads: a single modest Postgres
instance handles this with headroom; the feed query is the heaviest read and is index-friendly (approved ads × active
campaigns is a small set; the `NOT EXISTS` uses `ad_completions(user_id, ad_id)`).

## Operational runbook pointers

- Migrations: `prisma migrate deploy` in CI before rolling out API/worker images.
- Zero-downtime deploys: API replicas drain (`enableShutdownHooks`), BullMQ workers finish in-flight jobs on SIGTERM.
- Reconciliation alerts (`LEDGER_DRIFT` critical flags) are the canary for data-integrity incidents; investigate before
  approving withdrawals for affected users.
