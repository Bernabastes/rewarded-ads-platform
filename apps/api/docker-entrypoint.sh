#!/bin/sh
set -e

# Runs pending Prisma migrations (and optionally the demo seed) before starting the API.
# Layout inside the image: /repo/node_modules (hoisted), /repo/apps/api (cwd).
PRISMA=/repo/node_modules/.bin/prisma
TSNODE=/repo/node_modules/.bin/ts-node

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] applying database migrations..."
  "$PRISMA" migrate deploy --schema prisma/schema.prisma
fi

if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "[entrypoint] seeding demo data (this resets existing data)..."
  "$TSNODE" --transpile-only prisma/seed.ts
fi

exec "$@"