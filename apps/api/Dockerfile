# A full hoisted workspace install would pull Expo / React Native / Vite for the other apps (~2 GB image).
# syntax=docker/dockerfile:1.7
# Multi-stage build for the API. Build context = repository root (needs the shared package).

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
# The lockfile is vetted on developer machines (pnpm minimumReleaseAge policy); skip the per-package metadata
# re-check inside the image build, and keep the pnpm store in a BuildKit cache so rebuilds do not re-download.
ENV npm_config_store_dir=/pnpm/store
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate
WORKDIR /repo

# ---- install ONLY the API + shared dependency subset (cached by lockfile) ----
# A full hoisted workspace install would pull Expo / React Native / Vite for the other apps (~2 GB image).
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
RUN printf '\nminimumReleaseAge: 0\n' >> pnpm-workspace.yaml
COPY scripts ./scripts
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/mobile/package.json ./apps/mobile/
COPY apps/advertiser-web/package.json ./apps/advertiser-web/
COPY apps/admin-web/package.json ./apps/admin-web/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --ignore-scripts --filter @rap/api... --filter @rap/shared...

# ---- build shared + api ----
FROM deps AS build
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN node scripts/build-shared.mjs \
 && cd apps/api \
 && pnpm exec prisma generate \
 && pnpm exec nest build

# ---- runtime ----
FROM base AS runtime
ENV NODE_ENV=production
# ffmpeg/ffprobe for the media.process pipeline (probe + 720p transcode + poster); the npm *-static packages are
# glibc builds and do not run on Alpine, so the runtime points MEDIA_FF*_PATH at the apk binaries.
RUN apk add --no-cache wget ffmpeg
ENV MEDIA_FFMPEG_PATH=/usr/bin/ffmpeg MEDIA_FFPROBE_PATH=/usr/bin/ffprobe
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/apps/api/tsconfig.json ./apps/api/tsconfig.json
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build /repo/apps/api/node_modules ./apps/api/node_modules
COPY apps/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh && chmod +x /usr/local/bin/docker-entrypoint.sh
WORKDIR /repo/apps/api
# Security audit #16: never run the API as root (the image only needs to read its own files and write /tmp).
USER node
EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]