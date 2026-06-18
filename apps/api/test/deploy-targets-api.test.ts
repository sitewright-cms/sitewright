import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';

let app: FastifyInstance;
let publishRoot: string;
const encryptionKey = randomBytes(32);

beforeEach(async () => {
  publishRoot = await mkdtemp(join(tmpdir(), 'sw-dt-'));
  app = await createApp({
    db: await makeTestDb(),
    publishRoot,
    encryptionKey,
    deployAllowedHosts: ['allowed.example.com'],
  });
  await app.ready();
});
afterEach(async () => {
  await rm(publishRoot, { recursive: true, force: true });
});

function token(res: { cookies: Array<{ name: string; value: string }> }): string {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}
async function setup(email: string, slug = 'site') {
  const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { email, password: 'Pw-secret-1' } });
  const t = token(reg);
  const proj = await app.inject({ method: 'POST', url: `/projects`, cookies: { sw_session: t }, payload: { name: 'Site', slug } });
  const projectId = (proj.json() as { project: { id: string } }).project.id;
  return { t, projectId };
}

const target = {
  name: 'Prod webspace',
  protocol: 'sftp',
  host: 'allowed.example.com',
  user: 'deployer',
  password: 'super-secret',
  remoteDir: '/var/www',
};

describe('saved deploy targets', () => {
  it('creates a target (encrypting the password) and never returns the secret', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const base = `/projects/${projectId}`;
    const cookies = { sw_session: t };

    const create = await app.inject({ method: 'POST', url: `${base}/deploy-targets`, cookies, payload: target });
    expect(create.statusCode).toBe(201);
    const created = create.json() as { target: Record<string, unknown> };
    expect(created.target).toMatchObject({ name: 'Prod webspace', protocol: 'sftp', host: 'allowed.example.com' });
    expect(created.target).not.toHaveProperty('secret');
    // The plaintext password must never appear in the response body.
    expect(create.body).not.toContain('super-secret');

    const list = await app.inject({ method: 'GET', url: `${base}/deploy-targets`, cookies });
    const items = (list.json() as { items: Array<Record<string, unknown>> }).items;
    expect(items).toHaveLength(1);
    expect(items[0]).not.toHaveProperty('secret');
    expect(list.body).not.toContain('super-secret');
  });

  it('rejects a target whose host is not allow-listed (SSRF guard)', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/deploy-targets`,
      cookies: { sw_session: t },
      payload: { ...target, host: 'evil.internal' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('creates then deletes a target', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const base = `/projects/${projectId}`;
    const cookies = { sw_session: t };
    const id = (
      (await app.inject({ method: 'POST', url: `${base}/deploy-targets`, cookies, payload: target })).json() as {
        target: { id: string };
      }
    ).target.id;

    const del = await app.inject({ method: 'DELETE', url: `${base}/deploy-targets/${id}`, cookies });
    expect(del.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `${base}/deploy-targets`, cookies })).json()).toMatchObject({ items: [] });
  });

  it('blocks reading and writing deploy_target via the generic content endpoint', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const cookies = { sw_session: t };
    const base = `/projects/${projectId}/content/deploy_target`;
    // Create a real target so there is a secret that must not leak.
    await app.inject({ method: 'POST', url: `/projects/${projectId}/deploy-targets`, cookies, payload: target });

    const write = await app.inject({ method: 'PUT', url: `${base}/x`, cookies, payload: { id: 'x' } });
    expect(write.statusCode).toBe(403);
    // The generic read must be blocked too (it would otherwise return the encrypted secret).
    const readList = await app.inject({ method: 'GET', url: base, cookies });
    expect(readList.statusCode).toBe(403);
    expect(readList.body).not.toContain('"secret"');
  });

  it('isolates targets across tenants', async () => {
    const a = await setup('a@acme.test', 'site-a');
    const b = await setup('b@globex.test', 'site-b');
    await app.inject({ method: 'POST', url: `/projects/${a.projectId}/deploy-targets`, cookies: { sw_session: a.t }, payload: target });
    const bReads = await app.inject({ method: 'GET', url: `/projects/${a.projectId}/deploy-targets`, cookies: { sw_session: b.t } });
    expect(bReads.statusCode).toBe(403);
  });

  // ── SFTP key-file auth ────────────────────────────────────────────────────────────────────────
  const keyTarget = {
    name: 'Key webspace',
    protocol: 'sftp',
    host: 'allowed.example.com',
    user: 'deployer',
    privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXkt\n-----END OPENSSH PRIVATE KEY-----',
    passphrase: 'unlock-me',
    remoteDir: '/var/www',
  };

  it('creates an SFTP target authenticated by a private key (no password) and never leaks the key', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const cookies = { sw_session: t };
    const create = await app.inject({ method: 'POST', url: `/projects/${projectId}/deploy-targets`, cookies, payload: keyTarget });
    expect(create.statusCode).toBe(201);
    expect(create.body).not.toContain('OPENSSH PRIVATE KEY'); // the key never appears in the response
    expect(create.body).not.toContain('unlock-me');
    const created = create.json() as { target: Record<string, unknown> };
    expect(created.target).not.toHaveProperty('secret');
    expect(created.target).not.toHaveProperty('privateKey');
    // It is listed without exposing any credential material.
    const list = await app.inject({ method: 'GET', url: `/projects/${projectId}/deploy-targets`, cookies });
    expect(list.body).not.toContain('OPENSSH PRIVATE KEY');
  });

  it('rejects a private key on a non-SFTP protocol, and a target with neither password nor key', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const cookies = { sw_session: t };
    const ftpKey = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/deploy-targets`,
      cookies,
      payload: { ...keyTarget, protocol: 'ftp' },
    });
    expect(ftpKey.statusCode).toBe(400);
    const neither = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/deploy-targets`,
      cookies,
      payload: { name: 'x', protocol: 'sftp', host: 'allowed.example.com', user: 'u' },
    });
    expect(neither.statusCode).toBe(400);
  });

  it('creates a Local Hosting target (no host/credentials) and refuses to deploy it via the deploy route', async () => {
    const { t, projectId } = await setup('lh@acme.test');
    const base = `/projects/${projectId}`;
    const cookies = { sw_session: t };
    const create = await app.inject({
      method: 'POST',
      url: `${base}/deploy-targets`,
      cookies,
      payload: { name: 'Local Hosting', protocol: 'local', previewToken: 'tok_abcdefgh12345678', minifyHtml: true },
    });
    expect(create.statusCode).toBe(201);
    const view = (create.json() as { target: Record<string, unknown> }).target;
    expect(view.protocol).toBe('local');
    expect(view).not.toHaveProperty('host');
    expect(view).not.toHaveProperty('secret');
    expect(view.previewToken).toBe('tok_abcdefgh12345678');
    expect(view.minifyHtml).toBe(true);
    // At most one Local Hosting target per project → a second create is a 409.
    const dup = await app.inject({ method: 'POST', url: `${base}/deploy-targets`, cookies, payload: { name: 'Another', protocol: 'local' } });
    expect(dup.statusCode).toBe(409);
    // A local target is published via the Publish action, not the deploy route → 400 (defensive guard).
    const dep = await app.inject({ method: 'POST', url: `${base}/deploy-targets/${String(view.id)}/deploy`, cookies });
    expect(dep.statusCode).toBe(400);
  });

  it('creates a git deploy target (repoUrl/branch, token encrypted) and deploys it (build → push)', async () => {
    const { t, projectId } = await setup('git@acme.test');
    const base = `/projects/${projectId}`;
    const cookies = { sw_session: t };
    const create = await app.inject({
      method: 'POST',
      url: `${base}/deploy-targets`,
      cookies,
      payload: { name: 'GitHub Pages', protocol: 'git', repoUrl: 'https://allowed.example.com/acme/site.git', branch: 'gh-pages', token: 'ghp_super_secret_token' },
    });
    expect(create.statusCode).toBe(201);
    const view = (create.json() as { target: Record<string, unknown> }).target;
    expect(view.protocol).toBe('git');
    expect(view.repoUrl).toBe('https://allowed.example.com/acme/site.git');
    expect(view.branch).toBe('gh-pages');
    expect(view).not.toHaveProperty('secret');
    expect(view).not.toHaveProperty('token');
    expect(create.body).not.toContain('ghp_super_secret_token'); // the token never leaks
    // Deploy: the route BUILDS the site fresh, then attempts the git push — which fails on the bogus
    // (non-resolving) host → a generic 502, distinct from the 400 a local target would get.
    const dep = await app.inject({ method: 'POST', url: `${base}/deploy-targets/${String(view.id)}/deploy`, cookies });
    expect(dep.statusCode).toBe(502);
    expect(dep.body).not.toContain('ghp_super_secret_token');
  }, 30_000);

  it('creates an SSH git target (private key encrypted, never leaked) and deploys it (build → push)', async () => {
    const { t, projectId } = await setup('gitssh@acme.test');
    const base = `/projects/${projectId}`;
    const cookies = { sw_session: t };
    const create = await app.inject({
      method: 'POST',
      url: `${base}/deploy-targets`,
      cookies,
      payload: {
        name: 'GitHub Pages (SSH)',
        protocol: 'git',
        repoUrl: 'git@allowed.example.com:acme/site.git', // scp-like ssh remote, host on the allow-list
        branch: 'gh-pages',
        privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nMOCKKEYCONTENTS\n-----END OPENSSH PRIVATE KEY-----',
        passphrase: 'topsecret',
      },
    });
    expect(create.statusCode).toBe(201);
    const view = (create.json() as { target: Record<string, unknown> }).target;
    expect(view.protocol).toBe('git');
    expect(view.repoUrl).toBe('git@allowed.example.com:acme/site.git');
    expect(view).not.toHaveProperty('secret');
    expect(view).not.toHaveProperty('privateKey');
    expect(view).not.toHaveProperty('passphrase');
    expect(create.body).not.toContain('OPENSSH PRIVATE KEY'); // the key never leaks to the client
    expect(create.body).not.toContain('topsecret');
    // Deploy: builds the site, then the SSH push fails (the host won't resolve) → a generic 502, no leak.
    const dep = await app.inject({ method: 'POST', url: `${base}/deploy-targets/${String(view.id)}/deploy`, cookies });
    expect(dep.statusCode).toBe(502);
    expect(dep.body).not.toContain('OPENSSH PRIVATE KEY');
  }, 30_000);

  it('rejects a git target missing repoUrl/branch/credential (400)', async () => {
    const { t, projectId } = await setup('git2@acme.test');
    const cookies = { sw_session: t };
    // git with no token and no key.
    const bad = await app.inject({ method: 'POST', url: `/projects/${projectId}/deploy-targets`, cookies, payload: { name: 'X', protocol: 'git', repoUrl: 'https://allowed.example.com/a/b.git', branch: 'gh-pages' } });
    expect(bad.statusCode).toBe(400);
    // an ssh remote needs a key, not a token.
    const noKey = await app.inject({ method: 'POST', url: `/projects/${projectId}/deploy-targets`, cookies, payload: { name: 'Y', protocol: 'git', repoUrl: 'git@allowed.example.com:a/b.git', branch: 'gh-pages', token: 'ghp_x' } });
    expect(noKey.statusCode).toBe(400);
  });

  it('rejects a git repoUrl that embeds credentials (400 — token belongs in the token field)', async () => {
    const { t, projectId } = await setup('git3@acme.test');
    const cookies = { sw_session: t };
    const bad = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/deploy-targets`,
      cookies,
      payload: { name: 'X', protocol: 'git', repoUrl: 'https://ghp_leak@allowed.example.com/a/b.git', branch: 'gh-pages', token: 'ghp_x' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('the streaming deploy builds first: a bad route graph is a JSON 409 before hijacking', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const cookies = { sw_session: t };
    // Two top-level pages share a route slug → the build's route graph is invalid (author-correctable).
    await app.inject({ method: 'PUT', url: `/projects/${projectId}/content/page/a`, cookies, payload: { id: 'a', path: 'dup', title: 'A', source: '<h1>A</h1>' } });
    await app.inject({ method: 'PUT', url: `/projects/${projectId}/content/page/b`, cookies, payload: { id: 'b', path: 'dup', title: 'B', source: '<h1>B</h1>' } });
    const id = (
      (await app.inject({ method: 'POST', url: `/projects/${projectId}/deploy-targets`, cookies, payload: keyTarget })).json() as {
        target: { id: string };
      }
    ).target.id;
    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/deploy-targets/${id}/deploy/stream`, cookies });
    // The build fails BEFORE hijacking → a normal JSON 409 (not a hijacked SSE stream).
    expect(res.statusCode).toBe(409);
  });
});
