#!/bin/sh
set -e

# Runs pending Prisma migrations (and optionally the demo seed) before starting the API.
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] applying database migrations..."
  ./node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma || ../../node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma
fi

if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "[entrypoint] seeding demo data..."
  node dist/prisma/seed.js 2>/dev/null || node -r ../../node_modules/ts-node/register/transpile-only prisma/seed.ts
fi

exec "$@"
