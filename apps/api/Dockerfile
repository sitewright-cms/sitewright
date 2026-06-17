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
COPY . .

ENV NODE_ENV=production
# The DB runs in WAL mode, so /data also holds `sitewright.db-wal` (+ `-shm`). BACKUP NOTE: a bare
# `cp sitewright.db` (or a snapshot that misses the -wal) can be CORRUPT — back up with
# `sqlite3 sitewright.db ".backup out.db"` or run `PRAGMA wal_checkpoint(TRUNCATE)` first. (-shm is
# always rebuilt on open and need not be copied.)
ENV DATABASE_URL=file:/data/sitewright.db
ENV PORT=80
# The editor SPA is copied into the deploy context as ./editor (see deploy step).
ENV EDITOR_DIST=/app/editor

# Headless Chromium for server-side preview screenshots (the MCP `preview_page` tool renders the page
# so an agent can SEE it). Installed (browser + its apt libraries) into a shared, world-readable path;
# the API later runs as `node`. Adds ~300MB. Drop this layer if screenshots aren't needed.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN apt-get update \
    && node node_modules/playwright-core/cli.js install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*

# Run as the non-root `node` user (present in the base image); own the data dir.
RUN mkdir -p /data && chown -R node:node /app /data
USER node

EXPOSE 80
CMD ["node", "dist/server.js"]
