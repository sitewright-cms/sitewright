import { createApp } from './http/app.js';
import { createDb, runMigrations } from './db/client.js';

const url = process.env.DATABASE_URL ?? 'file:./data/sitewright.db';
const port = Number(process.env.PORT ?? 2002);
const cookieSecret = process.env.COOKIE_SECRET;
const isProduction = process.env.NODE_ENV === 'production';

// A signing secret is mandatory in production; refuse to start without one.
if (isProduction && !cookieSecret) {
  throw new Error('COOKIE_SECRET must be set in production');
}
if (isProduction && process.env.COOKIE_SECURE !== 'true') {
  process.stderr.write('[sitewright/api] WARNING: COOKIE_SECURE is not true in production\n');
}

const { db } = createDb(url);
await runMigrations(db);

const app = createApp({
  db,
  cookieSecret,
  // Secure cookies require HTTPS; gate on an explicit flag (not NODE_ENV) so the
  // HTTP DinD preview works. Set COOKIE_SECURE=true when served behind TLS.
  secureCookies: process.env.COOKIE_SECURE === 'true',
  logger: isProduction,
  editorDist: process.env.EDITOR_DIST,
});

await app.listen({ host: '0.0.0.0', port });
process.stdout.write(`[sitewright/api] listening on :${port}\n`);
