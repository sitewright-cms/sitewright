import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import type { GeoLookup } from '../src/analytics/geo.js';
import { StatsStore } from '../src/analytics/store.js';
import { setPlatformRole } from '../src/repo/accounts.js';
import { ProjectDomainRepository } from '../src/repo/project-domains.js';
import { ProjectRepository } from '../src/repo/projects.js';
import { makeHarness, type Harness, type TestClient } from './harness.js';

// The built-in statistics end to end: the publisher puts a signed tracker on every page, the page beacons to
// the collector, and the totals come back from the stats routes. Everything goes through the real routes —
// the beacon is the one a published page would send, decoded from the page itself.

const DOMAIN = 'agency.site';
const SLUG = 'example';
const SITE_HOST = `${SLUG}.${DOMAIN}`;
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

const geo: GeoLookup = { country: (ip) => (ip.startsWith('1.') ? 'DE' : ip.startsWith('2.') ? 'US' : null) };
const today = (): string => new Date().toISOString().slice(0, 10);

interface Tag {
  b: string;
  p: string;
  r: string;
  k: string;
}

/** The tracker payload a published page carries, or null when it has none. */
function trackerOf(html: string): Tag | null {
  const m = /<script defer src="([^"]*stats\.js[^"]*)" data-sw-stats="([^"]+)"><\/script>/.exec(html);
  return m ? (JSON.parse(Buffer.from(m[2]!, 'base64').toString('utf8')) as Tag) : null;
}

describe('built-in statistics', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  let publishRoot: string;
  let mediaRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-stats-pub-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-stats-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot, sitesDomain: DOMAIN, publicUrl: 'https://cms.agency.com', statsGeo: geo });
    client = await harness.signup({ admin: true });
    projectId = await client.createProject('Example', SLUG, { localHosting: false });
  });
  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  async function seed(website: Record<string, unknown> = { statistics: { enabled: true } }) {
    const proj = client.project(projectId);
    await proj.putContent('settings', 'settings', {
      brand: { name: 'Example', colors: { primary: '#e11' } },
      settings: { defaultLocale: 'en', locales: ['en'] },
      website,
    });
    await proj.putContent('page', 'home', { kind: 'page', title: 'Home', path: '', source: '<h1>Home</h1>' });
    await proj.putContent('page', 'about', { kind: 'page', title: 'About', path: 'about', source: '<h1>About</h1>' });
  }
  async function publish() {
    await client.post(`/projects/${projectId}/deploy-targets`, { name: 'Local Hosting', protocol: 'local' });
    expect((await client.post(`/projects/${projectId}/publish`)).statusCode).toBe(200);
  }
  const page = (url: string, ua = CHROME, remoteAddress = '1.1.1.1') =>
    harness.app.inject({ method: 'GET', url, headers: { host: SITE_HOST, 'user-agent': ua, 'x-forwarded-proto': 'https' }, remoteAddress });
  const beacon = (body: unknown, opts: { ua?: string; ip?: string; host?: string; headers?: Record<string, string> } = {}) =>
    harness.app.inject({
      method: 'POST',
      url: `/a/${projectId}`,
      headers: { host: opts.host ?? 'cms.agency.com', 'content-type': 'text/plain;charset=UTF-8', 'user-agent': opts.ua ?? CHROME, ...opts.headers },
      payload: typeof body === 'string' ? body : JSON.stringify(body),
      remoteAddress: opts.ip ?? '1.1.1.1',
    });
  const stats = async (query = '') => {
    const res = await client.get(`/projects/${projectId}/stats?from=${today()}&to=${today()}${query}`);
    expect(res.statusCode).toBe(200);
    return res.json();
  };

  it('★ a published page carries a signed tracker that the collector counts', async () => {
    await seed();
    await publish();
    const res = await page('/about/');
    expect(res.statusCode).toBe(200);
    const tag = trackerOf(res.body);
    expect(tag).toEqual({ b: 'https://cms.agency.com', p: projectId, r: '/about/', k: expect.stringMatching(/^[A-Za-z0-9_-]{16}$/) });
    // The collector is cross-origin from the site host, so the page's policy must let the beacon out.
    expect(res.headers['content-security-policy']).toMatch(/connect-src 'self'[^;]* https:\/\/cms\.agency\.com/);
    // The tracker itself is served from the site.
    const js = await page(`/${res.body.match(/src="([^"]*stats\.js)/)![1]!.replace(/^(\.\.\/)+/, '')}`);
    expect(js.statusCode).toBe(200);
    expect(js.body).toContain('sendBeacon');

    expect((await beacon({ r: tag!.r, k: tag!.k, h: SITE_HOST })).statusCode).toBe(204);
    const s = await stats();
    expect(s.human).toEqual({ views: 1, visitors: 1 });
    expect(s.countries).toEqual([{ country: 'DE', views: 1, visitors: 1 }]);
    expect(s.pages).toEqual([{ path: '/about/', views: 1, botViews: 0 }]);
    expect(s.enabled).toBe(true);
  });

  it('counts devices, visitors and sources from what the page reports', async () => {
    await seed();
    await publish();
    const home = trackerOf((await page('/')).body)!;
    const about = trackerOf((await page('/about/')).body)!;
    await beacon({ r: home.r, k: home.k, h: SITE_HOST, f: 'www.google.com' });
    await beacon({ r: about.r, k: about.k, h: SITE_HOST });
    await beacon({ r: home.r, k: home.k, h: SITE_HOST, m: 1 }, { ua: IPHONE, ip: '2.2.2.2' });
    await beacon({ r: home.r, k: home.k, h: SITE_HOST, u: 'newsletter' }, { ip: '2.2.2.3', headers: { 'sec-ch-ua-mobile': '?1' } });
    const s = await stats();
    expect(s.human).toEqual({ views: 4, visitors: 3 });
    expect(s.devices).toEqual([
      { device: 'desktop', views: 2, visitors: 1 },
      { device: 'mobile', views: 2, visitors: 2 },
      { device: 'tablet', views: 0, visitors: 0 },
    ]);
    expect(s.sources.map((x: { source: string; host: string }) => `${x.source}:${x.host}`).sort()).toEqual(['campaign:newsletter', 'direct:', 'search:google.com']);
    const mobile = await stats('&device=mobile');
    expect(mobile.human).toEqual({ views: 2, visitors: 2 });
    expect(mobile.countries).toEqual([{ country: 'US', views: 2, visitors: 2 }]);
  });

  it('★ a forged route, an unknown project or a foreign host is answered 204 and NOT counted', async () => {
    await seed({ statistics: { enabled: true }, siteUrl: 'https://www.example.com' });
    await publish();
    const tag = trackerOf((await page('/')).body)!;
    // A path the publisher never signed, and a real path with a borrowed signature.
    expect((await beacon({ r: '/made-up/', k: tag.k, h: SITE_HOST })).statusCode).toBe(204);
    expect((await beacon({ r: '/about/', k: tag.k, h: SITE_HOST })).statusCode).toBe(204);
    // A copy of the page on somebody else's host, and a page opened from a file (no host).
    expect((await beacon({ r: tag.r, k: tag.k, h: 'evil.example.net' })).statusCode).toBe(204);
    expect((await beacon({ r: tag.r, k: tag.k })).statusCode).toBe(204);
    // Another (unknown) project's endpoint.
    const other = await harness.app.inject({ method: 'POST', url: '/a/nope', headers: { 'content-type': 'text/plain' }, payload: JSON.stringify({ r: tag.r, k: tag.k, h: SITE_HOST }) });
    expect(other.statusCode).toBe(204);
    expect((await stats()).human.views).toBe(0);
    // The site's own address (www or not) and its platform host both count.
    await beacon({ r: tag.r, k: tag.k, h: 'example.com' });
    await beacon({ r: tag.r, k: tag.k, h: SITE_HOST });
    expect((await stats()).human.views).toBe(2);
  });

  it('rejects a body that is not a beacon with 400', async () => {
    await seed();
    expect((await beacon('not json')).statusCode).toBe(400);
    expect((await beacon({ r: 'no-slash', k: 'x' })).statusCode).toBe(400);
    expect((await beacon({ r: '/', k: 'x', m: 'yes' })).statusCode).toBe(400);
    expect((await beacon([1, 2])).statusCode).toBe(400);
    // Over the 1 KB body cap (the app reports an oversized body as a 400).
    const big = await beacon({ r: '/', k: 'x', f: 'a'.repeat(2000) });
    expect(big.statusCode).toBe(400);
    expect(big.json()).toEqual({ error: 'input too large' });
  });

  it('★ with statistics OFF there is no tracker and nothing is counted', async () => {
    await seed({ statistics: { enabled: true } });
    await publish();
    const tag = trackerOf((await page('/')).body)!;
    // Switch it off: the next publish drops the tracker, and a cached page's beacon is ignored AT ONCE.
    await seed({});
    expect((await beacon({ r: tag.r, k: tag.k, h: SITE_HOST })).statusCode).toBe(204);
    expect((await client.post(`/projects/${projectId}/publish`)).statusCode).toBe(200);
    expect(trackerOf((await page('/')).body)).toBeNull();
    const s = await stats();
    expect(s.human.views).toBe(0);
    expect(s.enabled).toBe(false);
  });

  it('★ the draft preview never carries the tracker', async () => {
    // The `/preview-site/*` routes exist only with a preview root, so this needs its own harness.
    const previewRoot = await mkdtemp(join(tmpdir(), 'sw-stats-preview-'));
    const h2 = await makeHarness({ previewRoot, statsGeo: geo });
    try {
      const c2 = await h2.signup({ admin: true });
      const pid = await c2.createProject('Preview', 'preview-stats');
      await c2.project(pid).putContent('settings', 'settings', {
        brand: { name: 'Example', colors: { primary: '#e11' } },
        settings: { defaultLocale: 'en', locales: ['en'] },
        website: { statistics: { enabled: true } },
      });
      await c2.project(pid).putContent('page', 'home', { kind: 'page', title: 'Home', path: '', source: '<h1>Home</h1>' });
      const base = (await c2.get(`/projects/${pid}/preview-url`)).json() as { base: string };
      const doc = await c2.get(base.base);
      expect(doc.statusCode).toBe(200);
      expect(doc.body).toContain('<h1>Home</h1>');
      expect(doc.body).not.toContain('data-sw-stats');
      expect(doc.body).not.toContain('stats.js');
    } finally {
      await h2.close();
      await rm(previewRoot, { recursive: true, force: true });
    }
  });

  it('★ counts a BOT the platform serves, and does not count its beacon a second time', async () => {
    await seed();
    await publish();
    const res = await page('/about/', GOOGLEBOT, '2.2.2.2');
    expect(res.statusCode).toBe(200);
    // A crawler that DOES run the script beacons from the platform host: already counted above.
    const tag = trackerOf(res.body)!;
    await beacon({ r: tag.r, k: tag.k, h: SITE_HOST }, { ua: GOOGLEBOT, ip: '2.2.2.2' });
    // A human page load is not counted as served (the tracker counts it).
    await page('/');
    const s = await stats();
    expect(s.botViews).toBe(1);
    expect(s.bots).toEqual([{ class: 'search', views: 1 }]);
    expect(s.human.views).toBe(0);
    expect(s.pages).toEqual([{ path: '/about/', views: 0, botViews: 1 }]);
  });

  it('★ reaches the collector on a SITE host too (a root-relative beacon from a locally hosted page)', async () => {
    await seed();
    await publish();
    const tag = trackerOf((await page('/')).body)!;
    expect((await beacon({ r: tag.r, k: tag.k, h: SITE_HOST }, { host: SITE_HOST })).statusCode).toBe(204);
    expect((await stats()).human.views).toBe(1);
  });

  it('counts a stored form submission as a goal, labelled with the form name', async () => {
    await seed();
    const proj = client.project(projectId);
    await proj.putContent('form', 'contact', {
      id: 'contact',
      name: 'Contact us',
      mode: 'globalSmtp',
      recipient: 'owner@example.com',
      fields: [{ name: 'message', label: 'Message', type: 'textarea' }],
    });
    const res = await harness.app.inject({
      method: 'POST',
      url: `/f/${projectId}/contact`,
      headers: { 'content-type': 'application/json' },
      // The time-trap and interaction evidence a real form runtime sends.
      payload: { message: 'Hello there', _elapsed: '5000', _ix: '3.12.1' },
    });
    expect(res.statusCode).toBe(200);
    const s = await stats();
    expect(s.goals).toEqual([{ goal: 'form:contact', label: 'Contact us', count: 1 }]);
  });

  it('exports a table as CSV', async () => {
    await seed();
    await publish();
    const tag = trackerOf((await page('/')).body)!;
    await beacon({ r: tag.r, k: tag.k, h: SITE_HOST });
    const res = await client.get(`/projects/${projectId}/stats.csv?from=${today()}&to=${today()}&table=pages`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="statistics-${SLUG}-pages-${today()}-${today()}.csv"`);
    expect(res.body).toBe(`day,path,views,bot_views\r\n${today()},/,1,0\r\n`);
    expect((await client.get(`/projects/${projectId}/stats.csv?from=${today()}&to=${today()}&table=users`)).statusCode).toBe(400);
  });

  it('validates the range', async () => {
    await seed();
    expect((await client.get(`/projects/${projectId}/stats?from=2026-10-20&to=2026-10-19`)).statusCode).toBe(400);
    expect((await client.get(`/projects/${projectId}/stats?from=2020-01-01&to=2026-10-19`)).statusCode).toBe(400);
    expect((await client.get(`/projects/${projectId}/stats?from=yesterday&to=today`)).statusCode).toBe(400);
    expect((await client.get(`/projects/${projectId}/stats?from=${today()}&to=${today()}&device=phone`)).statusCode).toBe(400);
  });

  it('★ a made-up Bearer header does NOT buy a fresh rate-limit bucket per request', async () => {
    await seed();
    await publish();
    const tag = trackerOf((await page('/')).body)!;
    // The limiter used to key on ANY bearer, so a random token per request walked past every per-IP limit.
    const codes: number[] = [];
    for (let i = 0; i < 125; i++) {
      codes.push((await beacon({ r: tag.r, k: tag.k, h: SITE_HOST }, { headers: { authorization: `Bearer junk-${i}` } })).statusCode);
    }
    expect(codes).toContain(429);
  });

  it('★ does not count a HEAD request as a bot page view', async () => {
    await seed();
    await publish();
    await harness.app.inject({ method: 'HEAD', url: '/about/', headers: { host: SITE_HOST, 'user-agent': GOOGLEBOT, 'x-forwarded-proto': 'https' } });
    expect((await stats()).botViews).toBe(0);
  });

  it('★ only agency staff turn the statistics ON; a client may turn them off, by a full save or a merge', async () => {
    await seed({});
    const { addProjectMember } = await import('../src/repo/accounts.js');
    const owner = await harness.signup();
    await addProjectMember(harness.db, owner.userId, projectId, 'owner'); // a client OWNER: still not staff
    const settingsUrl = `/projects/${projectId}/content/settings/settings`;
    const current = ((await client.get(settingsUrl)).json() as { item: Record<string, unknown> & { website?: Record<string, unknown> } }).item;
    const withStats = (on: boolean) => ({ ...current, website: { ...(current.website ?? {}), statistics: { enabled: on } } });

    // The same full body saves with statistics off (so it is a valid body), and is refused with them on.
    expect((await owner.put(settingsUrl, withStats(false))).statusCode).toBe(200);
    const refused = await owner.put(settingsUrl, withStats(true));
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toEqual({ error: 'only agency staff (an admin or a developer) can turn the built-in statistics on' });
    expect((await owner.put(`${settingsUrl}?merge=1`, { website: { statistics: { enabled: true } } })).statusCode).toBe(403);
    // Saving other settings while they stay off is untouched by the rule.
    expect((await owner.put(`${settingsUrl}?merge=1`, { website: { siteUrl: 'https://www.example.com' } })).statusCode).toBe(200);

    // Staff turn them on; the client may then save anything, and may turn them off.
    expect((await client.put(`${settingsUrl}?merge=1`, { website: { statistics: { enabled: true } } })).statusCode).toBe(200);
    expect((await owner.put(`${settingsUrl}?merge=1`, { website: { siteUrl: 'https://example.com' } })).statusCode).toBe(200);
    expect((await owner.put(`${settingsUrl}?merge=1`, { website: { statistics: { enabled: false } } })).statusCode).toBe(200);
    const after = ((await client.get(settingsUrl)).json() as { item: { website?: { statistics?: { enabled?: boolean } } } }).item;
    expect(after.website?.statistics?.enabled ?? false).toBe(false);

    // ★ Restoring the revision in which staff switched them on is the same switch, through another door.
    const revs = (await owner.get(`/projects/${projectId}/content/settings/settings/revisions`)).json() as { items: Array<{ id: string }> };
    const onRev = await (async () => {
      for (const r of revs.items) {
        const one = (await owner.get(`/projects/${projectId}/content/settings/settings/revisions/${r.id}`)).json() as { revision?: { data?: { website?: { statistics?: { enabled?: boolean } } } } };
        if (one.revision?.data?.website?.statistics?.enabled === true) return r.id;
      }
      return null;
    })();
    expect(onRev).not.toBeNull();
    const restore = await owner.post(`/projects/${projectId}/content/settings/settings/revisions/${onRev}/restore`);
    expect(restore.statusCode).toBe(403);
    expect((await client.post(`/projects/${projectId}/content/settings/settings/revisions/${onRev}/restore`)).statusCode).toBe(200);
  });

  it('★ a client cannot change the statistics by IMPORTING a bundle: the rest applies, the statistics stay as stored', async () => {
    await seed({});
    const { addProjectMember } = await import('../src/repo/accounts.js');
    const owner = await harness.signup();
    await addProjectMember(harness.db, owner.userId, projectId, 'owner'); // a client OWNER: still not staff
    const importUrl = `/projects/${projectId}/import`;
    const bundle = (website: Record<string, unknown>) => ({
      project: { identity: { name: 'Example', colors: { primary: '#e11' } }, settings: { defaultLocale: 'en', locales: ['en'] }, website },
      pages: [],
    });
    const website = async () =>
      ((await client.get(`/projects/${projectId}/content/settings/settings`)).json() as { item: { website?: { siteUrl?: string; statistics?: { enabled?: boolean } } } }).item
        .website;

    // A client's bundle that switches them ON: imported (its site URL lands), and the statistics stay off.
    expect((await owner.post(importUrl, bundle({ siteUrl: 'https://one.example.com', statistics: { enabled: true } }))).statusCode).toBe(200);
    expect((await website())?.siteUrl).toBe('https://one.example.com');
    // Nothing was stored, so the bundle's value is DROPPED — not written as off, not kept as on.
    expect(await website()).not.toHaveProperty('statistics');

    // Staff import exactly as before: their bundle switches them on.
    expect((await client.post(importUrl, bundle({ siteUrl: 'https://two.example.com', statistics: { enabled: true } }))).statusCode).toBe(200);
    expect(await website()).toMatchObject({ siteUrl: 'https://two.example.com', statistics: { enabled: true } });

    // A client's bundle that says off, or says nothing, leaves them on — the import is not the switch.
    expect((await owner.post(importUrl, bundle({ siteUrl: 'https://three.example.com', statistics: { enabled: false } }))).statusCode).toBe(200);
    expect(await website()).toMatchObject({ siteUrl: 'https://three.example.com', statistics: { enabled: true } });
    expect((await owner.post(importUrl, bundle({ siteUrl: 'https://four.example.com' }))).statusCode).toBe(200);
    expect(await website()).toMatchObject({ siteUrl: 'https://four.example.com', statistics: { enabled: true } });
  });

  it('★ a duplicate or an archive import by someone who is NOT staff (any more) starts with the statistics off', async () => {
    await seed({ statistics: { enabled: true }, siteUrl: 'https://www.example.com' });
    const archive = await client.inject({ method: 'GET', url: `/projects/${projectId}/export.zip` });
    expect(archive.statusCode).toBe(200);
    // Both routes admit staff only, so a client can never get here today. The rule holds anyway: the creator is
    // demoted between the gate and the copy, which is exactly a looser gate's outcome.
    const realCreate = ProjectRepository.prototype.create;
    const create = vi.spyOn(ProjectRepository.prototype, 'create').mockImplementation(async function (this: ProjectRepository, ...args: Parameters<ProjectRepository['create']>) {
      await setPlatformRole(harness.db, client.userId, null);
      return realCreate.apply(this, args);
    });
    const websiteOf = async (id: string) =>
      ((await client.get(`/projects/${id}/content/settings/settings`)).json() as { item: { website?: Record<string, unknown> } }).item.website;
    try {
      const dup = await client.post(`/projects/${projectId}/duplicate`);
      expect(dup.statusCode).toBe(201);
      const dupWebsite = await websiteOf((dup.json() as { project: { id: string } }).project.id);
      expect(dupWebsite?.siteUrl).toBe('https://www.example.com'); // the settings really were copied…
      expect(dupWebsite).not.toHaveProperty('statistics'); // …all but the statistics

      await setPlatformRole(harness.db, client.userId, 'admin');
      const boundary = 'SWSTATSZIP';
      const payload = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="site.zip"\r\nContent-Type: application/zip\r\n\r\n`),
        archive.rawPayload,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const imported = await client.inject({ method: 'POST', url: '/projects/import/zip', payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } });
      const done = /event: done\ndata: (.*)\n/.exec(imported.payload);
      expect(done, imported.payload.slice(0, 500)).not.toBeNull();
      const zipWebsite = await websiteOf((JSON.parse(done![1]!) as { report: { projectId: string } }).report.projectId);
      expect(zipWebsite?.siteUrl).toBe('https://www.example.com');
      expect(zipWebsite).not.toHaveProperty('statistics');
      expect(create).toHaveBeenCalledTimes(2);
    } finally {
      create.mockRestore();
    }
  });

  it('★ an IMPORT that switches the statistics takes effect at once, like a settings save (no stale cached settings)', async () => {
    await seed();
    await publish();
    const tag = trackerOf((await page('/')).body)!;
    // Counted — which also puts the site's settings (statistics on) in the collector's cache.
    await beacon({ r: tag.r, k: tag.k, h: SITE_HOST });
    expect((await stats()).human.views).toBe(1);
    const bundle = (on: boolean) => ({
      project: { identity: { name: 'Example', colors: { primary: '#e11' } }, settings: { defaultLocale: 'en', locales: ['en'] }, website: { statistics: { enabled: on } } },
      pages: [],
    });
    expect((await client.post(`/projects/${projectId}/import`, bundle(false))).statusCode).toBe(200);
    // The very next beacon is ignored: the import dropped the cached settings, as a settings save does.
    await beacon({ r: tag.r, k: tag.k, h: SITE_HOST }, { ip: '1.1.1.2' });
    const off = await stats();
    expect(off.enabled).toBe(false);
    expect(off.human.views).toBe(1);
    // …and switching them back on by import counts the next one at once, too.
    expect((await client.post(`/projects/${projectId}/import`, bundle(true))).statusCode).toBe(200);
    await beacon({ r: tag.r, k: tag.k, h: SITE_HOST }, { ip: '1.1.1.3' });
    expect((await stats()).human.views).toBe(2);
  });

  it('★ is readable by project members only', async () => {
    await seed();
    const anon = await harness.app.inject({ method: 'GET', url: `/projects/${projectId}/stats?from=${today()}&to=${today()}` });
    expect(anon.statusCode).toBe(401);
    const stranger = await harness.signup();
    expect((await stranger.get(`/projects/${projectId}/stats?from=${today()}&to=${today()}`)).statusCode).toBe(403);
  });
});

describe('built-in statistics without a public URL', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  let publishRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-stats-nourl-'));
    // Neither a public URL nor a sites domain: locally hosted pages are served in the path form on the app host.
    harness = await makeHarness({ publishRoot, statsGeo: geo, deployAllowedHosts: ['allowed.example.com'] });
    client = await harness.signup({ admin: true });
    projectId = await client.createProject('Example', SLUG, { localHosting: false });
    await client.project(projectId).putContent('settings', 'settings', {
      brand: { name: 'Example', colors: { primary: '#e11' } },
      settings: { defaultLocale: 'en', locales: ['en'] },
      website: { statistics: { enabled: true } },
    });
    await client.project(projectId).putContent('page', 'home', { kind: 'page', title: 'Home', path: '', source: '<h1>Home</h1>' });
  });
  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
  });

  it('★ a build for ANOTHER host ships no tracker (it would beacon into the void), and the tab says why', async () => {
    // Before any remote target: nothing to explain.
    const before = (await client.get(`/projects/${projectId}/stats?from=${today()}&to=${today()}`)).json();
    expect(before.notice).toBeUndefined();
    const created = await client.post(`/projects/${projectId}/deploy-targets`, { name: 'Webspace', protocol: 'sftp', host: 'allowed.example.com', user: 'u', password: 'p', remoteDir: '/www' });
    expect(created.statusCode).toBe(201);
    expect((await client.get(`/projects/${projectId}/stats?from=${today()}&to=${today()}`)).json().notice).toBe('no-public-url');
    // The downloadable site (built fresh, as a remote deploy is) carries no counter.
    const res = await client.inject({ method: 'GET', url: `/projects/${projectId}/publish/archive` });
    expect(res.statusCode).toBe(200);
    const zip = await JSZip.loadAsync(res.rawPayload);
    const names = Object.keys(zip.files);
    expect(names).toContain('index.html');
    expect(names.some((n) => n.endsWith('stats.js'))).toBe(false);
    expect(await zip.file('index.html')!.async('string')).not.toContain('data-sw-stats');
  });

  it('★ a locally hosted page beacons same-origin, and a script-running crawler there is not counted twice', async () => {
    await client.post(`/projects/${projectId}/deploy-targets`, { name: 'Local Hosting', protocol: 'local' });
    expect((await client.post(`/projects/${projectId}/publish`)).statusCode).toBe(200);
    // Served on the APP host (path form): no sites-domain host for this project is involved.
    const served = await harness.app.inject({ method: 'GET', url: `/sites/${SLUG}/`, headers: { host: 'cms.local', 'user-agent': GOOGLEBOT } });
    const tag = trackerOf(served.body)!;
    expect(tag.b).toBe('');
    await harness.app.inject({
      method: 'POST',
      url: `/a/${projectId}`,
      headers: { host: 'cms.local', 'content-type': 'text/plain', 'user-agent': GOOGLEBOT },
      payload: JSON.stringify({ r: tag.r, k: tag.k, h: 'cms.local' }),
    });
    const s = (await client.get(`/projects/${projectId}/stats?from=${today()}&to=${today()}`)).json();
    expect(s.botViews).toBe(1);
  });
});

describe('statistics across the site lifecycle', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  let dir: string;
  let statsUrl: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sw-stats-life-'));
    statsUrl = `file:${join(dir, 'analytics.db')}`;
    // The maintenance sweeps run (every 100 ms), so the orphan reap gets its chance at a soft-deleted project.
    harness = await makeHarness({ publishRoot: join(dir, 'sites'), sitesDomain: DOMAIN, publicUrl: 'https://cms.agency.com', statsGeo: geo, statsDbUrl: statsUrl, maintenanceSweepMs: 100 });
    client = await harness.signup({ admin: true });
    projectId = await client.createProject('Example', SLUG, { localHosting: false });
    await client.project(projectId).putContent('settings', 'settings', {
      brand: { name: 'Example', colors: { primary: '#e11' } },
      settings: { defaultLocale: 'en', locales: ['en'] },
      website: { statistics: { enabled: true } },
    });
    await client.project(projectId).putContent('page', 'home', { kind: 'page', title: 'Home', path: '', source: '<h1>Home</h1>' });
    await client.post(`/projects/${projectId}/deploy-targets`, { name: 'Local Hosting', protocol: 'local' });
    expect((await client.post(`/projects/${projectId}/publish`)).statusCode).toBe(200);
  });
  afterEach(async () => {
    await harness.close();
    await rm(dir, { recursive: true, force: true });
  });

  /** The home page's tracker (a copy deployed elsewhere keeps beaconing whatever happens to the project). */
  async function homeTracker() {
    const html = (await harness.app.inject({ method: 'GET', url: '/', headers: { host: SITE_HOST, 'user-agent': CHROME, 'x-forwarded-proto': 'https' } })).body;
    return trackerOf(html);
  }
  const beacon = (tag: { r: string; k: string }, ip: string) =>
    harness.app.inject({
      method: 'POST',
      url: `/a/${projectId}`,
      headers: { host: 'cms.agency.com', 'content-type': 'text/plain', 'user-agent': CHROME },
      payload: JSON.stringify({ r: tag.r, k: tag.k, h: SITE_HOST }),
      remoteAddress: ip,
    });
  /** What is actually stored for the project, read straight from the statistics file — every table. */
  async function stored(): Promise<{ traffic: number; any: boolean }> {
    const store = await StatsStore.open(statsUrl);
    try {
      const [, ...rows] = await store.rows(projectId, 'traffic', '2020-01-01', '2099-12-31');
      return { traffic: rows.length, any: (await store.projectIds()).includes(projectId) };
    } finally {
      store.close();
    }
  }
  const humanViews = async () => (await client.get(`/projects/${projectId}/stats?from=${today()}&to=${today()}`)).json().human.views as number;

  it('★ soft delete stops the counting but keeps the numbers; restore brings them back; the permanent reap deletes them', async () => {
    const tag = (await homeTracker())!;
    await beacon(tag, '1.1.1.1');
    expect(await humanViews()).toBe(1);

    // Soft delete: the site is gone, so a copy elsewhere still beaconing is no longer counted…
    expect((await client.del(`/projects/${projectId}`)).statusCode).toBe(204);
    expect((await beacon(tag, '1.1.1.2')).statusCode).toBe(204);
    // …but what was counted is kept (a restore must find it) — including through the hourly orphan reap, which
    // runs here (and flushes before it looks) and must treat a soft-deleted project as existing.
    await new Promise((r) => setTimeout(r, 400));
    expect(await stored()).toEqual({ traffic: 1, any: true });

    // Restore: the numbers are there — and only those: the beacon sent while it was deleted was not counted (the
    // query flushes first, so a pending count would show here) — and counting resumes.
    expect((await client.post(`/admin/deleted-projects/${projectId}/restore`)).statusCode).toBe(204);
    expect(await humanViews()).toBe(1);
    await beacon(tag, '1.1.1.3');
    expect(await humanViews()).toBe(2);

    // The permanent reap deletes the statistics with the project.
    expect((await client.del(`/projects/${projectId}`)).statusCode).toBe(204);
    expect((await client.del(`/admin/deleted-projects/${projectId}`)).statusCode).toBe(204);
    expect(await stored()).toEqual({ traffic: 0, any: false });
  });
});

describe('the statistics orphan sweep', () => {
  it('★ runs with the maintenance sweeps and removes statistics no project owns', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sw-stats-orphans-'));
    const statsUrl = `file:${join(dir, 'analytics.db')}`;
    const harness = await makeHarness({ statsDbUrl: statsUrl, statsGeo: geo, maintenanceSweepMs: 60 });
    try {
      const client = await harness.signup({ admin: true });
      // A live project and a soft-deleted one, each with statistics — they must survive the sweep…
      const live = await client.createProject('Live', 'live', { localHosting: false });
      const parked = await client.createProject('Parked', 'parked', { localHosting: false });
      expect((await client.del(`/projects/${parked}`)).statusCode).toBe(204);
      // …and the leftovers of a project that is gone (as if its reap's own cleanup had failed) must not.
      const row = (project: string) => ({ project, day: today(), cls: 'human' as const, device: 'desktop' as const, country: 'DE', views: 3, visitors: 1 });
      const planted = await StatsStore.open(statsUrl);
      await planted.apply({
        traffic: [row('ghost'), row(live), row(parked)],
        pages: [{ project: 'ghost', day: today(), path: '/', views: 3, botViews: 0 }],
        sources: [],
        goals: [{ project: 'ghost', day: today(), goal: 'form:x', count: 1 }],
        seen: [{ project: 'ghost', day: today(), ids: [1, 2] }],
      });
      planted.close();
      await vi.waitFor(
        async () => {
          const store = await StatsStore.open(statsUrl);
          try {
            expect((await store.projectIds()).sort()).toEqual([live, parked].sort());
          } finally {
            store.close();
          }
        },
        { timeout: 30_000, interval: 100 },
      );
    } finally {
      await harness.close();
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('★ a bulk purge whose statistics cleanup FAILED is finished by the sweep — even when most sites go at once', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sw-stats-purge-'));
    const statsUrl = `file:${join(dir, 'analytics.db')}`;
    const harness = await makeHarness({ statsDbUrl: statsUrl, statsGeo: geo, maintenanceSweepMs: 60 });
    const forget = vi.spyOn(StatsStore.prototype, 'forget');
    const storedIds = async (): Promise<string[]> => {
      const store = await StatsStore.open(statsUrl);
      try {
        return (await store.projectIds()).sort();
      } finally {
        store.close();
      }
    };
    try {
      const client = await harness.signup({ admin: true });
      const kept = await client.createProject('Kept', 'kept', { localHosting: false });
      const doomed: string[] = [];
      for (let i = 0; i < 4; i++) doomed.push(await client.createProject(`Doomed ${i}`, `doomed-${i}`, { localHosting: false }));
      const row = (project: string) => ({ project, day: today(), cls: 'human' as const, device: 'desktop' as const, country: 'DE', views: 3, visitors: 1 });
      const planted = await StatsStore.open(statsUrl);
      await planted.apply({ traffic: [kept, ...doomed].map(row), pages: [], sources: [], goals: [], seen: [] });
      planted.close();

      // Every statistics cleanup fails while four of the five sites are deleted for good…
      forget.mockRejectedValue(new Error('disk busy'));
      for (const id of doomed) expect((await client.del(`/projects/${id}`)).statusCode).toBe(204);
      expect((await client.del('/admin/deleted-projects')).json()).toEqual({ reaped: 4 });
      // …so their statistics are still there: more than half of all sites, which the orphan brake alone would keep.
      expect(await storedIds()).toEqual([kept, ...doomed].sort());

      // Once the file can be written again, the sweep finishes every purge.
      forget.mockRestore();
      await vi.waitFor(async () => expect(await storedIds()).toEqual([kept]), { timeout: 30_000, interval: 100 });
    } finally {
      forget.mockRestore();
      await harness.close();
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('statistics on a permanent delete', () => {
  let dir: string;
  let statsUrl: string;
  let harness: Harness;
  let client: TestClient;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sw-stats-reap-'));
    statsUrl = `file:${join(dir, 'analytics.db')}`;
    // The default sweep interval: its first run is 30 s away, so nothing below is the sweep's doing.
    harness = await makeHarness({ statsDbUrl: statsUrl, statsGeo: geo });
    client = await harness.signup({ admin: true });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await harness.close();
    await rm(dir, { recursive: true, force: true });
  });
  const inStore = async <T>(read: (store: StatsStore) => Promise<T>): Promise<T> => {
    const store = await StatsStore.open(statsUrl);
    try {
      return await read(store);
    } finally {
      store.close();
    }
  };
  /** Projects with statistics stored, `doomed` of them soft-deleted (ready for the permanent delete). */
  async function sites(live: number, doomed: number): Promise<{ kept: string[]; doomed: string[] }> {
    const ids = { kept: [] as string[], doomed: [] as string[] };
    for (let i = 0; i < live + doomed; i++) {
      const id = await client.createProject(`Site ${i}`, `site-${i}`, { localHosting: false });
      (i < live ? ids.kept : ids.doomed).push(id);
    }
    const row = (project: string) => ({ project, day: today(), cls: 'human' as const, device: 'desktop' as const, country: 'DE', views: 3, visitors: 1 });
    await inStore((s) => s.apply({ traffic: [...ids.kept, ...ids.doomed].map(row), pages: [], sources: [], goals: [], seen: [] }));
    for (const id of ids.doomed) expect((await client.del(`/projects/${id}`)).statusCode).toBe(204);
    return ids;
  }

  it('★ a delete whose LATER step throws (the row already gone) still forgets the statistics — most sites at once', async () => {
    const { kept, doomed } = await sites(1, 4);
    // The custom-domain map is rebuilt right after the row goes; make that throw for every delete.
    vi.spyOn(ProjectDomainRepository.prototype, 'listVerifiedRoutes').mockRejectedValue(new Error('db busy'));
    for (const id of doomed) expect((await client.del(`/admin/deleted-projects/${id}`)).statusCode).toBe(500);
    // Presence: the deletes really happened (the rows are gone), and the one site left keeps its statistics.
    expect((await client.get('/admin/deleted-projects')).json()).toEqual({ projects: [] });
    expect((await inStore((s) => s.projectIds())).sort()).toEqual(kept);
  });

  it('★ the purge is on record BEFORE the project row goes', async () => {
    const { doomed } = await sites(1, 1);
    const id = doomed[0]!;
    const realRemove = ProjectRepository.prototype.remove;
    const onRecordAtRemove: string[][] = [];
    vi.spyOn(ProjectRepository.prototype, 'remove').mockImplementation(async function (this: ProjectRepository, projectId: string) {
      onRecordAtRemove.push(await inStore((s) => s.purgedIds()));
      return realRemove.call(this, projectId);
    });
    expect((await client.del(`/admin/deleted-projects/${id}`)).statusCode).toBe(204);
    expect(onRecordAtRemove).toEqual([[id]]);
    // …and the delete finished the job: nothing of the site is left but the record the next sweep drops.
    expect(await inStore((s) => s.projectIds())).not.toContain(id);
    expect(await inStore((s) => s.purgedIds())).toEqual([id]);
  });
});
