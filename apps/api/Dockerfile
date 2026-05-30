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
ENV DATABASE_URL=file:/data/sitewright.db
ENV PORT=80
# The editor SPA is copied into the deploy context as ./editor (see deploy step).
ENV EDITOR_DIST=/app/editor

# Run as the non-root `node` user (present in the base image); own the data dir.
RUN mkdir -p /data && chown -R node:node /app /data
USER node

EXPOSE 80
CMD ["node", "dist/server.js"]
