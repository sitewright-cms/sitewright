# Runtime image for a `pnpm deploy --prod` output: a self-contained directory
# with resolved node_modules (incl. workspace deps), the built dist/, and the
# drizzle/ migrations. Build with:
#   pnpm --filter @sitewright/api deploy --prod <dir>
#   docker build -t sitewright-api -f apps/api/Dockerfile <dir>
FROM node:22-slim

# Docker CLI — only used when the optional isolated build worker is enabled
# (SW_BUILD_WORKER=true) to spawn worker containers; harmless otherwise. Static
# client binary only (no daemon). Build offline? this layer can be dropped.
ARG DOCKER_CLI_VERSION=27.3.1
RUN set -eux; \
    ARCH="$(dpkg --print-architecture | sed 's/amd64/x86_64/; s/arm64/aarch64/')"; \
    apt-get update && apt-get install -y --no-install-recommends ca-certificates curl; \
    curl -fsSL "https://download.docker.com/linux/static/stable/${ARCH}/docker-${DOCKER_CLI_VERSION}.tgz" \
      | tar -xz -C /usr/local/bin --strip-components=1 docker/docker; \
    apt-get purge -y --auto-remove curl; rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- dependencies + Chromium FIRST, so this heavy layer is CACHED across code-only rebuilds ---
# node_modules changes only when deps change; copying it before the Chromium install means a plain code
# change (dist/) no longer re-downloads the ~300MB browser on every deploy.
COPY --chown=node:node node_modules ./node_modules
# Headless Chromium for server-side preview screenshots (the MCP `preview_page` tool renders the page so
# an agent can SEE it). We install ONLY `chromium-headless-shell` — the purpose-built headless build the
# screenshot code launches (render/screenshot.ts, `channel: 'chromium-headless-shell'`) — NOT the full
# `chromium`, which would ALSO drop a ~377MB headed browser we never launch (+ ffmpeg). Installed (browser
# + its apt libraries) into a shared, world-readable path; the API later runs as `node`.
#
# Then we PURGE the Mesa software-GL stack (`libgl1-mesa-dri` → which drags in `libllvm15`, ~135MB
# together): the renderer runs with --disable-gpu (CPU/Skia 2D — no system GL), and any WebGL falls back
# to the SwiftShader that ships inside the browser bundle, so the Mesa DRI drivers are dead weight. The
# CI `snapshot` job renders a real screenshot INSIDE this image to prove rendering still works. (CJK +
# emoji fonts are deliberately KEPT so multi-language pages screenshot correctly.) Adds ~125MB net.
# Drop this whole layer (+ the dep above) if screenshots aren't needed.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# `git` + `openssh-client` are the transport for SSH-key git deploy targets (the pure-JS isomorphic-git
# path handles HTTPS-token targets; SSH needs the real binaries). Installed in the same cached heavy
# layer as Chromium so code-only deploys don't re-fetch them.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git openssh-client \
    && node node_modules/playwright-core/cli.js install --with-deps chromium-headless-shell \
    && apt-get purge -y --auto-remove libgl1-mesa-dri \
    && rm -rf /var/lib/apt/lists/*

# --- application artifacts (re-copied each build; cheap layers AFTER the cached Chromium one) ---
# Only the runtime needs: compiled dist/, the drizzle/ migrations (loaded relative to dist at boot),
# the editor SPA, and package.json. (If the runtime ever needs another top-level file, add a COPY here.)
# COPY --chown sets ownership inline, so we skip a slow `chown -R /app` (which would re-scan node_modules
# on every code change). node_modules above was copied --chown too.
COPY --chown=node:node dist ./dist
COPY --chown=node:node drizzle ./drizzle
COPY --chown=node:node editor ./editor
COPY --chown=node:node package.json ./

ENV NODE_ENV=production
ENV PORT=80
# The editor SPA is copied into the deploy context as ./editor (see deploy step).
ENV EDITOR_DIST=/app/editor
# ONE persistent data dir holds the SQLite DB, media, published sites + preview builds — mount a single
# volume here to persist an instance (`-v sw-data:/app/data`). No DATABASE_URL needed; the app defaults
# the DB to <SW_DATA_DIR>/sitewright.db (SW_DATA_DIR defaults to ./data → /app/data, since WORKDIR=/app).
# WAL note: the DB dir also holds `sitewright.db-wal`/`-shm`. BACKUP: a bare `cp sitewright.db` (missing
# the -wal) can be CORRUPT — use `sqlite3 sitewright.db ".backup out.db"` or `PRAGMA wal_checkpoint(TRUNCATE)`.
ENV SW_DATA_DIR=/app/data

# Run as the non-root `node` user (present in the base image). Own the data dir AND the /app dir itself
# so the app can create the DB + media subdirs at boot — the COPY'd contents are already node-owned, and
# a non-recursive chown of these two dirs avoids re-scanning node_modules. (Chromium lives in
# /ms-playwright, root-owned + world-readable, which node only needs to read.)
RUN mkdir -p /app/data && chown node:node /app /app/data
USER node

EXPOSE 80
CMD ["node", "dist/server.js"]
