import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createApp } from './http/app.js';
import { seedInstance, DEFAULT_ADMIN_EMAIL } from './seed.js';
import { users } from './db/schema.js';
import { RenderPool } from './render/render-pool.js';
import { createDb, runMigrations } from './db/client.js';
import { createReleaseChecker } from './version/checker.js';
import { parseKey } from './crypto/secret.js';
import { WorkerBuildRunner } from './publish/worker-runner.js';
import { AnthropicProvider } from './ai/provider.js';

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
// Optional SSRF allowlist for per-project SMTP hosts (multi-tenant SaaS).
const smtpAllowedHosts = process.env.SW_SMTP_ALLOWED_HOSTS
  ? process.env.SW_SMTP_ALLOWED_HOSTS.split(',')
      .map((h) => h.trim().toLowerCase().replace(/\.$/, ''))
      .filter(Boolean)
  : undefined;

// Instance admins: a comma-separated email allowlist. These users may read/write
// instance settings (global SMTP, hCaptcha keys, enabled web-form mail modes).
// Normalization (trim/lowercase) is owned by createApp — pass the raw split here
// so there is a single source of truth for the matching rule.
// The bootstrap super-admin (seeded on first boot) is always an instance admin.
// SW_ADMIN_EMAIL overrides the well-known default identity.
const seedAdminEmail = process.env.SW_ADMIN_EMAIL?.trim() || DEFAULT_ADMIN_EMAIL;
const adminEmails = [
  ...(process.env.SW_ADMIN_EMAILS ? process.env.SW_ADMIN_EMAILS.split(',') : []),
  seedAdminEmail,
];

// Public registration is CLOSED by default (invitation-only + a seeded admin); an operator
// who wants open self-signup sets SW_OPEN_REGISTRATION=true.
const openRegistration = process.env.SW_OPEN_REGISTRATION === 'true';

// The platform's public base URL, baked into exported forms as the absolute
// submission endpoint. A malformed value would silently misdirect every form's
// submissions, so validate it as an http(s) URL at startup and refuse to boot.
const publicUrl = process.env.SW_PUBLIC_URL;
if (publicUrl) {
  let parsedPublicUrl: URL | undefined;
  try {
    parsedPublicUrl = new URL(publicUrl);
  } catch {
    throw new Error(`SW_PUBLIC_URL="${publicUrl}" is not a valid URL`);
  }
  if (parsedPublicUrl.protocol !== 'https:' && parsedPublicUrl.protocol !== 'http:') {
    throw new Error(`SW_PUBLIC_URL must be an http(s) URL; got "${publicUrl}"`);
  }
}

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

// Online AI (agency-funded). Enabled only when a single global agency API key is
// set; the platform meters all usage against it and enforces monthly per-org /
// per-user token quotas so no one client drains the budget.
const aiProvider = process.env.SW_AI_API_KEY
  ? new AnthropicProvider(process.env.SW_AI_API_KEY, process.env.SW_AI_MODEL)
  : undefined;
// Parse a positive-integer token cap. A set-but-invalid value (0, negative,
// non-numeric) yields `undefined` — which means UNLIMITED — so warn loudly:
// an operator who sets "0" to block AI spend must not silently get no cap.
const aiNumber = (v: string | undefined, name: string): number | undefined => {
  if (!v) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) {
    process.stderr.write(
      `[sitewright/api] WARNING: ${name}="${v}" is not a positive integer; AI quota is UNLIMITED\n`,
    );
    return undefined;
  }
  return n;
};
const aiQuota = {
  orgMonthlyTokens: aiNumber(process.env.SW_AI_ORG_MONTHLY_TOKENS, 'SW_AI_ORG_MONTHLY_TOKENS'),
  userMonthlyTokens: aiNumber(process.env.SW_AI_USER_MONTHLY_TOKENS, 'SW_AI_USER_MONTHLY_TOKENS'),
};

// Isolated template render pool: warm child-process workers inside this container, each
// with a hard V8 heap ceiling. Tunable for k8s resource limits.
const renderEnvInt = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const renderPool = new RenderPool({
  size: renderEnvInt(process.env.SW_RENDER_WORKERS, 2),
  memoryLimitMb: renderEnvInt(process.env.SW_RENDER_MEMORY_MB, 128),
  renderTimeoutMs: renderEnvInt(process.env.SW_RENDER_TIMEOUT_MS, 5000),
  maxRendersPerWorker: renderEnvInt(process.env.SW_RENDER_MAX_RENDERS, 500),
});

const { db } = await createDb(url);
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
  smtpAllowedHosts,
  adminEmails,
  openRegistration,
  // Per-IP auth rate cap; defaults to 10/min. Raise via SW_AUTH_RATE_LIMIT_MAX only for the
  // integration/E2E harness (many registrations from one IP).
  authRateMax: process.env.SW_AUTH_RATE_LIMIT_MAX ? Number(process.env.SW_AUTH_RATE_LIMIT_MAX) : undefined,
  renderPool,
  // Public base URL baked into exported forms (so static sites post submissions
  // back to this platform). Validated above; trailing slash normalized at build time.
  publicUrl,
  buildRunner,
  aiProvider,
  aiQuota,
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

// First-boot bootstrap: seed the super-admin + showcase "Example Project" when the instance is
// empty. Registration is invite-only, so this is the only path to the first admin. The identity
// defaults to the well-known admin@sitewright.example / 123456 (SW_ADMIN_EMAIL/SW_ADMIN_PASSWORD
// override; the seed warns when the default password is in use). The seed is a convenience, NOT a
// correctness invariant — a transient failure (DB blip, etc.) must not crash the container into a
// restart loop, so swallow-and-warn rather than letting the reject propagate.
try {
  await seedInstance({
    db,
    adminEmail: seedAdminEmail,
    adminPassword: process.env.SW_ADMIN_PASSWORD,
    // Generate the demo's local imagery into the same media root the app serves from.
    mediaRoot,
    // Self-host the demo's Google heading font into the same font cache the app serves from.
    // Bootstrap notices are operational diagnostics. Emit on stderr so log pipelines
    // treat them as diagnostics (not indexed app output).
    log: (m) => process.stderr.write(`${m}\n`),
  });
} catch (err) {
  process.stderr.write(
    `[sitewright/seed] WARNING: bootstrap seed failed — ${err instanceof Error ? err.message : String(err)}\n` +
      '[sitewright/seed] the server will still start; re-deploy to retry the seed.\n',
  );
}

// Refuse to boot into a permanently-locked state: closed registration with NO users means nobody
// can ever sign in (no admin was seeded and no invite can be created). Mirror the COOKIE_SECRET
// fail-fast. We check the DB (not just the env) so removing SW_ADMIN_EMAIL after a successful first
// boot — when an admin already exists — still restarts cleanly.
if (!openRegistration) {
  const anyUser = await db.select({ id: users.id }).from(users).limit(1);
  if (anyUser.length === 0) {
    throw new Error(
      'Registration is closed (SW_OPEN_REGISTRATION is not "true") and the instance has no users — ' +
        'nobody could ever sign in. The first-boot admin seed must have failed (check the ' +
        '"[sitewright/seed]" entries on stderr); fix the cause and re-deploy, or set ' +
        'SW_OPEN_REGISTRATION=true to allow public self-signup.',
    );
  }
}

await app.listen({ host: '0.0.0.0', port });
process.stdout.write(`[sitewright/api] listening on :${port}\n`);

// Graceful shutdown for k8s: on SIGTERM/SIGINT, close Fastify (which drains + terminates
// the render workers via the onClose hook), then exit.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
