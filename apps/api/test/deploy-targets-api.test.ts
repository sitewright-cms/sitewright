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
  const reg = await app.inject({ method: 'POST', url: '/auth/register', payload: { email, password: 'pw-secret-1' } });
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

  it('deletes a target, and deploy-by-id 409s before publishing', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const base = `/projects/${projectId}`;
    const cookies = { sw_session: t };
    const id = (
      (await app.inject({ method: 'POST', url: `${base}/deploy-targets`, cookies, payload: target })).json() as {
        target: { id: string };
      }
    ).target.id;

    // No published build yet → deploy-by-id is a 409 (not a 500 / connection attempt).
    const early = await app.inject({ method: 'POST', url: `${base}/deploy-targets/${id}/deploy`, cookies });
    expect(early.statusCode).toBe(409);

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

  it('the streaming deploy endpoint enforces the publish-required preflight (409) before hijacking', async () => {
    const { t, projectId } = await setup('a@acme.test');
    const cookies = { sw_session: t };
    const id = (
      (await app.inject({ method: 'POST', url: `/projects/${projectId}/deploy-targets`, cookies, payload: keyTarget })).json() as {
        target: { id: string };
      }
    ).target.id;
    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/deploy-targets/${id}/deploy/stream`, cookies });
    expect(res.statusCode).toBe(409); // a normal JSON error (not a hijacked SSE stream) since no site is published
    expect(res.json()).toMatchObject({ error: expect.stringMatching(/publish the site/i) });
  });
});
