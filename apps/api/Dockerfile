# Runtime image for a `pnpm deploy --prod` output: a self-contained directory
# with resolved node_modules (incl. workspace deps), the built dist/, and the
# drizzle/ migrations. Build with:
#   pnpm --filter @sitewright/api deploy --prod <dir>
#   docker build -t sitewright-api -f apps/api/Dockerfile <dir>
FROM node:22-slim

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
