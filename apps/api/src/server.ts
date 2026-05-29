import { createApp } from './http/app.js';
import { createDb, runMigrations } from './db/client.js';

const url = process.env.DATABASE_URL ?? 'file:./data/sitewright.db';
const port = Number(process.env.PORT ?? 2002);

const { db } = createDb(url);
await runMigrations(db);

const app = createApp({
  db,
  cookieSecret: process.env.COOKIE_SECRET,
  // Secure cookies require HTTPS; gate on an explicit flag (not NODE_ENV) so the
  // HTTP DinD preview works. Set COOKIE_SECURE=true when served behind TLS.
  secureCookies: process.env.COOKIE_SECURE === 'true',
});

await app.listen({ host: '0.0.0.0', port });
process.stdout.write(`[sitewright/api] listening on :${port}\n`);
