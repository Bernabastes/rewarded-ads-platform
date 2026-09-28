#!/usr/bin/env bash
# Backs up the Rewarded Ads Platform: PostgreSQL (pg_dump via the compose container) + MinIO bucket mirror.
#   scripts/backup.sh            # full backup into backups/<timestamp>/
#   SKIP_MEDIA=1 scripts/backup.sh
#   KEEP=30 scripts/backup.sh
# Restore drill: docs/RUNBOOK.md and scripts/restore.sh.
set -euo pipefail
cd "$(dirname "$0")/.."

env_value() { # name default
  local v
  v=$(grep -E "^\s*$1\s*=" .env 2>/dev/null | head -n1 | cut -d= -f2- | sed -E 's/\s+#.*$//' | xargs || true)
  echo "${v:-$2}"
}
PG_USER=$(env_value POSTGRES_USER rap)
PG_DB=$(env_value POSTGRES_DB rap)
S3_KEY=$(env_value S3_ACCESS_KEY minioadmin)
S3_SECRET=$(env_value S3_SECRET_KEY minioadmin)
BUCKET=$(env_value S3_BUCKET rap-media)
OUT_DIR=${OUT_DIR:-backups}
KEEP=${KEEP:-14}
STAMP=$(date +%Y%m%d-%H%M%S)
DEST="$OUT_DIR/$STAMP"
mkdir -p "$DEST"

echo "[backup] pg_dump $PG_DB -> $DEST/db.dump"
docker exec rap-postgres pg_dump -U "$PG_USER" -d "$PG_DB" -Fc --no-owner --no-acl -f /tmp/db.dump
docker cp rap-postgres:/tmp/db.dump "$DEST/db.dump"
docker exec rap-postgres rm -f /tmp/db.dump
docker exec rap-postgres psql -U "$PG_USER" -d "$PG_DB" -At -c \
  "SELECT 'users=' || COUNT(*) FROM users UNION ALL SELECT 'ledger=' || COUNT(*) FROM coin_ledger UNION ALL SELECT 'ledger_sum=' || COALESCE(SUM(amount),0) FROM coin_ledger" \
  > "$DEST/db.summary.txt"

if [ -z "${SKIP_MEDIA:-}" ]; then
  echo "[backup] mirroring s3://$BUCKET -> $DEST/media"
  mkdir -p "$DEST/media"
  NETWORK=$(docker inspect rap-minio --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}')
  docker run --rm --network "$NETWORK" -v "$(pwd)/$DEST/media:/backup" \
    -e MC_HOST_rap="http://$S3_KEY:$S3_SECRET@minio:9000" \
    quay.io/minio/mc:latest mirror --overwrite --quiet "rap/$BUCKET" /backup
fi

cat > "$DEST/manifest.json" <<EOF
{ "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)", "database": "$PG_DB", "bucket": "$BUCKET", "media": $([ -z "${SKIP_MEDIA:-}" ] && echo true || echo false), "gitCommit": "$(git rev-parse --short HEAD 2>/dev/null || echo unknown)" }
EOF

# retention: keep the newest $KEEP backups
ls -1d "$OUT_DIR"/*/ 2>/dev/null | sort -r | tail -n +$((KEEP + 1)) | while read -r old; do
  echo "[backup] pruning $old"; rm -rf "$old"
done
echo "[backup] done: $DEST"
cat "$DEST/db.summary.txt"
