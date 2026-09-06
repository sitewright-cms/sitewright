import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import type { Database } from '../src/db/client.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';
import { RenderPool } from '../src/render/render-pool.js';

const workerPath = fileURLToPath(new URL('./fixtures/blocks-render-worker.mjs', import.meta.url));
let app: FastifyInstance;
let db: Database;

beforeEach(async () => {
  db = await makeTestDb();
  app = await createApp({ db, renderPool: new RenderPool({ size: 1, workerPath }) });
});
afterEach(async () => {
  await app.close();
});

async function session(email: string): Promise<string> {
  await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'developer' });
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } });
  const t = login.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}
async function project(t: string, slug: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'Site', slug } });
  return (res.json() as { project: { id: string } }).project.id;
}
const page = (source: string) => ({ id: 'home', path: '', title: 'Home', source });

describe('content optimistic concurrency (If-Match)', () => {
  it('GET hands out a version; the matching write succeeds and returns the NEW one', async () => {
    const t = await session('a@e2e.test');
    const id = await project(t, 'occ-happy');
    await app.inject({ method: 'PUT', url: `/projects/${id}/content/page/home`, cookies: { sw_session: t }, payload: page('<div>one</div>') });

    const read = await app.inject({ method: 'GET', url: `/projects/${id}/content/page/home`, cookies: { sw_session: t } });
    const version = (read.json() as { version: string }).version;
    expect(version).toMatch(/^[0-9a-f]{32}$/);
    expect(read.headers.etag).toBe(`"${version}"`);

    const write = await app.inject({
      method: 'PUT',
      url: `/projects/${id}/content/page/home`,
      cookies: { sw_session: t },
      headers: { 'if-match': version },
      payload: page('<div>two</div>'),
    });
    expect(write.statusCode).toBe(200);
    const next = (write.json() as { version: string }).version;
    expect(next).not.toBe(version);
    // The returned token is immediately usable — a client can chain writes with no re-read.
    const chained = await app.inject({
      method: 'PUT',
      url: `/projects/${id}/content/page/home`,
      cookies: { sw_session: t },
      headers: { 'if-match': next },
      payload: page('<div>three</div>'),
    });
    expect(chained.statusCode).toBe(200);
  });

  it('REFUSES the stale write that would silently clobber — the reported bug', async () => {
    const t = await session('b@e2e.test');
    const id = await project(t, 'occ-clobber');
    await app.inject({ method: 'PUT', url: `/projects/${id}/content/page/home`, cookies: { sw_session: t }, payload: page('<div>original</div>') });

    // The operator opens the page: their editor holds this version.
    const opened = await app.inject({ method: 'GET', url: `/projects/${id}/content/page/home`, cookies: { sw_session: t } });
    const operatorVersion = (opened.json() as { version: string }).version;

    // An agent rewrites it while that tab sits open (no If-Match — an agent write today).
    await app.inject({ method: 'PUT', url: `/projects/${id}/content/page/home`, cookies: { sw_session: t }, payload: page('<div>AGENT WORK</div>') });

    // The operator saves their stale buffer. Previously this silently won.
    const stale = await app.inject({
      method: 'PUT',
      url: `/projects/${id}/content/page/home`,
      cookies: { sw_session: t },
      headers: { 'if-match': operatorVersion },
      payload: page('<div>stale operator buffer</div>'),
    });
    expect(stale.statusCode).toBe(409);
    const body = stale.json() as { code: string; kind: string; entityId: string; expected: string; actual: string };
    expect(body.code).toBe('version_conflict');
    expect(body.kind).toBe('page');
    expect(body.entityId).toBe('home');
    expect(body.expected).toBe(operatorVersion);
    expect(body.actual).not.toBe(operatorVersion);

    // ★ The agent's work survived.
    const after = await app.inject({ method: 'GET', url: `/projects/${id}/content/page/home`, cookies: { sw_session: t } });
    expect((after.json() as { item: { source: string } }).item.source).toContain('AGENT WORK');
  });

  it('409s when the entity was DELETED underneath the writer', async () => {
    const t = await session('c@e2e.test');
    const id = await project(t, 'occ-deleted');
    await app.inject({ method: 'PUT', url: `/projects/${id}/content/snippet/band`, cookies: { sw_session: t }, payload: { id: 'band', name: 'band', source: '<p>v1</p>' } });
    const read = await app.inject({ method: 'GET', url: `/projects/${id}/content/snippet/band`, cookies: { sw_session: t } });
    const version = (read.json() as { version: string }).version;
    await app.inject({ method: 'DELETE', url: `/projects/${id}/content/snippet/band`, cookies: { sw_session: t } });

    const res = await app.inject({
      method: 'PUT',
      url: `/projects/${id}/content/snippet/band`,
      cookies: { sw_session: t },
      headers: { 'if-match': version },
      payload: { id: 'band', name: 'band', source: '<p>v2</p>' },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { actual: string | null }).actual).toBeNull();
    expect((res.json() as { error: string }).error).toMatch(/DELETED/);
  });

  it('guards a ?merge=1 PATCH too, and settings (the biggest blast radius)', async () => {
    const t = await session('d@e2e.test');
    const id = await project(t, 'occ-merge');
    const read = await app.inject({ method: 'GET', url: `/projects/${id}/content/settings/settings`, cookies: { sw_session: t } });
    const version = (read.json() as { version: string }).version;
    // Something else writes settings first.
    await app.inject({
      method: 'PUT',
      url: `/projects/${id}/content/settings/settings?merge=1`,
      cookies: { sw_session: t },
      payload: { website: { containerWidth: '1100px' } },
    });
    const res = await app.inject({
      method: 'PUT',
      url: `/projects/${id}/content/settings/settings?merge=1`,
      cookies: { sw_session: t },
      headers: { 'if-match': version },
      payload: { website: { containerWidth: '900px' } },
    });
    expect(res.statusCode).toBe(409);
  });

  it('an IMAGEMAP is sanitized at rest — the version must describe the STORED bytes, not the input', async () => {
    const t = await session('img@e2e.test');
    const id = await project(t, 'occ-imagemap');
    // A tooltip block's `text` is authored markup that sanitizeImageMapConfig rewrites on the way in,
    // so the stored bytes differ from what was sent. If the version were hashed from the INPUT, the
    // very next save would 409 against itself with no other writer involved.
    const map = {
      id: 'plan',
      general: { name: 'Plan' },
      artboards: [
        {
          id: 'ab1',
          title: 'Ground',
          background_type: 'image',
          image_url: '/media/site/abc123-plan.png',
          width: 1600,
          height: 900,
          // A YouTube block's `embedCode` is authored markup: sanitizeRichHtml FORCES a sandbox onto
          // the iframe on the way IN, so the stored bytes differ from what is sent here.
          children: [
            {
              id: 'p1',
              title: 'Wing',
              type: 'rect',
              x: 10,
              y: 10,
              width: 20,
              height: 20,
              tooltip_content: [{ type: 'YouTube', embedCode: '<iframe src="https://www.youtube.com/embed/abc"></iframe>' }],
            },
          ],
        },
      ],
    };
    const first = await app.inject({ method: 'PUT', url: `/projects/${id}/content/imagemap/plan`, cookies: { sw_session: t }, payload: map });
    expect(first.statusCode, JSON.stringify(first.json())).toBe(200);
    const writeVersion = (first.json() as { version: string }).version;

    // The version handed back by the WRITE must equal the one a fresh READ reports.
    const read = await app.inject({ method: 'GET', url: `/projects/${id}/content/imagemap/plan`, cookies: { sw_session: t } });
    expect((read.json() as { version: string }).version).toBe(writeVersion);

    // …and saving again with it must succeed rather than conflict with itself.
    const second = await app.inject({
      method: 'PUT',
      url: `/projects/${id}/content/imagemap/plan`,
      cookies: { sw_session: t },
      headers: { 'if-match': writeVersion },
      payload: map,
    });
    expect(second.statusCode).toBe(200);
  });

  it('is opt-in: no If-Match keeps the old last-write-wins behaviour, and `*` means "any"', async () => {
    const t = await session('e@e2e.test');
    const id = await project(t, 'occ-optin');
    await app.inject({ method: 'PUT', url: `/projects/${id}/content/page/home`, cookies: { sw_session: t }, payload: page('<div>one</div>') });
    const bare = await app.inject({ method: 'PUT', url: `/projects/${id}/content/page/home`, cookies: { sw_session: t }, payload: page('<div>two</div>') });
    expect(bare.statusCode).toBe(200);
    const star = await app.inject({
      method: 'PUT',
      url: `/projects/${id}/content/page/home`,
      cookies: { sw_session: t },
      headers: { 'if-match': '*' },
      payload: page('<div>three</div>'),
    });
    expect(star.statusCode).toBe(200);
  });

  it('accepts a quoted / weak ETag exactly as an HTTP client would send it back', async () => {
    const t = await session('f@e2e.test');
    const id = await project(t, 'occ-etag');
    await app.inject({ method: 'PUT', url: `/projects/${id}/content/page/home`, cookies: { sw_session: t }, payload: page('<div>one</div>') });
    const read = await app.inject({ method: 'GET', url: `/projects/${id}/content/page/home`, cookies: { sw_session: t } });
    const etag = read.headers.etag as string; // already quoted
    const res = await app.inject({
      method: 'PUT',
      url: `/projects/${id}/content/page/home`,
      cookies: { sw_session: t },
      headers: { 'if-match': `W/${etag}` },
      payload: page('<div>two</div>'),
    });
    expect(res.statusCode).toBe(200);
  });
});
