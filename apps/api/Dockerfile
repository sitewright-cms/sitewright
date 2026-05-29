# Single-container Sitewright API: Node + bundled deps + SQLite file + migrations.
# `dist/` is built by the monorepo beforehand (it needs the workspace tsconfig);
# prod deps are installed here so the native libsql binary matches this image.
FROM node:22-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY dist ./dist
COPY drizzle ./drizzle

ENV NODE_ENV=production
ENV DATABASE_URL=file:/data/sitewright.db
ENV PORT=80
RUN mkdir -p /data

EXPOSE 80
CMD ["node", "dist/server.js"]
