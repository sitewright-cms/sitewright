import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createApp } from './http/app.js';
import { createDb, runMigrations } from './db/client.js';
import { createReleaseChecker } from './version/checker.js';
import { parseKey } from './crypto/secret.js';
import { WorkerBuildRunner } from './publish/worker-runner.js';

const RELEASE_REPO = 'sitewright-cms/sitewright';

const url = process.env.DATABASE_URL ?? 'file:./data/sitewright.db';
const port = Number(process.env.PORT ?? 2002);
const cookieSecret = process.env.COOKIE_SECRET;
const isProduction = process.env.NODE_ENV === 'production';
const mediaRoot = resolve(process.env.MEDIA_ROOT ?? './data/media');
const publishRoot = resolve(process.env.PUBLISH_ROOT ?? './data/sites');

// A signing secret is mandatory in production; refuse to start without one.
if (isProduction && !cookieSecret) {
  throw new Error('COOKIE_SECRET must be set in production');
}
if (isProduction && process.env.COOKIE_SECURE !== 'true') {
  process.stderr.write('[sitewright/api] WARNING: COOKIE_SECURE is not true in production\n');
}
// TRUST_PROXY=true (or a CIDR/comma list) when running behind a reverse proxy, so
// rate limiting keys on the real client IP. Warn if likely misconfigured.
const trustProxyEnv = process.env.TRUST_PROXY;
const trustProxy: boolean | string[] =
  trustProxyEnv === 'true' ? true : trustProxyEnv ? trustProxyEnv.split(',').map((s) => s.trim()) : false;
if (isProduction && trustProxy === false) {
  process.stderr.write(
    '[sitewright/api] WARNING: TRUST_PROXY is not set; behind a proxy, per-IP rate limits key on the proxy IP\n',
  );
}

// Optional secret-encryption key (enables saved deploy targets) + deploy SSRF allow-list.
const encryptionKey = process.env.SW_ENCRYPTION_KEY
  ? parseKey(process.env.SW_ENCRYPTION_KEY)
  : undefined;
const deployAllowedHosts = process.env.SW_DEPLOY_ALLOWED_HOSTS
  ? process.env.SW_DEPLOY_ALLOWED_HOSTS.split(',')
      .map((h) => h.trim().toLowerCase().replace(/\.$/, ''))
      .filter(Boolean)
  : undefined;

// Opt-in isolated build worker (multi-tenant SaaS / once builds run untrusted
// code). Default: in-process build (single-container). Requires the docker CLI +
// DOCKER_HOST, and the API image available as the worker image.
const buildRunner =
  process.env.SW_BUILD_WORKER === 'true'
    ? new WorkerBuildRunner({
        image: process.env.SW_BUILD_WORKER_IMAGE ?? 'sitewright-api',
        memory: process.env.SW_BUILD_WORKER_MEMORY,
        cpus: process.env.SW_BUILD_WORKER_CPUS,
      })
    : undefined;

const { db } = createDb(url);
await runMigrations(db);
// eslint-disable-next-line security/detect-non-literal-fs-filename -- trusted startup env path
await mkdir(mediaRoot, { recursive: true });
// eslint-disable-next-line security/detect-non-literal-fs-filename -- trusted startup env path
await mkdir(publishRoot, { recursive: true });

const app = await createApp({
  db,
  cookieSecret,
  // Secure cookies require HTTPS; gate on an explicit flag (not NODE_ENV) so the
  // HTTP DinD preview works. Set COOKIE_SECURE=true when served behind TLS.
  secureCookies: process.env.COOKIE_SECURE === 'true',
  mediaRoot,
  publishRoot,
  trustProxy,
  encryptionKey,
  deployAllowedHosts,
  buildRunner,
  version: process.env.SW_VERSION ?? '0.0.0',
  // Pull-based release check (disable for air-gapped installs).
  latestVersion:
    process.env.SW_DISABLE_UPDATE_CHECK === 'true'
      ? undefined
      : createReleaseChecker({ repo: RELEASE_REPO }),
  releaseUrl: `https://github.com/${RELEASE_REPO}/releases/latest`,
  logger: isProduction,
  // Only enable SPA serving if the dist actually exists (avoids a startup crash
  // for API-only deployments that don't bake in the editor).
  editorDist:
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- trusted startup env path
    process.env.EDITOR_DIST && existsSync(process.env.EDITOR_DIST)
      ? process.env.EDITOR_DIST
      : undefined,
});

await app.listen({ host: '0.0.0.0', port });
process.stdout.write(`[sitewright/api] listening on :${port}\n`);
