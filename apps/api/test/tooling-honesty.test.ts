import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient } from './harness.js';

// Regressions for the three "the platform lied to the agent" defects found while cloning
// advancedtechcc.com: a publish status advertising a URL that 404s, page endpoints with no way to SEE
// a page, and dataset entries silently rendering in alphabetical id order.

let harness: Harness;
let client: TestClient;
let publishRoot: string;
let mediaRoot: string;
let previewRoot: string;

beforeEach(async () => {
  publishRoot = await mkdtemp(join(tmpdir(), 'sw-honesty-sites-'));
  mediaRoot = await mkdtemp(join(tmpdir(), 'sw-honesty-media-'));
  // `previewRoot` is what registers the /preview-site/* routes — without it the platform serves no
  // draft previews at all, and (post-fix) advertises no previewUrl either.
  previewRoot = await mkdtemp(join(tmpdir(), 'sw-honesty-preview-'));
  harness = await makeHarness({
    publishRoot,
    mediaRoot,
    previewRoot,
    deployAllowedHosts: ['ftp.example.com'],
  });
  client = await harness.signup();
});

afterEach(async () => {
  await harness.close();
  for (const dir of [publishRoot, mediaRoot, previewRoot]) await rm(dir, { recursive: true, force: true });
});

describe('publish status is honest about where a site actually is', () => {
  it('no deploy target → status "unpublished", url NULL, and a previewUrl to look at instead', async () => {
    const projectId = await client.createProject('Bare', 'bare', { localHosting: false });

    const res = await client.get(`/projects/${projectId}/publish`);
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      status: string;
      url: string | null;
      previewUrl: string;
      localHosting: boolean;
      deployTargets: number;
      reason?: string;
    };
    // THE regression: `url` used to be a `<slug>.<sitesDomain>` address that 404s, returned right next
    // to `localHosting: false`. An agent read it and reported a clone as live at an address that had
    // never served anything.
    expect(body.url).toBeNull();
    expect(body.status).toBe('unpublished');
    expect(body.localHosting).toBe(false);
    expect(body.deployTargets).toBe(0);
    expect(body.reason).toMatch(/no deploy target/i);
    // …and it says where you CAN see it.
    expect(body.previewUrl).toMatch(/^\/preview-site\/[^/]+\/[^/]+\/$/);
  });

  it('still unpublished after a successful BUILD, because nothing serves the artifact', async () => {
    const projectId = await client.createProject('Built', 'built', { localHosting: false });
    const published = await client.post(`/projects/${projectId}/publish`);
    expect(published.statusCode).toBe(200);
    const built = published.json() as { status: string; url: string | null; release: unknown };
    expect(built.release).toBeTruthy(); // the build really happened…
    expect(built.status).toBe('unpublished'); // …and is still reachable by nobody
    expect(built.url).toBeNull();

    const after = client.get(`/projects/${projectId}/publish`);
    expect(((await after).json() as { status: string }).status).toBe('unpublished');
  });

  it('a local deploy target → status "published" with a real served url', async () => {
    const projectId = await client.createProject('Served', 'served'); // localHosting on by default
    expect((await client.post(`/projects/${projectId}/publish`)).statusCode).toBe(200);

    const body = (await client.get(`/projects/${projectId}/publish`)).json() as {
      status: string;
      url: string | null;
      localHosting: boolean;
      deployTargets: number;
    };
    expect(body.localHosting).toBe(true);
    expect(body.deployTargets).toBe(1);
    expect(body.status).toBe('published');
    expect(body.url).toBeTruthy();
  });

  it('a REMOTE-only target still reports no url — we do not know the upload origin', async () => {
    const projectId = await client.createProject('Remote', 'remote', { localHosting: false });
    // Deploy targets have a DEDICATED route (the generic content endpoint refuses them — it would leak
    // the encrypted secret), and the host must be on the instance allow-list.
    const put = await client.post(`/projects/${projectId}/deploy-targets`, {
      name: 'FTP',
      protocol: 'ftp',
      host: 'ftp.example.com',
      user: 'u',
      password: 'p',
      remoteDir: '/www',
    });
    expect(put.statusCode).toBe(201);

    const body = (await client.get(`/projects/${projectId}/publish`)).json() as {
      url: string | null;
      localHosting: boolean;
      deployTargets: number;
    };
    expect(body.deployTargets).toBe(1);
    expect(body.localHosting).toBe(false);
    expect(body.url).toBeNull();
  });
});

describe('criticalCss can be patched without re-sending the sheet', () => {
  it('a named block upserts, so repeated edits replace instead of piling up', async () => {
    // Four clone agents independently called the full re-send the most tedious mechanic of the job —
    // one did it eleven times against a ~19KB stylesheet.
    const projectId = await client.createProject('CSS', 'csspatch');
    const proj = client.project(projectId);
    const base = `/projects/${projectId}/critical-css`;

    const first = await client.post(base, { css: '.nav{height:80px}', block: 'nav' });
    expect(first.statusCode).toBe(200);
    expect((first.json() as { changed: boolean }).changed).toBe(true);

    await client.post(base, { css: '.hero{color:red}', block: 'hero' });
    const third = await client.post(base, { css: '.nav{height:92px}', block: 'nav' });
    const receipt = third.json() as { blocks: string[]; bytes: number };
    expect(receipt.blocks).toEqual(['nav', 'hero']); // order stable across the edit

    const stored = ((await proj.getContent('settings', 'settings')).json() as {
      item: { website?: { criticalCss?: string } };
    }).item.website?.criticalCss ?? '';
    expect(stored).toContain('.nav{height:92px}');
    expect(stored).not.toContain('80px');     // replaced, not appended
    expect(stored).toContain('.hero{color:red}'); // the neighbouring block is untouched

    // …and the receipt is a receipt: it must NOT echo the stylesheet back, which is the whole point.
    expect(JSON.stringify(receipt)).not.toContain('height:92px');
  });

  it('rejects a block name that would break out of the CSS comment delimiter', async () => {
    const projectId = await client.createProject('CSS2', 'csspatch2');
    const res = await client.post(`/projects/${projectId}/critical-css`, { css: '.a{}', block: 'a */ .evil{}' });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toContain('not a valid name');
  });

  it('requires css, and says so', async () => {
    const projectId = await client.createProject('CSS3', 'csspatch3');
    const res = await client.post(`/projects/${projectId}/critical-css`, { block: 'nav' });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toContain('css is required');
  });
});

describe('page endpoints hand back a preview URL', () => {
  it('list + get carry a signed per-page previewUrl ending in that page path', async () => {
    const projectId = await client.createProject('Pages', 'pages');
    const proj = client.project(projectId);
    await proj.putContent('page', 'about', { id: 'about', path: 'about', title: 'About', source: '<h1>A</h1>' });

    const got = (await proj.getContent('page', 'about')).json() as { previewUrl: string };
    expect(got.previewUrl).toMatch(/^\/preview-site\/[^/]+\/[^/]+\/about$/);

    const items = ((await proj.listContent('page')).json() as { items: Array<{ id: string; previewUrl: string }> })
      .items;
    expect(items.find((p) => p.id === 'about')?.previewUrl).toBe(got.previewUrl);
    // the home page created with the project sits at the preview ROOT
    expect(items.find((p) => p.id === 'home')?.previewUrl).toMatch(/^\/preview-site\/[^/]+\/[^/]+\/$/);
  });

  it('a kind:"link" nav placeholder gets NO previewUrl — it is not a page', async () => {
    // Found on a real clone of a one-page site: the agent modelled the header as five `#anchor`
    // nav placeholders so the menu could be data-driven. Each is `kind:"link"` with no source and an
    // empty path, so each came back advertising the SITE ROOT — follow one and you render the home
    // page while being told you are looking at "About Us". Emitting nothing is the honest answer.
    const projectId = await client.createProject('Onepage', 'onepage');
    const proj = client.project(projectId);
    await proj.putContent('page', 'nav-about', {
      id: 'nav-about',
      path: '',
      title: 'About Us',
      kind: 'link',
      link: { target: '#about' },
    });

    const got = (await proj.getContent('page', 'nav-about')).json() as Record<string, unknown>;
    expect(got.previewUrl).toBeUndefined();

    const items = (
      (await proj.listContent('page')).json() as { items: Array<Record<string, unknown>> }
    ).items;
    expect(items.find((p) => p.id === 'nav-about')?.previewUrl).toBeUndefined();
    // …while the REAL home page in the same project still gets one, so this is a targeted exclusion
    // and not the whole feature quietly switching itself off.
    expect(items.find((p) => p.id === 'home')?.previewUrl).toMatch(/^\/preview-site\//);
  });

  it('a CHILD page gets its full parent-chain route, not just its own last segment', async () => {
    const projectId = await client.createProject('Nested', 'nested');
    const proj = client.project(projectId);
    await proj.putContent('page', 'services', { id: 'services', path: 'services', title: 'Services', source: 'x' });
    await proj.putContent('page', 'audit', {
      id: 'audit',
      path: 'audit',
      parent: 'services',
      title: 'Audit',
      source: 'y',
    });

    const got = (await proj.getContent('page', 'audit')).json() as { previewUrl: string };
    expect(got.previewUrl).toMatch(/\/services\/audit$/); // NOT `/audit`
    const items = ((await proj.listContent('page')).json() as { items: Array<{ id: string; previewUrl: string }> })
      .items;
    expect(items.find((p) => p.id === 'audit')?.previewUrl).toBe(got.previewUrl);
  });

  it('the minted signature actually resolves — it is not a decorative string', async () => {
    const projectId = await client.createProject('Sig', 'sigcheck');
    const { previewUrl } = (await client.project(projectId).getContent('page', 'home')).json() as {
      previewUrl: string;
    };
    expect((await client.get(previewUrl)).statusCode).toBe(200);
  });

  it('non-page kinds are untouched', async () => {
    const projectId = await client.createProject('Other', 'other');
    const res = await client.project(projectId).getContent('settings', 'settings');
    expect(res.json()).not.toHaveProperty('previewUrl');
  });
});

describe('dataset entries default to WRITE order, not alphabetical id order', () => {
  const ds = { id: 'badges', name: 'Badges', slug: 'badges', fields: [{ name: 'label', type: 'text' }] };

  async function project(slug: string) {
    const projectId = await client.createProject('Ord', slug);
    const proj = client.project(projectId);
    await proj.putContent('dataset', 'badges', ds);
    const add = (id: string, extra: object = {}) =>
      proj.putContent('entry', id, { id, dataset: 'badges', status: 'published', values: { label: id }, ...extra });
    const order = async () => {
      const items = ((await client.get(`/projects/${projectId}/content/entry?dataset=badges`)).json() as {
        items: Array<{ id: string; order?: number }>;
      }).items;
      return items
        .slice()
        .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || (a.id < b.id ? -1 : 1))
        .map((e) => e.id);
    };
    return { projectId, proj, add, order };
  }

  it('rows written in a non-alphabetical sequence keep that sequence', async () => {
    const { add, order } = await project('ord1');
    // Deliberately reverse-alphabetical — the old behaviour rendered these advisor→certified→silver.
    for (const id of ['silver', 'certified', 'advisor']) await add(id);
    expect(await order()).toEqual(['silver', 'certified', 'advisor']);
  });

  it('an explicit order always wins, and later creates append after the highest', async () => {
    const { add, order } = await project('ord2');
    await add('one', { order: 10 });
    await add('two', { order: 1 });
    expect(await order()).toEqual(['two', 'one']);
    await add('three'); // no order → max(10) + 1
    expect(await order()).toEqual(['two', 'one', 'three']);
  });

  it('a full re-PUT that omits order KEEPS the row where it was', async () => {
    const { projectId, proj, add, order } = await project('ord3');
    for (const id of ['zeta', 'alpha']) await add(id); // zeta=0, alpha=1
    await proj.putContent('entry', 'zeta', {
      id: 'zeta',
      dataset: 'badges',
      status: 'published',
      values: { label: 'edited' },
    });
    const item = ((await client.get(`/projects/${projectId}/content/entry/zeta?dataset=badges`)).json() as {
      item: { order?: number };
    }).item;
    expect(item.order).toBe(0);
    expect(await order()).toEqual(['zeta', 'alpha']);
  });

  it('appending to a legacy UNORDERED dataset backfills it first, so the existing row stays in front', async () => {
    const projectId = await client.createProject('Legacy', 'ord4');
    const proj = client.project(projectId);
    // Widget provisioning seeds entries with NO `order` (ensureWidgetDatasets → repo.put) — exactly the
    // legacy shape. Saving a page that composes the hero-slider creates dataset `hero`, entry `config`.
    await proj.putContent('page', 'home', { id: 'home', path: '', title: 'Home', source: '{{> hero-slider}}' });
    const seeded = await client.get(`/projects/${projectId}/content/entry/config?dataset=hero`);
    expect(seeded.statusCode).toBe(200);
    expect((seeded.json() as { item: { order?: number } }).item.order).toBeUndefined();

    // Appending must not leapfrog the unordered row (order 0 vs +Infinity would do exactly that).
    await proj.putContent('entry', 'second', { id: 'second', dataset: 'hero', status: 'published', values: {} });
    const rows = ((await client.get(`/projects/${projectId}/content/entry?dataset=hero`)).json() as {
      items: Array<{ id: string; order?: number }>;
    }).items;
    expect(rows.find((r) => r.id === 'config')?.order).toBe(0);
    expect(rows.find((r) => r.id === 'second')?.order).toBe(1);
  });
});
