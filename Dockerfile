# syntax=docker/dockerfile:1
# Image FRONTEND (Next.js di frontend/). Tetap di root karena template GitLab
# CI membangun ./Dockerfile dengan konteks root repo; backend Go punya
# backend/Dockerfile sendiri.
# ^ required for the `RUN --mount=type=cache|secret` lines below (BuildKit
# Dockerfile frontend directive, must be the first line). This file needs
# BuildKit: DOCKER_BUILDKIT=0 cannot parse --mount. See docs/ci-cache.md for why
# these two mounts exist: the fleet's `docker build --cache-from <tag>` can
# only ever pull layers from the FINAL stage (the only one pushed to the
# registry) -- deps/builder here never get a cache hit through --cache-from,
# no matter how small the change. These mounts sidestep that entirely: BuildKit
# keeps them as persistent local cache on the runner's own disk, independent
# of --cache-from/--cache-to, so pnpm install/build stay incremental even
# without the registry cache export.

FROM node:22-alpine AS deps
WORKDIR /app
# corepack ships with node:22; pinning the version here keeps CI byte-identical
# to local installs without adding a "packageManager" field to package.json.
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
# Only the manifest + lockfile + .npmrc, so this layer (the slow one) is reused
# from --cache-from on every build where dependencies didn't change.
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/.npmrc ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY frontend/ .
ENV NODE_ENV=production
# `next build` inlines NEXT_PUBLIC_* into the bundles, so the build needs the
# env. CI passes it as a BuildKit secret (`--secret id=dotenv,src=<file>`):
# a secret never lands in a layer, the registry build cache, or the image.
# The copy to .env exists only for the duration of this RUN, and Next's
# standalone output copies .env into .next/standalone, so both are removed
# before the layer is committed. Runtime secrets reach the container at
# `docker run --env-file` (see .gitlab/deploy-docker.sh). Without the secret
# (plain local build) NEXT_PUBLIC_* bake in empty.
RUN --mount=type=cache,target=/app/.next/cache \
    --mount=type=secret,id=dotenv \
    if [ -f /run/secrets/dotenv ]; then cp /run/secrets/dotenv .env; fi; \
    pnpm build; status=$?; \
    rm -f .env .next/standalone/.env*; \
    exit $status

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# output: "standalone" (next.config.ts) emits a self-contained server.js plus
# only the traced node_modules files. No package manager and no
# devDependencies in the runtime image. static/ and public/ are deliberately
# NOT part of standalone and have to be copied alongside it.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Aplikasi menulis unggahan ke process.cwd()/storage (lihat src/lib/storage.ts dan
# src/lib/storage-private.ts). /app milik root sedangkan proses berjalan sebagai
# nextjs, jadi mkdir saat runtime gagal dengan EACCES — direktorinya harus dibuat
# di sini, selagi masih root. Isinya sendiri dipasok lewat volume saat docker run;
# tanpa volume, unggahan hilang setiap redeploy.
RUN mkdir -p /app/storage/uploads /app/storage/private && \
    chown -R nextjs:nodejs /app/storage

EXPOSE 3000
ENV PORT=3000
# The standalone server binds HOSTNAME, defaulting to localhost — inside a
# container that makes the published port unreachable. Must be 0.0.0.0.
ENV HOSTNAME=0.0.0.0
USER nextjs
# 127.0.0.1, not localhost: HOSTNAME=0.0.0.0 binds IPv4 only, while Alpine
# resolves localhost to ::1 first -- wget then gets ECONNREFUSED and the
# container is marked unhealthy even though it is serving fine.
# /api/ready answers 503 when the database is unreachable, so the container
# is marked unhealthy when it cannot serve real requests.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget -q -O- http://127.0.0.1:3000/api/ready >/dev/null || exit 1
CMD ["node", "server.js"]
