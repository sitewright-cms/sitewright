import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';
import { RenderPool } from '../src/render/render-pool.js';

// A THIRD typeface — a mono for captions beside the heading/body slots. Two agents went looking for one:
// one set `identity.typography.fontFamilies.mono` (which only NAMES a family and ships no file) and
// hand-wrote @font-face into criticalCss; the other reported "the third font never loaded and had no
// fallback". The platform already had the right route — a NAMED slot backed by a self-hosted asset — so
// this file first PROVES that route end to end, the way an agent drives it, and then pins the two things
// that make it findable: a fallback on a bare fontFamilies stack, and a warning in the write result.

const workerPath = fileURLToPath(new URL('./fixtures/blocks-render-worker.mjs', import.meta.url));
let app: FastifyInstance;
let db: Awaited<ReturnType<typeof makeTestDb>>;
let mediaRoot: string;

beforeEach(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), 'sw-thirdfont-'));
  db = await makeTestDb();
  app = await createApp({ db, mediaRoot, renderPool: new RenderPool({ size: 1, workerPath }) });
  await app.ready();
  // Google's css2 + font bytes, so select_google_font runs offline. One @font-face per requested weight.
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('css2')) {
      const weights = (url.match(/wght@([\d;]+)/)?.[1] ?? '400').split(';');
      const css = weights
        .map((w) => `@font-face{font-family:'JetBrains Mono';font-weight:${w};src:url(https://fonts.gstatic.com/s/jbm/${w}.woff2) format('woff2');}`)
        .join('\n');
      return new Response(css, { headers: { 'content-type': 'text/css' } });
    }
    return new Response(Buffer.from('wOF2-JBM'), { headers: { 'content-type': 'font/woff2' } });
  }));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await app.close();
  await rm(mediaRoot, { recursive: true, force: true });
});

async function setup() {
  const email = `font-${Date.now()}-${Math.random().toString(36).slice(2)}@e2e.test`;
  await registerAccount(db, email, 'Pw-secret-1', { platformRole: 'developer' });
  const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'Pw-secret-1' } });
  const t = login.cookies.find((c) => c.name === 'sw_session')!.value;
  const slug = `font-${Date.now()}`;
  const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'Fonts', slug } });
  const projectId = (proj.json() as { project: { id: string } }).project.id;
  const key = await app.inject({
    method: 'POST',
    url: `/projects/${projectId}/api-keys`,
    cookies: { sw_session: t },
    payload: { name: 'agent', role: 'owner', capabilities: ['content:read', 'content:write'], expiresInDays: 1 },
  });
  const auth = { authorization: `Bearer ${(key.json() as { token: string }).token}` };
  return { auth, projectId, slug };
}

type Receipt = { changed: string[]; warnings?: string[] };

describe('a third self-hosted font', () => {
  it('★ is served by a NAMED slot backed by select_google_font: @font-face, the var, and the font-<name> utility', async () => {
    const { auth, projectId, slug } = await setup();
    const sel = await app.inject({ method: 'POST', url: `/projects/${projectId}/fonts/select`, headers: auth, payload: { family: 'JetBrains Mono', weights: [400] } });
    expect(sel.statusCode).toBe(200);
    const font = (sel.json() as { item: { id: string; files: Array<{ file: string }> } }).item;

    const put = await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/content/settings/settings?merge=1&receipt=1`,
      headers: auth,
      payload: { identity: { typography: { named: { code: { source: 'asset', assetId: font.id, family: 'JetBrains Mono', weight: 400 } } } } },
    });
    expect(put.statusCode).toBe(200);
    expect((put.json() as Receipt).warnings).toBeUndefined(); // nothing to warn about: the face is served

    const page = { id: 'home', path: '', title: 'Home', source: '<h1>Title</h1><p class="font-code">caption 01</p>' };
    const html = ((await app.inject({ method: 'POST', url: `/projects/${projectId}/preview`, headers: auth, payload: page })).json() as { html: string }).html;
    // The face is DECLARED, from the self-hosted file (never Google)…
    expect(html).toContain(`@font-face{font-family:"JetBrains Mono";font-style:normal;font-weight:400;font-display:swap;src:url(/media/${slug}/${font.id}-${font.files[0]!.file}) format("woff2")}`);
    // …the slot var carries it with its category fallback…
    expect(html).toMatch(/--sw-font-code:\s*"JetBrains Mono",\s*monospace/);
    // …and the utility the page uses resolves to that var.
    expect(html).toMatch(/\.font-code\{font-family:var\(--font-code\)\}/);
    expect(html).toMatch(/--font-code:\s*var\(--sw-font-code\)/);
    expect(html).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  });

  it('refuses the reserved slot name "mono" with a reason (the name an agent reaches for first)', async () => {
    const { auth, projectId } = await setup();
    const res = await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/content/settings/settings?merge=1&receipt=1`,
      headers: auth,
      payload: { identity: { typography: { named: { mono: { source: 'system', family: 'monospace', weight: 400 } } } } },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('reserved font slot name');
  });

  it('★ a fontFamilies stack naming a face nothing serves gets a fallback AND a warning that names the slot route', async () => {
    const { auth, projectId } = await setup();
    const sel = await app.inject({ method: 'POST', url: `/projects/${projectId}/fonts/select`, headers: auth, payload: { family: 'JetBrains Mono', weights: [400] } });
    const fontId = (sel.json() as { item: { id: string } }).item.id;

    const put = await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/content/settings/settings?merge=1&receipt=1`,
      headers: auth,
      payload: { identity: { typography: { fontFamilies: { mono: 'JetBrains Mono' } } } },
    });
    expect(put.statusCode).toBe(200); // a warning, never a refusal: the write lands
    const warnings = (put.json() as Receipt).warnings ?? [];
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('identity.typography.fontFamilies.mono names "JetBrains Mono"');
    // It is ALREADY in the library — the warning hands over the id and the slot to put it in.
    expect(warnings[0]).toContain(`assetId "${fontId}"`);
    expect(warnings[0]).toContain('identity.typography.named.code = { source:"asset"');
    expect(warnings[0]).toContain('font-code');

    // The stack itself now degrades to a monospace instead of the browser default serif.
    const page = { id: 'home', path: '', title: 'Home', source: '<p class="font-mono">x</p>' };
    const html = ((await app.inject({ method: 'POST', url: `/projects/${projectId}/preview`, headers: auth, payload: page })).json() as { html: string }).html;
    expect(html).toMatch(/--font-mono:\s*JetBrains Mono,\s*monospace/);
  });

  it('stays quiet for a face that IS served: web-safe, declared by @font-face in criticalCss, or a generic', async () => {
    const { auth, projectId } = await setup();
    const put = await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/content/settings/settings?merge=1&receipt=1`,
      headers: auth,
      payload: {
        website: { criticalCss: '@font-face{font-family:"Brand Sans";src:url(/media/x/brand.woff2) format("woff2")}' },
        identity: {
          typography: {
            fontFamilies: { display: "'Brand Sans', sans-serif", serif: 'Georgia, serif', ui: 'system-ui' },
            named: { quote: { source: 'system', family: 'Georgia', weight: 400 } },
          },
        },
      },
    });
    expect(put.statusCode).toBe(200);
    expect((put.json() as Receipt).warnings).toBeUndefined();
  });

  it('warns about a system slot naming an unserved face and an asset slot pointing at a missing asset', async () => {
    const { auth, projectId } = await setup();
    const put = await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/content/settings/settings?merge=1&receipt=1`,
      headers: auth,
      payload: {
        identity: {
          typography: {
            named: {
              caption: { source: 'system', family: 'IBM Plex Mono', weight: 400 },
              accent: { source: 'asset', assetId: 'nosuchfont1', family: 'Fraunces', weight: 700 },
            },
          },
        },
      },
    });
    const warnings = (put.json() as Receipt).warnings ?? [];
    expect(warnings.some((w) => w.includes('identity.typography.named.caption') && w.includes('"IBM Plex Mono"') && w.includes('select_google_font'))).toBe(true);
    expect(warnings.some((w) => w.includes('identity.typography.named.accent') && w.includes('"nosuchfont1"'))).toBe(true);
  });

  it('only a write that carries typography is checked — an unrelated settings patch carries no warnings', async () => {
    const { auth, projectId } = await setup();
    await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/content/settings/settings?merge=1&receipt=1`,
      headers: auth,
      payload: { identity: { typography: { fontFamilies: { mono: 'JetBrains Mono' } } } },
    });
    const later = await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/content/settings/settings?merge=1&receipt=1`,
      headers: auth,
      payload: { website: { footer: '<div>Footer</div>' } },
    });
    expect(later.statusCode).toBe(200);
    expect((later.json() as Receipt).warnings).toBeUndefined();
    // The editor's full (non-receipt) write gets the same field when there is something to say.
    const full = await app.inject({
      method: 'PUT',
      url: `/projects/${projectId}/content/settings/settings?merge=1`,
      headers: auth,
      payload: { identity: { typography: { fontFamilies: { mono: 'JetBrains Mono' } } } },
    });
    expect((full.json() as { warnings?: string[] }).warnings?.[0]).toContain('fontFamilies.mono');
  });
});
