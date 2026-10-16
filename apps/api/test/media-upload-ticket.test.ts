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
/** A "font" by magic bytes — all the upload dispatcher looks at. */
const WOFF2 = Buffer.concat([Buffer.from('wOF2'), Buffer.from('x')]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');

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

  it('a font ticket with no metadata keeps the old guess: family from the filename, weight 400', async () => {
    const { t, projectId } = await setup('fontguess@e.test');
    const { uploadPath } = (await mint(t, projectId)).json() as { uploadPath: string };
    const up = await redeem(uploadPath, 'Inter-Bold.woff2', WOFF2);
    expect(up.statusCode).toBe(201);
    expect((up.json() as { item: unknown }).item).toMatchObject({ kind: 'font', family: 'Inter-Bold', files: [{ weight: 400, style: 'normal' }] });
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

/**
 * BATCH tickets, ALT text and FONT metadata. An agent building a site with 78 photos made 78 mint
 * calls, and every photo landed with no alt — so every `{{#sw-folder}}` gallery shipped `alt=""` — and
 * a dropped font became family "<filename stem>", weight 400, with nothing able to say otherwise.
 * All three ride the ticket now: pinned at MINT time, by the authenticated caller, like the folder.
 */
describe('media upload tickets — batches, alt text and font metadata', () => {
  type Grant = { uploadPath?: string; tickets: Array<{ uploadPath: string; alt?: string }>; expiresInSeconds: number; maxBytes: number };

  it('mints `count` single-use tickets in ONE call, all pinned to the same folder', async () => {
    const { t, projectId } = await setup('batch@e.test');
    const res = await mint(t, projectId, { folder: 'Gallery', count: 3 });
    expect(res.statusCode).toBe(201);
    const grant = res.json() as Grant;
    expect(grant.tickets).toHaveLength(3);
    // A batch has no single top-level path to mistake for "the" ticket.
    expect(grant.uploadPath).toBeUndefined();
    expect(new Set(grant.tickets.map((x) => x.uploadPath)).size).toBe(3);

    for (const [i, ticket] of grant.tickets.entries()) {
      const up = await redeem(ticket.uploadPath, `photo-${i}.png`, PNG_1X1);
      expect(up.statusCode).toBe(201);
      expect((up.json() as { item: { folder: string } }).item.folder).toBe('Gallery');
    }
    // Each is still single-use.
    expect((await redeem(grant.tickets[0]!.uploadPath, 'again.png', PNG_1X1)).statusCode).toBe(404);
  });

  it('a single mint keeps its old shape, with the one ticket also listed', async () => {
    const { t, projectId } = await setup('single@e.test');
    const grant = (await mint(t, projectId)).json() as Grant;
    expect(grant.uploadPath).toMatch(/^\/media-upload\//);
    expect(grant.tickets).toEqual([{ uploadPath: grant.uploadPath }]);
  });

  it('★ bakes `alt` into the asset at redemption — the gallery binds it with no second call', async () => {
    const { t, projectId } = await setup('alt@e.test');
    const grant = (await mint(t, projectId, { alt: 'The orchard in spring' })).json() as Grant;
    expect(grant.tickets[0]!.alt).toBe('The orchard in spring');
    const up = await redeem(grant.uploadPath!, 'orchard.png', PNG_1X1);
    expect(up.statusCode).toBe(201);
    expect((up.json() as { item: { alt?: string } }).item.alt).toBe('The orchard in spring');
  });

  it('`alts` gives every ticket in a batch its OWN alt, echoed beside its upload path', async () => {
    const { t, projectId } = await setup('alts@e.test');
    const grant = (await mint(t, projectId, { alts: ['First photo', 'Second photo'] })).json() as Grant;
    // count defaults to alts.length, and the echo makes the file↔ticket pairing explicit.
    expect(grant.tickets.map((x) => x.alt)).toEqual(['First photo', 'Second photo']);
    const second = await redeem(grant.tickets[1]!.uploadPath, 'b.png', PNG_1X1);
    expect((second.json() as { item: { alt?: string } }).item.alt).toBe('Second photo');
    const first = await redeem(grant.tickets[0]!.uploadPath, 'a.png', PNG_1X1);
    expect((first.json() as { item: { alt?: string } }).item.alt).toBe('First photo');
  });

  it('an empty entry in `alts` is a placeholder — that ticket\'s file is born undescribed', async () => {
    const { t, projectId } = await setup('altsempty@e.test');
    const grant = (await mint(t, projectId, { alts: ['', 'Described'] })).json() as Grant;
    expect(grant.tickets[0]).toEqual({ uploadPath: grant.tickets[0]!.uploadPath });
    const up = await redeem(grant.tickets[0]!.uploadPath, 'a.png', PNG_1X1);
    expect((up.json() as { item: Record<string, unknown> }).item).not.toHaveProperty('alt');
  });

  it('alt reaches SVG and download-only files too, not just raster images', async () => {
    const { t, projectId } = await setup('altkinds@e.test');
    const grant = (await mint(t, projectId, { alts: ['Company logo', 'Annual report'] })).json() as Grant;
    const svg = await redeem(grant.tickets[0]!.uploadPath, 'logo.svg', SVG);
    expect(svg.statusCode).toBe(201);
    expect((svg.json() as { item: { alt?: string; kind: string } }).item).toMatchObject({ kind: 'image', alt: 'Company logo' });
    const pdf = await redeem(grant.tickets[1]!.uploadPath, 'report.pdf', Buffer.from('%PDF-1.4 hello'));
    expect(pdf.statusCode).toBe(201);
    expect((pdf.json() as { item: { alt?: string; kind: string } }).item).toMatchObject({ kind: 'file', alt: 'Annual report' });
  });

  it('alt reaches a playable video too', async () => {
    const { t, projectId } = await setup('altvideo@e.test');
    const grant = (await mint(t, projectId, { alt: 'Drone flight over the farm' })).json() as Grant;
    const up = await redeem(grant.uploadPath!, 'farm.mp4', Buffer.from('not really a video but stored as one'));
    expect(up.statusCode).toBe(201);
    expect((up.json() as { item: { alt?: string; kind: string } }).item).toMatchObject({ kind: 'video', alt: 'Drone flight over the farm' });
  });

  it('refuses an alt/alts/count combination that would not say which file gets which alt', async () => {
    const { t, projectId } = await setup('altrules@e.test');
    // `alt` names ONE file.
    const shared = await mint(t, projectId, { alt: 'Same for all', count: 3 });
    expect(shared.statusCode).toBe(400);
    expect((shared.json() as { error: string }).error).toMatch(/alts/);
    expect((await mint(t, projectId, { alt: 'x', alts: ['y'] })).statusCode).toBe(400);
    // One alt per ticket — no more, no less.
    const short = await mint(t, projectId, { alts: ['a', 'b'], count: 3 });
    expect(short.statusCode).toBe(400);
    expect((short.json() as { error: string }).error).toMatch(/2 .* 3/);
  });

  it('bounds the batch: 1..50 tickets, alts at most 500 characters each', async () => {
    const { t, projectId } = await setup('bounds@e.test');
    expect((await mint(t, projectId, { count: 0 })).statusCode).toBe(400);
    expect((await mint(t, projectId, { count: 51 })).statusCode).toBe(400);
    expect((await mint(t, projectId, { alt: 'x'.repeat(501) })).statusCode).toBe(400);
    expect((await mint(t, projectId, { count: 50 })).statusCode).toBe(201);
  });

  it('★ a project cannot hold more than 200 live tickets — a batch is budgeted as a whole', async () => {
    // Batches are what make this reachable: 30 mints a minute used to mean 30 tickets; at 50 a call one
    // project could flush every other tenant's tickets out of the shared store. Each PUT is still bound
    // by the redemption route's own limit — this caps what can be OUTSTANDING.
    const { t, projectId } = await setup('budget@e.test');
    for (let i = 0; i < 4; i += 1) expect((await mint(t, projectId, { count: 50 })).statusCode).toBe(201);
    const over = await mint(t, projectId);
    expect(over.statusCode).toBe(429);
    expect((over.json() as { error: string }).error).toMatch(/200/);
    // Another project's budget is its own.
    const other = await setup('budget2@e.test', 'other');
    expect((await mint(other.t, other.projectId, { count: 50 })).statusCode).toBe(201);
  });

  it('★ font metadata on the ticket is applied when the file is a font', async () => {
    const { t, projectId } = await setup('fontmeta@e.test');
    const grant = (await mint(t, projectId, { family: 'Inter', weight: 700, style: 'italic', fallback: 'serif' })).json() as Grant;
    const up = await redeem(grant.uploadPath!, 'Inter-BoldItalic.woff2', WOFF2);
    expect(up.statusCode).toBe(201);
    expect((up.json() as { item: unknown }).item).toMatchObject({
      kind: 'font',
      family: 'Inter',
      fallback: 'serif',
      files: [{ weight: 700, style: 'italic', format: 'woff2' }],
    });
  });

  it('weight alone keeps the filename-derived family', async () => {
    const { t, projectId } = await setup('fontweight@e.test');
    const grant = (await mint(t, projectId, { weight: 300 })).json() as Grant;
    const up = await redeem(grant.uploadPath!, 'Lato.woff2', WOFF2);
    expect((up.json() as { item: unknown }).item).toMatchObject({ family: 'Lato', files: [{ weight: 300 }] });
  });

  it('font metadata is validated at MINT, where the agent can see the error', async () => {
    const { t, projectId } = await setup('fontbad@e.test');
    expect((await mint(t, projectId, { weight: 450 })).statusCode).toBe(400);
    expect((await mint(t, projectId, { family: 'x";}body{' })).statusCode).toBe(400);
    expect((await mint(t, projectId, { style: 'oblique' })).statusCode).toBe(400);
    expect((await mint(t, projectId, { fallback: 'fantasy' })).statusCode).toBe(400);
  });

  it('a REPLACE ticket takes nothing but its asset id', async () => {
    const { t, projectId } = await setup('replaceonly@e.test');
    const { uploadPath } = (await mint(t, projectId)).json() as { uploadPath: string };
    const asset = (await redeem(uploadPath, 'a.png', PNG_1X1)).json() as { item: { id: string } };
    expect((await mint(t, projectId, { replaceAssetId: asset.item.id, count: 2 })).statusCode).toBe(400);
    expect((await mint(t, projectId, { replaceAssetId: asset.item.id, alt: 'x' })).statusCode).toBe(400);
    expect((await mint(t, projectId, { replaceAssetId: asset.item.id, weight: 700 })).statusCode).toBe(400);
    expect((await mint(t, projectId, { replaceAssetId: asset.item.id })).statusCode).toBe(201);
  });
});
