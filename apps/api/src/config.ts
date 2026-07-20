import { resolve, join } from 'node:path';
import { parseKey } from './crypto/secret.js';
import { parseTrustProxy } from './trust-proxy.js';
import { DEFAULT_ADMIN_EMAIL } from './seed.js';

/**
 * The resolved, validated runtime configuration for one instance — the single place that reads the
 * environment. `server.ts` turns this plain data into live objects (DB, render pool, AI providers).
 *
 * Design goal: an operator configures TWO things and the rest is derived:
 *   - `SW_DATA_DIR`   → where all persistent data lives (DB + media + sites + preview + source-refs).
 *   - `SW_PUBLIC_URL` → where the instance is reached; its scheme/host derive Secure cookies + HSTS +
 *                        the WebAuthn RP. Everything else has a safe default or an advanced override.
 */
export interface RuntimeConfig {
  /** Absolute data directory; every sub-root is derived from it. */
  readonly dataDir: string;
  /** libsql/SQLite `file:` URL (defaults under {@link dataDir}). */
  readonly databaseUrl: string;
  readonly port: number;

  /** Resolved NODE_ENV; an UNSET value defaults to `production` (hardened by default). */
  readonly nodeEnv: string;
  readonly isProduction: boolean;

  /** The validated public base URL (trailing slash stripped), or undefined. */
  readonly publicUrl?: string;
  /** Add the `Secure` cookie flag + `__Host-` prefix + emit HSTS. Derived from an https public URL. */
  readonly secureCookies: boolean;
  /** WebAuthn relying-party id/origin; derived from {@link publicUrl} unless overridden. */
  readonly webauthnRpId?: string;
  readonly webauthnOrigin?: string;
  readonly trustProxy: boolean | string[];

  readonly mediaRoot: string;
  readonly publishRoot: string;
  readonly previewRoot: string;
  readonly sourceRefRoot: string;

  readonly cookieSecret?: string;
  /** Parsed 32-byte at-rest encryption key (undefined ⇒ secret-bearing features disabled). */
  readonly encryptionKey?: Buffer;
  readonly deployAllowedHosts?: string[];
  readonly smtpAllowedHosts?: string[];

  readonly seedAdminEmail: string;
  readonly seedAdminPassword?: string;
  readonly sitesDomain?: string;

  readonly version: string;
  readonly disableUpdateCheck: boolean;
}

type Env = Record<string, string | undefined>;

/** Splits + normalizes a comma-separated SSRF host allowlist (lowercase, no trailing dot, no blanks). */
function parseHostList(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const list = raw
    .split(',')
    .map((h) => h.trim().toLowerCase().replace(/\.$/, ''))
    .filter(Boolean);
  return list.length > 0 ? list : undefined;
}

/** Validates SW_PUBLIC_URL as an http(s) URL; returns the parsed URL (or undefined when unset). */
function parsePublicUrl(raw: string | undefined): URL | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`SW_PUBLIC_URL="${trimmed}" is not a valid URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`SW_PUBLIC_URL must be an http(s) URL; got "${trimmed}"`);
  }
  return url;
}

/**
 * Resolve the environment into a validated {@link RuntimeConfig}. Pure (no filesystem / no process
 * globals) so it is fully unit-testable; throws with a clear message on any malformed required value
 * (public URL, encryption key) so the server fails fast at boot rather than misbehaving later.
 */
export function resolveRuntimeConfig(env: Env): RuntimeConfig {
  const dataDir = resolve(env.SW_DATA_DIR ?? './data');

  // NODE_ENV defaults to production when unset/blank: an instance that is merely `node dist/server.js`
  // with no env should still get the hardened posture (structured logs, forced default-password change,
  // secure-cookie warnings). Only an EXPLICIT `development`/`test`/other opts out.
  const nodeEnv = (env.NODE_ENV ?? '').trim() || 'production';
  const isProduction = nodeEnv === 'production';

  const parsedPublicUrl = parsePublicUrl(env.SW_PUBLIC_URL);

  // Secure cookies: an explicit COOKIE_SECURE wins (any value other than "true" ⇒ off); otherwise derive
  // from the public URL scheme (https ⇒ Secure). No public URL + no flag ⇒ off (safe for local/HTTP).
  const cookieSecureEnv = env.COOKIE_SECURE?.trim();
  const secureCookies =
    cookieSecureEnv != null && cookieSecureEnv !== ''
      ? cookieSecureEnv === 'true'
      : parsedPublicUrl?.protocol === 'https:';

  return {
    dataDir,
    databaseUrl: env.DATABASE_URL ?? `file:${join(dataDir, 'sitewright.db')}`,
    port: Number(env.PORT ?? 2002),

    nodeEnv,
    isProduction,

    publicUrl: parsedPublicUrl ? parsedPublicUrl.href.replace(/\/$/, '') : undefined,
    secureCookies,
    // Behind a proxy the request host can be wrong; prefer the public URL's host/origin when set. An
    // explicit SW_WEBAUTHN_* override still wins; both unset ⇒ undefined (resolved from the request).
    webauthnRpId: env.SW_WEBAUTHN_RP_ID?.trim() || parsedPublicUrl?.hostname,
    webauthnOrigin: env.SW_WEBAUTHN_ORIGIN?.trim() || parsedPublicUrl?.origin,
    trustProxy: parseTrustProxy(env.TRUST_PROXY),

    // Every artifact lives under the ONE data dir — no per-root env knobs (mount a single volume; use a
    // symlink/bind-mount if a sub-tree must live on another disk).
    mediaRoot: join(dataDir, 'media'),
    publishRoot: join(dataDir, 'sites'),
    previewRoot: join(dataDir, 'preview'),
    sourceRefRoot: join(dataDir, 'source-refs'),

    cookieSecret: env.COOKIE_SECRET,
    encryptionKey: env.SW_ENCRYPTION_KEY ? parseKey(env.SW_ENCRYPTION_KEY) : undefined,
    deployAllowedHosts: parseHostList(env.SW_DEPLOY_ALLOWED_HOSTS),
    smtpAllowedHosts: parseHostList(env.SW_SMTP_ALLOWED_HOSTS),

    seedAdminEmail: env.SW_ADMIN_EMAIL?.trim() || DEFAULT_ADMIN_EMAIL,
    seedAdminPassword: env.SW_ADMIN_PASSWORD,
    sitesDomain: env.SW_SITES_DOMAIN,

    version: env.SW_VERSION ?? '0.0.0',
    disableUpdateCheck: env.SW_DISABLE_UPDATE_CHECK === 'true',
  };
}
