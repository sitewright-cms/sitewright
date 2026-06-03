#!/usr/bin/env node
import { runStdioBridge } from './run.js';
import { deviceLogin, refreshAccess, DEFAULT_SCOPE, OAuthLoginError } from './oauth.js';
import { loadCredentials, saveCredentials, clearCredentials, type StoredCredentials } from './credentials.js';

/** Reads `--flag value` / `--flag=value` from argv (after the optional subcommand), else an env var. */
function arg(name: string, env: string): string | undefined {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(`--${name}`);
  if (i !== -1 && i + 1 < argv.length) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(`--${name}=`.length);
  // eslint-disable-next-line security/detect-object-injection -- `env` is one of a few fixed literals passed by our own code
  return process.env[env];
}

function requireUrl(): string {
  const url = arg('url', 'SITEWRIGHT_URL');
  if (!url) {
    process.stderr.write('sitewright-mcp: set SITEWRIGHT_URL (or pass --url).\n');
    process.exit(2);
  }
  if (!/^https?:\/\//i.test(url)) {
    process.stderr.write(`sitewright-mcp: SITEWRIGHT_URL must be an http(s) URL; got "${url}".\n`);
    process.exit(2);
  }
  return url;
}

/** `sitewright-mcp login` — OAuth device grant: approve in a browser (sign in + pick the project). */
async function loginCommand(): Promise<void> {
  const url = requireUrl();
  const scope = arg('scope', 'SITEWRIGHT_SCOPE') ?? DEFAULT_SCOPE;
  process.stderr.write(`sitewright-mcp: connecting to ${url}…\n`);
  let creds: StoredCredentials;
  try {
    creds = await deviceLogin({
      url,
      scope,
      notify: ({ verificationUri, verificationUriComplete, userCode }) => {
        process.stderr.write(
          `\nTo connect, open this URL and approve (sign in, then choose the project):\n` +
            `  ${verificationUriComplete ?? verificationUri}\n` +
            `  code: ${userCode}\n\nWaiting for approval…\n`,
        );
      },
    });
  } catch (err) {
    const message = err instanceof OAuthLoginError ? err.message : err instanceof Error ? err.message : String(err);
    process.stderr.write(`sitewright-mcp: login failed: ${message}\n`);
    process.exit(1);
  }
  await saveCredentials(url, creds);
  process.stderr.write(
    `sitewright-mcp: logged in to ${url} (scopes: ${creds.scope || scope}). ` +
      `Run \`sitewright-mcp\` (no token) to start the bridge.\n`,
  );
}

/** `sitewright-mcp logout` — forget the stored tokens for this instance. */
async function logoutCommand(): Promise<void> {
  const url = requireUrl();
  await clearCredentials(url);
  process.stderr.write(`sitewright-mcp: logged out of ${url}.\n`);
}

/** Default: connect the stdio MCP bridge using a static token OR the stored OAuth login (auto-refresh). */
async function runBridge(): Promise<void> {
  const url = requireUrl();
  const staticToken = arg('token', 'SITEWRIGHT_TOKEN');
  if (process.argv.slice(2).some((a) => a === '--token' || a.startsWith('--token='))) {
    process.stderr.write('sitewright-mcp: warning: --token is visible in the process list; prefer SITEWRIGHT_TOKEN.\n');
  }

  let token: string;
  let onUnauthorized: (() => Promise<string | null>) | undefined;
  if (staticToken) {
    token = staticToken; // a long-lived project API key (swk_…) — no refresh needed.
  } else {
    const creds = await loadCredentials(url);
    if (!creds) {
      process.stderr.write(
        `sitewright-mcp: no token for ${url}. Run \`sitewright-mcp login\` first, or set SITEWRIGHT_TOKEN.\n`,
      );
      process.exit(2);
    }
    let current = creds; // rotates on each refresh; always exchange the LATEST refresh token.
    token = current.accessToken;
    // On a 401 (the short-lived access token expired), refresh + persist the rotated pair.
    onUnauthorized = async (): Promise<string | null> => {
      try {
        current = await refreshAccess({ url, refreshToken: current.refreshToken });
        await saveCredentials(url, current);
        return current.accessToken;
      } catch (err) {
        process.stderr.write(
          `sitewright-mcp: token refresh failed (${err instanceof Error ? err.message : 'error'}); run \`sitewright-mcp login\` again.\n`,
        );
        return null;
      }
    };
  }

  // Fail fast (out of band of the MCP protocol) on a bad token; introspect + connect.
  let scope;
  try {
    scope = await runStdioBridge({ url, token, onUnauthorized });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    process.stderr.write(`sitewright-mcp: could not authenticate to ${url}: ${message}\n`);
    process.exit(1);
  }
  process.stderr.write(
    `sitewright-mcp: connected to project ${scope.projectId} (role ${scope.role}, caps ${scope.capabilities.join(',')})\n`,
  );
}

async function main(): Promise<void> {
  // A leading non-flag arg is the subcommand; otherwise run the bridge.
  const sub = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : undefined;
  if (sub === 'login') return loginCommand();
  if (sub === 'logout') return logoutCommand();
  if (sub && sub !== 'run') {
    process.stderr.write(`sitewright-mcp: unknown command "${sub}" (expected: login | logout | run).\n`);
    process.exit(2);
  }
  return runBridge();
}

main().catch((err) => {
  process.stderr.write(`sitewright-mcp: fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
