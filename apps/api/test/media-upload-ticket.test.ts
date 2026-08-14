import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';

/**
 * UPLOAD TICKETS — how an MCP agent gets a LOCAL file into the media library.
 *
 * The agent has files on its own disk and no way to hand one over: `import_image` takes a PUBLIC url
 * the SERVER fetches, and the multipart route needs the bearer token, which the MCP client holds and
 * the model never sees. Base64 in a tool argument fails on arithmetic — the MODEL would have to emit
 * the bytes, ~370k tokens for a 1MB image. So: mint a one-shot URL, curl the file to it.
 *
 * The ticket IS the credential, so what is tested here is mostly what it REFUSES.
 */

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==',
  'base64',
);

let app: FastifyInstance;
let db: Awaited<ReturnType<typeof makeTestDb>>;
let mediaRoot: string;

beforeEach(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), 'sw-upload-ticket-'));
  db = await makeTestDb();
  app = await createApp({ db, mediaRoot });
  await app.ready();
});
afterEach(async () => {
  await rm(mediaRoot, { recursive: true, force: true });
});

const sessionOf = (res: { cookies: Array<{ name: string; value: string }> }): string => {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
};

async function setup(email: string, slug = 'site') {
  await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'developer' });
  const t = sessionOf(await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } }));
  const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'Site', slug } });
  return { t, projectId: (proj.json() as { project: { id: string } }).project.id, slug };
}

const mint = (t: string, projectId: string, body: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url: `/projects/${projectId}/media/upload-ticket`, cookies: { sw_session: t }, payload: body });

const redeem = (path: string, filename: string, body: Buffer) =>
  app.inject({ method: 'PUT', url: `${path}?filename=${encodeURIComponent(filename)}`, payload: body, headers: { 'content-type': 'application/octet-stream' } });

describe('media upload tickets', () => {
  it('mints a ticket and stores the bytes PUT to it, as a real optimized asset', async () => {
    const { t, projectId } = await setup('tick@e.test');
    const res = await mint(t, projectId, { folder: 'Logos' });
    expect(res.statusCode).toBe(201);
    const { uploadPath, expiresInSeconds, maxBytes } = res.json() as { uploadPath: string; expiresInSeconds: number; maxBytes: number };
    expect(uploadPath).toMatch(/^\/media-upload\/[0-9a-f-]{36}$/);
    expect(expiresInSeconds).toBeGreaterThan(0);
    expect(maxBytes).toBeGreaterThan(0);

    const up = await redeem(uploadPath, 'logo.png', PNG_1X1);
    expect(up.statusCode).toBe(201);
    const item = (up.json() as { item: { url: string; kind: string; folder?: string } }).item;
    expect(item.kind).toBe('image'); // it went through the SAME pipeline as a multipart upload
    expect(item.url).toContain('/media/');
    // The folder is pinned by the TICKET, not sent with the bytes — the holder chooses bytes only.
    expect(item.folder).toBe('Logos');

    // …and it is really in the library.
    const list = await app.inject({ method: 'GET', url: `/projects/${projectId}/media`, cookies: { sw_session: t } });
    expect((list.json() as { items: unknown[] }).items).toHaveLength(1);
  });

  it('★ is SINGLE-USE — a replay is indistinguishable from an unknown token', async () => {
    const { t, projectId } = await setup('once@e.test');
    const { uploadPath } = (await mint(t, projectId)).json() as { uploadPath: string };
    expect((await redeem(uploadPath, 'a.png', PNG_1X1)).statusCode).toBe(201);

    const replay = await redeem(uploadPath, 'b.png', PNG_1X1);
    expect(replay.statusCode).toBe(404);
    // The message must not reveal whether the token ever existed, or it becomes an oracle.
    const unknown = await redeem('/media-upload/11111111-2222-3333-4444-555555555555', 'b.png', PNG_1X1);
    expect(unknown.statusCode).toBe(404);
    expect(replay.json()).toEqual(unknown.json());
  });

  it('needs no session — the ticket IS the credential', async () => {
    const { t, projectId } = await setup('nosession@e.test');
    const { uploadPath } = (await mint(t, projectId)).json() as { uploadPath: string };
    // No cookie, no bearer: exactly the position an agent's curl is in.
    const up = await redeem(uploadPath, 'x.png', PNG_1X1);
    expect(up.statusCode).toBe(201);
  });

  it('minting it DOES need authorization, and content:write', async () => {
    const { projectId } = await setup('owner@e.test');
    expect((await app.inject({ method: 'POST', url: `/projects/${projectId}/media/upload-ticket`, payload: {} })).statusCode).toBe(401);

    // A member of ANOTHER project cannot mint for this one.
    const other = await setup('stranger@e.test', 'other');
    expect((await mint(other.t, projectId)).statusCode).toBe(403);
  });

  it('★ re-checks membership at REDEEM time, so a removed member cannot still write', async () => {
    const { t, projectId } = await setup('leaver@e.test');
    const { uploadPath } = (await mint(t, projectId)).json() as { uploadPath: string };
    // Authorization should be CURRENT. Pinning the role into the ticket would have bought a window in
    // which a just-removed member could still write to the project.
    await db.run?.('DELETE FROM project_members');
    const up = await redeem(uploadPath, 'x.png', PNG_1X1);
    expect(up.statusCode).toBe(404);
  });

  it('names the asset from ?filename= and refuses to escape the library with a path', async () => {
    const { t, projectId } = await setup('names@e.test');
    const { uploadPath } = (await mint(t, projectId)).json() as { uploadPath: string };
    // A raw PUT carries no filename, so it rides in the query — and a path there must not traverse.
    const up = await redeem(uploadPath, '../../etc/passwd.png', PNG_1X1);
    expect(up.statusCode).toBe(201);
    const item = (up.json() as { item: { filename?: string; url: string } }).item;
    expect(item.url).not.toContain('..');
    expect(String(item.filename ?? '')).not.toContain('/');
  });

  it('rejects an empty body rather than storing a 0-byte asset', async () => {
    const { t, projectId } = await setup('empty@e.test');
    const { uploadPath } = (await mint(t, projectId)).json() as { uploadPath: string };
    const up = await app.inject({ method: 'PUT', url: `${uploadPath}?filename=x.png`, payload: Buffer.alloc(0), headers: { 'content-type': 'application/octet-stream' } });
    expect(up.statusCode).toBe(400);
  });

  it('derives the type from the FILENAME, not the client-chosen content-type header', async () => {
    const { t, projectId } = await setup('mime@e.test');
    const { uploadPath } = (await mint(t, projectId)).json() as { uploadPath: string };
    // The header is attacker-chosen on this route in a way it is not on the session-authenticated one.
    const up = await app.inject({
      method: 'PUT',
      url: `${uploadPath}?filename=real.png`,
      payload: PNG_1X1,
      headers: { 'content-type': 'text/html' },
    });
    expect(up.statusCode).toBe(201);
    expect((up.json() as { item: { kind: string } }).item.kind).toBe('image');
  });
});
