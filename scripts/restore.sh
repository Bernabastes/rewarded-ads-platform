#!/usr/bin/env bash
# Restores a backup produced by scripts/backup.sh (PostgreSQL dump + MinIO bucket mirror). DESTRUCTIVE.
#   scripts/restore.sh backups/20260928-120000
#   SKIP_MEDIA=1 scripts/restore.sh backups/20260928-120000
#   FORCE=1 scripts/restore.sh backups/20260928-120000     # no confirmation prompt
# Drill checklist: docs/RUNBOOK.md "Restore drill".
set -euo pipefail
cd "$(dirname "$0")/.."
BACKUP=${1:?usage: restore.sh <backup dir>}
[ -f "$BACKUP/db.dump" ] || { echo "No db.dump in $BACKUP"; exit 1; }

env_value() { local v; v=$(grep -E "^\s*$1\s*=" .env 2>/dev/null | head -n1 | cut -d= -f2- | sed -E 's/\s+#.*$//' | xargs || true); echo "${v:-$2}"; }
PG_USER=$(env_value POSTGRES_USER rap)
PG_DB=$(env_value POSTGRES_DB rap)
S3_KEY=$(env_value S3_ACCESS_KEY minioadmin)
S3_SECRET=$(env_value S3_SECRET_KEY minioadmin)
BUCKET=$(env_value S3_BUCKET rap-media)
API_PORT=$(env_value API_PORT 3000)

if [ -z "${FORCE:-}" ]; then
  read -r -p "This REPLACES database '$PG_DB' (and bucket '$BUCKET' unless SKIP_MEDIA) with $BACKUP. Type RESTORE to continue: " answer
  [ "$answer" = "RESTORE" ] || { echo aborted; exit 1; }
fi

echo "[restore] stopping the API so nothing writes during the restore"
docker compose stop api >/dev/null

echo "[restore] pg_restore -> $PG_DB"
docker cp "$BACKUP/db.dump" rap-postgres:/tmp/restore.dump
docker exec rap-postgres psql -U "$PG_USER" -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$PG_DB' AND pid <> pg_backend_pid();" >/dev/null
docker exec rap-postgres pg_restore -U "$PG_USER" -d "$PG_DB" --clean --if-exists --no-owner --no-acl --exit-on-error /tmp/restore.dump
docker exec rap-postgres rm -f /tmp/restore.dump

echo "[restore] applying any migrations newer than the dump"
docker compose run --rm --no-deps --entrypoint sh api -c '/repo/node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma'

if [ -z "${SKIP_MEDIA:-}" ] && [ -d "$BACKUP/media" ]; then
  echo "[restore] mirroring media -> s3://$BUCKET"
  NETWORK=$(docker inspect rap-minio --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}')
  docker run --rm --network "$NETWORK" -v "$(cd "$BACKUP/media" && pwd):/backup" \
    -e MC_HOST_rap="http://$S3_KEY:$S3_SECRET@minio:9000" \
    quay.io/minio/mc:latest mirror --overwrite --quiet /backup "rap/$BUCKET"
fi

echo "[restore] starting the API"
docker compose start api >/dev/null
sleep 8
echo "[restore] verification:"
docker exec rap-postgres psql -U "$PG_USER" -d "$PG_DB" -At -c \
  "SELECT 'users=' || COUNT(*) FROM users UNION ALL SELECT 'ledger=' || COUNT(*) FROM coin_ledger UNION ALL SELECT 'ledger_sum=' || COALESCE(SUM(amount),0) FROM coin_ledger UNION ALL SELECT 'drift_users=' || COUNT(*) FROM users u WHERE u.coin_balance <> (SELECT COALESCE(SUM(amount),0) FROM coin_ledger l WHERE l.user_id = u.id)"
echo "--- expected (from the backup):"; cat "$BACKUP/db.summary.txt"
curl -fsS "http://localhost:$API_PORT/health/ready" || echo "API not ready yet"
