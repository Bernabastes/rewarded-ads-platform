# syntax=docker/dockerfile:1.7
# Static build of the advertiser portal served by nginx. Build context = repository root.
#   docker build -f apps/advertiser-web/Dockerfile --build-arg VITE_API_URL=http://localhost:3000 .

FROM node:24-alpine AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY scripts ./scripts
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/mobile/package.json ./apps/mobile/
COPY apps/advertiser-web/package.json ./apps/advertiser-web/
COPY apps/admin-web/package.json ./apps/admin-web/
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY packages/shared ./packages/shared
COPY apps/advertiser-web ./apps/advertiser-web
ARG VITE_API_URL=http://localhost:3000
ARG VITE_PUBLIC_URL=http://localhost:5173
ENV VITE_API_URL=$VITE_API_URL VITE_PUBLIC_URL=$VITE_PUBLIC_URL
RUN node scripts/build-shared.mjs && cd apps/advertiser-web && pnpm exec vite build

FROM nginx:1.27-alpine AS runtime
COPY docker/nginx-spa.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/advertiser-web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://localhost/ >/dev/null || exit 1
