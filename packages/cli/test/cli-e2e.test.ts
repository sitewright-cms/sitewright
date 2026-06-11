import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLogin } from '../src/login.js';
import { runDeviceLogin } from '../src/device.js';
import { loadCredentials } from '../src/credentials.js';
import { ensureAccessToken } from '../src/session.js';

// End-to-end against a live instance: runs the REAL loopback + PKCE login (the CLI
// loopback server, the OAuth server, the token exchange, the credential store),
// then proves the stored token works. The injected `open` drives consent over HTTP
// with a session cookie — exactly what a browser would do — so no browser is needed.
// Run: SW_CLI_E2E_URL=http://dind.local:2003 vitest run test/cli-e2e.test.ts
const BASE_URL = process.env.SW_CLI_E2E_URL;
const suite = BASE_URL ? describe : describe.skip;

suite('sitewright login — end to end', () => {
  let configDir: string;
  let cookie = '';
  let projectId = '';

  beforeAll(async () => {
    configDir = mkdtempSync(join(tmpdir(), 'sw-cli-e2e-'));
    process.env.SITEWRIGHT_CONFIG_DIR = configDir;
    const url = BASE_URL!;
    const stamp = Date.now();
    const reg = await fetch(`${url}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `cli-${stamp}@e2e.test`, password: 'Pw-secret-1' }),
    });
    cookie = (reg.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const proj = await fetch(`${url}/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: 'CLI Site', slug: `cli-${stamp}` }),
    });
    projectId = ((await proj.json()) as { project: { id: string } }).project.id;
  });

  afterAll(() => {
    delete process.env.SITEWRIGHT_CONFIG_DIR;
    rmSync(configDir, { recursive: true, force: true });
  });

  it('logs in via the loopback flow, stores tokens, and the access token works', async () => {
    const url = BASE_URL!;
    // Drive the consent the way a browser would: POST approve, then hit the
    // loopback redirect so the CLI's local server captures the code.
    const open = async (authorizeUrl: string) => {
      const p = new URL(authorizeUrl).searchParams;
      const form = new URLSearchParams({
        client_id: p.get('client_id')!,
        redirect_uri: p.get('redirect_uri')!,
        response_type: 'code',
        code_challenge: p.get('code_challenge')!,
        code_challenge_method: 'S256',
        scope: p.get('scope')!,
        state: p.get('state')!,
        project: projectId,
        decision: 'approve',
      });
      const res = await fetch(`${url}/oauth/authorize`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
        body: form.toString(),
        redirect: 'manual',
      });
      const loc = res.headers.get('location');
      if (!loc) throw new Error(`no redirect from consent (status ${res.status})`);
      await fetch(loc); // → the CLI loopback server captures the code
    };

    const tokens = await runLogin({ issuer: url, scope: 'content:read content:write', open });
    expect(tokens.accessToken).toMatch(/^swk_/);
    expect(loadCredentials(url)?.refreshToken).toBe(tokens.refreshToken);

    // The stored access token authenticates a real API call.
    const access = await ensureAccessToken(url);
    const whoami = await fetch(`${url}/api-key/self`, { headers: { authorization: `Bearer ${access}` } });
    expect(whoami.status).toBe(200);
    expect(((await whoami.json()) as { projectId: string }).projectId).toBe(projectId);
  });

  it('logs in via the device grant (poll → approve → tokens)', async () => {
    const url = BASE_URL!;
    // Approve in a "browser" the moment the CLI shows the user code.
    const approve = async (userCode: string) => {
      await fetch(`${url}/oauth/device`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
        body: new URLSearchParams({ user_code: userCode, project: projectId, decision: 'approve' }).toString(),
      });
    };
    const tokens = await runDeviceLogin({
      issuer: url,
      scope: 'content:read content:write',
      prompt: (auth) => {
        void approve(auth.userCode);
      },
      sleep: () => new Promise((r) => setTimeout(r, 50)), // poll fast in the test
    });
    expect(tokens.accessToken).toMatch(/^swk_/);
    const whoami = await fetch(`${url}/api-key/self`, { headers: { authorization: `Bearer ${tokens.accessToken}` } });
    expect(whoami.status).toBe(200);
  });

  // Spawns the REAL built bin (not runDeviceLogin in-process) — the only way to catch the regression
  // where an unref'd poll-sleep timer let the process exit 0 during the first sleep, before it ever
  // polled or persisted a token. An in-process test can't see it (vitest keeps the loop alive).
  it('the built `login --device` bin keeps the process alive and persists the token', async () => {
    const url = BASE_URL!;
    const bin = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
    const subConfig = mkdtempSync(join(tmpdir(), 'sw-cli-sub-'));
    const child = spawn('node', [bin, 'login', '--device', '--url', url], {
      env: { ...process.env, SITEWRIGHT_CONFIG_DIR: subConfig },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      let out = '';
      child.stdout.on('data', (d: Buffer) => (out += d.toString()));
      child.stderr.on('data', (d: Buffer) => (out += d.toString()));
      let exited: number | null = null;
      child.on('exit', (code) => (exited = code));

      // Approve the moment the user code appears (simulating the browser); fail if the bin dies first.
      const code = await new Promise<string>((resolve, reject) => {
        const timer = setInterval(() => {
          const m = out.match(/[A-Z0-9]{4}-[A-Z0-9]{4}/);
          if (m) {
            clearInterval(timer);
            resolve(m[0]);
          } else if (exited !== null) {
            clearInterval(timer);
            reject(new Error(`bin exited (code ${exited}) before showing a code:\n${out}`));
          }
        }, 50);
      });
      await fetch(`${url}/oauth/device`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
        body: new URLSearchParams({ user_code: code, project: projectId, decision: 'approve' }).toString(),
      });
      const exitCode = await new Promise<number>((resolve) =>
        exited !== null ? resolve(exited) : child.on('exit', (c) => resolve(c ?? -1)),
      );
      expect(exitCode).toBe(0);
      // The crucial check: the SUBPROCESS persisted a token (it didn't exit early during the sleep).
      const credsPath = join(subConfig, 'credentials.json');
      expect(existsSync(credsPath)).toBe(true);
      expect(readFileSync(credsPath, 'utf8')).toContain('swk_');
    } finally {
      child.kill();
      rmSync(subConfig, { recursive: true, force: true });
    }
  }, 30_000);

  // The headline PR-1 behavior end-to-end: `sitewright mcp` boots with NO credentials, speaks MCP
  // over stdio, reports unauthenticated, and the `login` tool starts a REAL device grant on the
  // deployed instance (returning a live verification URL + user code).
  it('`sitewright mcp` boots without credentials; login starts a real device grant', async () => {
    const url = BASE_URL!;
    const bin = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
    const subConfig = mkdtempSync(join(tmpdir(), 'sw-mcp-lazy-'));
    const child = spawn('node', [bin, 'mcp', '--url', url], {
      env: { ...process.env, SITEWRIGHT_CONFIG_DIR: subConfig },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const pending = new Map<number, (m: { result: { content: Array<{ text: string }>; serverInfo?: { name: string } } }) => void>();
    let buf = '';
    child.stdout.on('data', (d: Buffer) => {
      buf += d.toString();
      for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const m = JSON.parse(line) as { id?: number; result?: unknown };
          if (typeof m.id === 'number' && pending.has(m.id)) {
            pending.get(m.id)!(m as never);
            pending.delete(m.id);
          }
        } catch {
          /* non-JSON stdout line — ignore */
        }
      }
    });
    const rpc = (id: number, method: string, params: unknown): Promise<{ result: { content: Array<{ text: string }>; serverInfo?: { name: string } } }> =>
      new Promise((resolve, reject) => {
        pending.set(id, resolve);
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
        setTimeout(() => reject(new Error(`rpc ${method} timed out`)), 10_000);
      });
    try {
      const init = await rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } });
      expect(init.result.serverInfo?.name).toBe('sitewright');
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

      const scope = await rpc(2, 'tools/call', { name: 'get_scope', arguments: {} });
      expect(scope.result.content[0]!.text).toContain('"authenticated": false');

      const login = await rpc(3, 'tools/call', { name: 'login', arguments: {} });
      const loginText = login.result.content[0]!.text;
      expect(loginText).toContain('"status": "awaiting_approval"');
      expect(loginText).toContain('/oauth/device'); // a real verification URL from the deployed API
      expect(loginText).toMatch(/[A-Z0-9]{4}-[A-Z0-9]{4}/); // a live device user code
    } finally {
      child.kill();
      rmSync(subConfig, { recursive: true, force: true });
    }
  }, 30_000);
});
