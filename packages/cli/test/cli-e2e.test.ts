import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runLogin } from '../src/login.js';
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
  let orgId = '';
  let projectId = '';

  beforeAll(async () => {
    configDir = mkdtempSync(join(tmpdir(), 'sw-cli-e2e-'));
    process.env.SITEWRIGHT_CONFIG_DIR = configDir;
    const url = BASE_URL!;
    const stamp = Date.now();
    const reg = await fetch(`${url}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `cli-${stamp}@e2e.test`, password: 'pw-secret-1', orgName: `CLI ${stamp}` }),
    });
    cookie = (reg.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    orgId = ((await reg.json()) as { orgId: string }).orgId;
    const proj = await fetch(`${url}/orgs/${orgId}/projects`, {
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
        project: `${orgId}:${projectId}`,
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
});
