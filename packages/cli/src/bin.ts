#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { runStdioBridge } from '@sitewright/mcp';
import { runLogin } from './login.js';
import { clearCredentials } from './credentials.js';
import { ensureAccessToken } from './session.js';

/** Scopes requested by the CLI login (the consent screen lets the user pick the project). */
const DEFAULT_SCOPE = 'content:read content:write publish';

function flag(name: string): string | undefined {
  const argv = process.argv.slice(3); // after `sitewright <command>`
  const i = argv.indexOf(`--${name}`);
  if (i !== -1 && i + 1 < argv.length) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(`--${name}=`.length) : undefined;
}

function die(message: string): never {
  process.stderr.write(`sitewright: ${message}\n`);
  process.exit(1);
}

/** Best-effort cross-platform browser open; always prints the URL as a fallback. */
function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(cmd as string, args as string[], { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    /* fall through to the printed URL */
  }
  process.stderr.write(`If your browser didn't open, visit:\n  ${url}\n`);
}

function requireUrl(): string {
  const url = flag('url') ?? process.env.SITEWRIGHT_URL;
  if (!url) die('this command requires --url <instance> (or SITEWRIGHT_URL)');
  return url;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  switch (command) {
    case 'login': {
      const url = requireUrl();
      const scope = flag('scope') ?? DEFAULT_SCOPE;
      process.stderr.write('Opening your browser to sign in…\n');
      const tokens = await runLogin({ issuer: url, scope, open: openBrowser });
      process.stdout.write(`Signed in to ${url} (scope: ${tokens.scope || '—'}).\n`);
      return;
    }
    case 'logout': {
      const url = requireUrl();
      clearCredentials(url);
      process.stdout.write(`Logged out of ${url}.\n`);
      return;
    }
    case 'whoami': {
      const url = requireUrl();
      const token = await ensureAccessToken(url);
      const res = await fetch(`${url.replace(/\/+$/, '')}/api-key/self`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) die(`whoami failed: HTTP ${res.status}`);
      process.stdout.write(`${JSON.stringify(await res.json(), null, 2)}\n`);
      return;
    }
    case 'mcp': {
      const url = requireUrl();
      const token = await ensureAccessToken(url);
      const scope = await runStdioBridge({ url, token });
      process.stderr.write(`sitewright mcp: connected to project ${scope.projectId}\n`);
      return;
    }
    default:
      process.stderr.write('Usage: sitewright <login|logout|whoami|mcp> --url <instance>\n');
      process.exit(command ? 1 : 0);
  }
}

main().catch((err) => {
  process.stderr.write(`sitewright: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
