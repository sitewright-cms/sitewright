#!/usr/bin/env node
import { runStdioBridge } from './run.js';

/** Reads `--flag value` / `--flag=value` from argv, falling back to an env var. */
function arg(name: string, env: string): string | undefined {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(`--${name}`);
  if (i !== -1 && i + 1 < argv.length) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(`--${name}=`.length);
  // eslint-disable-next-line security/detect-object-injection -- `env` is one of two fixed literals passed by our own code
  return process.env[env];
}

async function main(): Promise<void> {
  const url = arg('url', 'SITEWRIGHT_URL');
  const token = arg('token', 'SITEWRIGHT_TOKEN');
  if (!url || !token) {
    process.stderr.write(
      'sitewright-mcp: set SITEWRIGHT_URL and SITEWRIGHT_TOKEN (or pass --url/--token).\n',
    );
    process.exit(2);
  }

  // Prefer the env var: a token on the command line is visible in `ps`/proc.
  if (process.argv.slice(2).some((a) => a === '--token' || a.startsWith('--token='))) {
    process.stderr.write(
      'sitewright-mcp: warning: --token is visible in the process list; prefer SITEWRIGHT_TOKEN.\n',
    );
  }

  // Fail fast (out of band of the MCP protocol) on a bad token; introspect + connect.
  // Static-token mode resolves the scope up-front (or throws), so `scope` is non-null here.
  let scope;
  try {
    scope = await runStdioBridge({ url, token });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    process.stderr.write(`sitewright-mcp: could not authenticate to ${url}: ${message}\n`);
    process.exit(1);
  }
  if (scope) {
    process.stderr.write(
      `sitewright-mcp: connected to project ${scope.projectId} (role ${scope.role}, caps ${scope.capabilities.join(',')})\n`,
    );
  }
}

main().catch((err) => {
  process.stderr.write(`sitewright-mcp: fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
