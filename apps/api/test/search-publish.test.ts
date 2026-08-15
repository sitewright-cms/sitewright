import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import { decodeDeltas, type SearchIndexFile, type SearchTextFile } from '../src/publish/search-index.js';

// Integration: the site-search index the publish build emits (docs/site-search.md §3).
// The index is written in the SAME pass that renders the HTML, so these assertions are about
// what a real publish produces — not about the assembly module in isolation.

describe('site-search index emission', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  const slug = 'searchsite';
  let publishRoot: string;
  let mediaRoot: string;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-search-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-search-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot });
    client = await harness.signup();
    projectId = await client.createProject('Search Site', slug);
  });

  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  const root = { id: 'r', type: 'Section' as const };
  /**
   * Write the settings singleton, FAILING LOUDLY. `settings` is required by SettingsSchema, and a
   * payload omitting it 400s — which silently left the project on its scaffolded defaults and made
   * the chrome-exclusion test below prove nothing (the nav never held the word it asserted absent).
   */
  const putSettings = async (website?: Record<string, unknown>): Promise<void> => {
    // The index only ships when the site actually renders a Search component (only-used-ships), so
    // every fixture puts the box in the FOOTER slot: chrome is never indexed, so it satisfies the
    // gate without adding a single token to any page's corpus.
    const withSearch = { ...(website ?? {}) };
    withSearch.footer = `${(withSearch.footer as string | undefined) ?? ''}<div>{{sw-search}}</div>`;
    const res = await client.project(projectId).putContent('settings', 'settings', {
      identity: { name: 'Acme', colors: { primary: '#0a7' } },
      settings: { defaultLocale: 'en', locales: ['en'] },
      website: withSearch,
    });
    const code = (res as { statusCode?: number }).statusCode;
    if (code !== undefined && code !== 200) throw new Error(`settings write failed ${code}: ${(res as { body?: string }).body}`);
  };

  /** Publish, surfacing the server's message — a bare status hides PublishError, which is also 409. */
  const publish = async (): Promise<void> => {
    const res = await client.post(`${client.project(projectId).base}/publish`);
    if (res.statusCode !== 200) throw new Error(`publish failed ${res.statusCode}: ${res.body}`);
  };
  const readIndex = async (name = 'search-index.json'): Promise<SearchIndexFile> =>
    JSON.parse(await readFile(join(publishRoot, slug, name), 'utf8')) as SearchIndexFile;
  const readText = async (name = 'search-text.json'): Promise<SearchTextFile> =>
    JSON.parse(await readFile(join(publishRoot, slug, name), 'utf8')) as SearchTextFile;

  it('indexes page bodies and NEVER the shared chrome', async () => {
    const proj = client.project(projectId);
    // The nav carries a word that appears on no page body. If chrome leaked into the index,
    // every page would match it — the ranking-collapse failure this asserts against.
    // `<div>`/`<ul>`, not `<nav>`/`<footer>`: the skeleton owns those landmarks and the slot
    // validator rejects them — which is how this test found its own settings write was 400ing.
    await putSettings({
      mainNav: '<div><a href="/">Chromeword</a></div>',
      footer: '<div>Footerword</div>',
    });
    await proj.putContent('page', 'home', {
      id: 'home', path: '', title: 'Home', root,
      source: '<section><h1>Roofing</h1><p>We fit slate roofs in Dortmund</p></section>',
    });
    await publish();

    const index = await readIndex();
    expect(index.terms['dortmund']).toBeDefined();
    expect(index.terms['slate']).toBeDefined();
    // ★ The assertion that matters: shared chrome is not in the corpus.
    expect(index.terms['chromeword']).toBeUndefined();
    expect(index.terms['footerword']).toBeUndefined();
  });

  it('stores page URLs with a trailing slash, like the sitemap', async () => {
    // A page builds to `<slug>/index.html`. A slash-less `/roofing` 404s on any host that does not
    // silently redirect to the directory index — caught by clicking a result in a real browser,
    // never by jsdom. `siteUrlFor` (seo.ts) already uses this form for the sitemap.
    const proj = client.project(projectId);
    await putSettings();
    await proj.putContent('page', 'home', { id: 'home', path: '', title: 'Home', root, source: '<p>homeword</p>' });
    await proj.putContent('page', 'roofing', {
      id: 'roofing', path: 'roofing', title: 'Roofing', root, source: '<p>roofword</p>',
    });
    await publish();

    expect((await readIndex()).pages.map((p) => p.u).sort()).toEqual(['/', '/roofing/']);
  });

  it('captures the title, description and headings as fields', async () => {
    const proj = client.project(projectId);
    await putSettings();
    await proj.putContent('page', 'home', {
      id: 'home', path: '', title: 'Leistungen', description: 'Alles rund ums Dach', root,
      source: '<section><h1>Unsere Leistungen</h1><p>text</p></section>',
    });
    await publish();

    const index = await readIndex();
    const row = index.pages[0];
    if (!row) throw new Error('expected a page row');
    expect(row.t).toBe('Leistungen');
    expect(row.d).toBe('Alles rund ums Dach');
    expect(row.f.h1).toEqual(['unsere', 'leistungen']);
    expect(row.nv).toBe(0);
  });

  it('excludes noindex pages, matching the sitemap', async () => {
    const proj = client.project(projectId);
    await putSettings();
    await proj.putContent('page', 'home', { id: 'home', path: '', title: 'Home', root, source: '<p>publicword</p>' });
    await proj.putContent('page', 'secret', {
      id: 'secret', path: 'secret', title: 'Secret', noindex: true, root, source: '<p>secretword</p>',
    });
    await publish();

    const index = await readIndex();
    expect(index.terms['publicword']).toBeDefined();
    expect(index.terms['secretword']).toBeUndefined();
    expect(index.pages.map((p) => p.u)).toEqual(['/']);
  });

  it('excludes raw-fidelity imports and REPORTS how many it skipped', async () => {
    const proj = client.project(projectId);
    await putSettings();
    await proj.putContent('page', 'home', { id: 'home', path: '', title: 'Home', root, source: '<p>nativeword</p>' });
    await proj.putContent('page', 'imported', {
      id: 'imported', path: 'imported', title: 'Imported', rawHtml: true, root,
      source: '<html><body><p>importedword</p></body></html>',
    });
    await publish();

    const index = await readIndex();
    expect(index.terms['nativeword']).toBeDefined();
    expect(index.terms['importedword']).toBeUndefined();
    // Skipped, not silently: the count rides in the release manifest.
    const manifest = JSON.parse(await readFile(join(publishRoot, slug, 'release.json'), 'utf8')) as {
      searchSkippedRawHtml?: number;
    };
    expect(manifest.searchSkippedRawHtml).toBe(1);
  });

  it('indexes a page once nativized, with no import-specific path', async () => {
    // The other half of the rule: nativizing is the ONLY thing required to make a page findable.
    const proj = client.project(projectId);
    await putSettings();
    // A normal page keeps the index non-empty, so this asserts the raw page's own membership
    // rather than the separate "site with nothing to index" case below.
    await proj.putContent('page', 'home', { id: 'home', path: '', title: 'Home', root, source: '<p>anchorword</p>' });
    await proj.putContent('page', 'imported', {
      id: 'imported', path: 'imported', title: 'Imported', rawHtml: true, root,
      source: '<html><body><p>laterword</p></body></html>',
    });
    await publish();
    expect((await readIndex()).terms['laterword']).toBeUndefined();

    // Nativize: the same page and the same words, no longer a raw-fidelity replica.
    await proj.putContent('page', 'imported', {
      id: 'imported', path: 'imported', title: 'Imported', rawHtml: false, root,
      source: '<section><p>laterword</p></section>',
    });
    await publish();
    expect((await readIndex()).terms['laterword']).toBeDefined();
  });

  it('writes the resolved folding setting INTO the index', async () => {
    // The browser cannot read website settings. If the build stopped folding and the runtime kept
    // folding, queries would silently stop matching — so the resolved value travels in the file.
    const proj = client.project(projectId);
    await putSettings({ search: { foldDiacritics: false } });
    await proj.putContent('page', 'home', { id: 'home', path: '', title: 'Home', root, source: '<p>Åre</p>' });
    await publish();

    const index = await readIndex();
    expect(index.fold).toBe(false);
    expect(index.terms['åre']).toBeDefined();
    expect(index.terms['are']).toBeUndefined();
  });

  it('leaves the index unchanged when folding is left at its default', async () => {
    const proj = client.project(projectId);
    await putSettings();
    await proj.putContent('page', 'home', { id: 'home', path: '', title: 'Home', root, source: '<p>Åre</p>' });
    await publish();

    const index = await readIndex();
    expect(index.fold).toBeUndefined();
    expect(index.terms['are']).toBeDefined();
  });

  it('emits NO index when the site has no search box (only-used-ships)', async () => {
    // A bulk full-text file should not be published by a site that never searches it.
    const proj = client.project(projectId);
    const res = await proj.putContent('settings', 'settings', {
      identity: { name: 'Acme', colors: { primary: '#0a7' } },
      settings: { defaultLocale: 'en', locales: ['en'] },
    });
    expect((res as { statusCode?: number }).statusCode ?? 200).toBe(200);
    await proj.putContent('page', 'home', { id: 'home', path: '', title: 'Home', root, source: '<p>plentyword</p>' });
    await publish();
    await expect(readIndex()).rejects.toThrow(/ENOENT/);
  });

  it('emits nothing when there is nothing to index', async () => {
    // A site whose only page is a raw-fidelity import has an empty corpus. No file is written, and
    // the runtime's documented response to a 404 index is to leave the search box inert (§3.6).
    const proj = client.project(projectId);
    await putSettings();
    await proj.putContent('page', 'home', {
      id: 'home', path: '', title: 'Imported', rawHtml: true, root, source: '<html><body><p>only</p></body></html>',
    });
    await publish();
    await expect(readIndex()).rejects.toThrow(/ENOENT/);
  });

  it('emits one index pair per locale', async () => {
    const proj = client.project(projectId);
    const res = await proj.putContent('settings', 'settings', {
      identity: { name: 'Acme', colors: { primary: '#0a7' } },
      settings: { defaultLocale: 'en', locales: ['en', 'de'] },
      website: { footer: '<div>{{sw-search}}</div>' },
    });
    expect((res as { statusCode?: number }).statusCode ?? 200).toBe(200);
    await proj.putContent('page', 'home', {
      id: 'home', path: '', title: 'Home', translationGroup: 'home', root, source: '<p>englishword</p>',
    });
    await proj.putContent('page', 'home-de', {
      id: 'home-de', path: 'de', parent: 'home', title: 'Startseite', locale: 'de', translationGroup: 'home', root,
      source: '<p>germanword</p>',
    });
    await publish();

    const en = await readIndex();
    const de = await readIndex('search-index.de.json');
    expect(en.lang).toBe('en');
    expect(de.lang).toBe('de');
    // A term from one language never surfaces in the other language's index.
    expect(en.terms['englishword']).toBeDefined();
    expect(en.terms['germanword']).toBeUndefined();
    expect(de.terms['germanword']).toBeDefined();
    expect(de.terms['englishword']).toBeUndefined();
  });

  it('emits text + offsets that slice back to the matched term', async () => {
    const proj = client.project(projectId);
    await putSettings();
    await proj.putContent('page', 'home', {
      id: 'home', path: '', title: 'Home', root, source: '<section><p>alpha beta gamma</p></section>',
    });
    await publish();

    const index = await readIndex();
    const text = await readText();
    const posting = index.terms['gamma']?.[0];
    if (!posting) throw new Error('expected a gamma posting');
    const ordinal = decodeDeltas(posting[1])[0];
    const offsets = decodeDeltas(text.offsets[0] ?? []);
    if (ordinal === undefined) throw new Error('expected an ordinal');
    const at = offsets[ordinal];
    if (at === undefined) throw new Error('expected an offset');
    expect((text.text[0] ?? '').slice(at, at + 5)).toBe('gamma');
  });
});
