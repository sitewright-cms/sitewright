import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createApp } from './http/app.js';
import { seedInstance } from './seed.js';
import { migrateDatasetSlugsToUnderscore } from './migrate-content.js';
import { users } from './db/schema.js';
import { RenderPool } from './render/render-pool.js';
import { createDb, runMigrations } from './db/client.js';
import { createReleaseChecker } from './version/checker.js';
import { resolveRuntimeConfig } from './config.js';
import { WorkerBuildRunner } from './publish/worker-runner.js';
import { AnthropicProvider } from './ai/provider.js';
import { AnthropicAgentProvider } from './ai/anthropic-agent.js';
import { OpenAiAgentProvider } from './ai/openai-agent.js';

const RELEASE_REPO = 'sitewright-cms/sitewright';

// ONE place reads the environment: resolveRuntimeConfig validates + derives everything (see config.ts).
// The common case needs almost no env — SW_DATA_DIR (where data lives) and SW_PUBLIC_URL (where the
// instance is reached) drive the rest. A malformed SW_PUBLIC_URL / SW_ENCRYPTION_KEY throws here → the
// server fails fast at boot rather than misbehaving later.
const cfg = resolveRuntimeConfig(process.env);

// Surface the resolved trust-proxy mode at boot so an operator can confirm the rate-limit key (req.ip)
// reflects the real client rather than the proxy.
process.stdout.write(
  `[sitewright/api] TRUST_PROXY=${process.env.TRUST_PROXY ?? '(unset)'} → ${
    cfg.trustProxy === true
      ? 'trusting all proxies'
      : cfg.trustProxy === false
        ? 'no proxy trusted (direct socket IP)'
        : `trusting [${cfg.trustProxy.join(', ')}]`
  }\n`,
);
// TRUST_PROXY=true (or a CIDR/comma list) when running behind a reverse proxy, so per-IP rate limits key
// on the real client IP instead of collapsing every client onto the proxy's IP.
if (cfg.isProduction && cfg.trustProxy === false) {
  process.stderr.write(
    '[sitewright/api] WARNING: TRUST_PROXY is not set; behind a proxy, per-IP rate limits key on the proxy IP\n',
  );
}
// Secure cookies are ON automatically for an https SW_PUBLIC_URL. If a production instance is served over
// plain HTTP (no https public URL, COOKIE_SECURE not forced), session cookies lack the Secure flag — warn.
if (cfg.isProduction && !cfg.secureCookies) {
  process.stderr.write(
    '[sitewright/api] WARNING: session cookies are NOT Secure — set SW_PUBLIC_URL to your https URL ' +
      '(or COOKIE_SECURE=true) when serving behind TLS\n',
  );
}
// In development the forced default-password change is OFF (admin@sitewright.example / 123456 just works);
// say so loudly so a dev instance is never left internet-reachable on the default credentials.
if (!cfg.isProduction) {
  process.stderr.write(
    `[sitewright/api] NOTE: NODE_ENV=${cfg.nodeEnv} (not production) — the forced default-password ` +
      'change is DISABLED; do not expose this instance publicly on the default credentials.\n',
  );
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
// Validate an operator-set OpenAI-compatible base URL early — a typo (missing scheme) should fail at
// boot with a clear message, not at the first assistant request.
if (process.env.SW_AI_BASE_URL) {
  let u: URL | null = null;
  try {
    u = new URL(process.env.SW_AI_BASE_URL);
  } catch {
    u = null;
  }
  if (!u || (u.protocol !== 'https:' && u.protocol !== 'http:')) {
    throw new Error(`SW_AI_BASE_URL="${process.env.SW_AI_BASE_URL}" is not a valid http(s) URL`);
  }
}
// The on-page AI assistant's streaming, tool-using provider. Universal by design:
// `SW_AI_PROVIDER=openai` targets any OpenAI-compatible endpoint (SW_AI_BASE_URL), else
// native Anthropic. Shares SW_AI_API_KEY / SW_AI_MODEL with the one-shot provider above.
const agentProvider = process.env.SW_AI_API_KEY
  ? process.env.SW_AI_PROVIDER === 'openai'
    ? new OpenAiAgentProvider(process.env.SW_AI_API_KEY, process.env.SW_AI_MODEL, process.env.SW_AI_BASE_URL)
    : new AnthropicAgentProvider(process.env.SW_AI_API_KEY, process.env.SW_AI_MODEL)
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
  projectMonthlyTokens: aiNumber(process.env.SW_AI_PROJECT_MONTHLY_TOKENS, 'SW_AI_PROJECT_MONTHLY_TOKENS'),
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

// Ensure the data directory + its sub-roots exist before opening the DB (the DB file lives directly in
// the data dir). All roots are derived from SW_DATA_DIR — mount a single volume there to persist.
// eslint-disable-next-line security/detect-non-literal-fs-filename -- trusted startup env path
await mkdir(cfg.dataDir, { recursive: true });
const { db } = await createDb(cfg.databaseUrl);
await runMigrations(db);
// eslint-disable-next-line security/detect-non-literal-fs-filename -- trusted startup env path
await mkdir(cfg.mediaRoot, { recursive: true });
// eslint-disable-next-line security/detect-non-literal-fs-filename -- trusted startup env path
await mkdir(cfg.publishRoot, { recursive: true });
// eslint-disable-next-line security/detect-non-literal-fs-filename -- trusted startup env path
await mkdir(cfg.previewRoot, { recursive: true });
// eslint-disable-next-line security/detect-non-literal-fs-filename -- trusted startup env path
await mkdir(cfg.sourceRefRoot, { recursive: true });

const app = await createApp({
  db,
  cookieSecret: cfg.cookieSecret,
  // Secure cookies + HSTS are ON automatically for an https SW_PUBLIC_URL (or an explicit
  // COOKIE_SECURE=true); OFF over plain HTTP so the HTTP DinD preview keeps working.
  secureCookies: cfg.secureCookies,
  mediaRoot: cfg.mediaRoot,
  publishRoot: cfg.publishRoot,
  previewRoot: cfg.previewRoot,
  sourceRefRoot: cfg.sourceRefRoot,
  trustProxy: cfg.trustProxy,
  encryptionKey: cfg.encryptionKey,
  // WebAuthn RP: derived from SW_PUBLIC_URL when set (else the request host); SW_WEBAUTHN_* override.
  webauthnRpId: cfg.webauthnRpId,
  webauthnOrigin: cfg.webauthnOrigin,
  deployAllowedHosts: cfg.deployAllowedHosts,
  smtpAllowedHosts: cfg.smtpAllowedHosts,
  // Force the seeded default-password admin to change it in production (NODE_ENV defaults to production).
  // A local dev run (NODE_ENV=development/test) skips the gate so admin@sitewright.example / 123456 works.
  forcePasswordChange: cfg.isProduction,
  // Brute-force protection is a per-IP FAILED-login throttle (admin setting `authMaxFailures`, default
  // 10), not an env var. Flood protection for all routes is the global 200/min limiter.
  renderPool,
  // Public base URL baked into exported forms (so static sites post submissions
  // back to this platform). Validated in config.ts; trailing slash normalized.
  publicUrl: cfg.publicUrl,
  // Subdomain routing for locally-hosted sites: `<slug>.<SW_SITES_DOMAIN>` serves that site at root
  // (needs wildcard DNS `*.<domain>` → this host). Unset → off; the `/sites/<slug>/` path form always works.
  sitesDomain: cfg.sitesDomain,
  buildRunner,
  aiProvider,
  agentProvider,
  aiQuota,
  version: cfg.version,
  // Pull-based release check (disable for air-gapped installs).
  latestVersion: cfg.disableUpdateCheck ? undefined : createReleaseChecker({ repo: RELEASE_REPO }),
  releaseUrl: `https://github.com/${RELEASE_REPO}/releases/latest`,
  logger: cfg.isProduction,
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
    adminEmail: cfg.seedAdminEmail,
    adminPassword: cfg.seedAdminPassword,
    // Generate the demo's local imagery into the same media root the app serves from.
    mediaRoot: cfg.mediaRoot,
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

// Idempotent content migration: bring any legacy HYPHENATED dataset slugs (locale twins like `services-de`,
// or user/agent multi-word slugs like `faq-passengers`) onto the underscore identifier convention so their
// `dataset.<slug>` loops resolve. A no-op once migrated; never block boot if it fails.
try {
  await migrateDatasetSlugsToUnderscore(db, (m) => process.stderr.write(`[sitewright/migrate] ${m}\n`));
} catch (err) {
  process.stderr.write(`[sitewright/migrate] WARNING: dataset-slug migration failed — ${err instanceof Error ? err.message : String(err)}\n`);
}

// Refuse to boot into a permanently-locked state: registration is CLOSED by default (self-signup is an
// in-app admin opt-in), so NO users means nobody can ever sign in. The first-boot seed creates the
// admin, so an empty users table means that seed failed — fail fast rather than serve an unusable
// instance. (Checked against the DB, so a normal restart with an existing admin proceeds cleanly.)
const anyUser = await db.select({ id: users.id }).from(users).limit(1);
if (anyUser.length === 0) {
  throw new Error(
    'The instance has no users — nobody could sign in. The first-boot admin seed must have failed ' +
      '(check the "[sitewright/seed]" entries on stderr); fix the cause and re-deploy.',
  );
}

await app.listen({ host: '0.0.0.0', port: cfg.port });
process.stdout.write(`[sitewright/api] listening on :${cfg.port}\n`);

// Graceful shutdown for k8s: on SIGTERM/SIGINT, close Fastify (which drains + terminates
// the render workers via the onClose hook), then exit.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
