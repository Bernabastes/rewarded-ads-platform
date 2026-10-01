# syntax=docker/dockerfile:1.7
# Static build of the admin dashboard served by nginx. Build context = repository root.
#   docker build -f apps/admin-web/Dockerfile --build-arg VITE_API_URL=http://localhost:3000 .

FROM node:24-alpine AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
# The lockfile is vetted on developer machines (pnpm minimumReleaseAge policy); skip the per-package metadata
# re-check inside the image build, and keep the pnpm store in a BuildKit cache so rebuilds do not re-download.
ENV npm_config_store_dir=/pnpm/store
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
RUN printf '\nminimumReleaseAge: 0\n' >> pnpm-workspace.yaml
COPY scripts ./scripts
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/mobile/package.json ./apps/mobile/
COPY apps/advertiser-web/package.json ./apps/advertiser-web/
COPY apps/admin-web/package.json ./apps/admin-web/
# Only this app's dependency subset (the hoisted workspace install of everything - Expo, RN... - is 2 GB).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts --filter @rap/admin-web... --filter @rap/shared...
COPY packages/shared ./packages/shared
COPY apps/admin-web ./apps/admin-web
ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=$VITE_API_URL
RUN node scripts/build-shared.mjs && cd apps/admin-web && pnpm exec vite build

FROM nginx:1.27-alpine AS runtime
# Security audit #16: rendered by the image's envsubst at start-up (CSP needs the API / media origins).
COPY docker/nginx-spa.conf.template /etc/nginx/templates/default.conf.template
ENV API_PUBLIC_URL=http://localhost:3000 S3_PUBLIC_URL=http://localhost:9000 S3_PUBLIC_ENDPOINT=http://localhost:9000
COPY --from=build /repo/apps/admin-web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s CMD wget -q --spider http://127.0.0.1/ || exit 1
