import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import { RenderPool } from '../src/render/render-pool.js';
import { ContentRepository } from '../src/repo/content.js';

const workerPath = fileURLToPath(new URL('./fixtures/blocks-render-worker.mjs', import.meta.url));

// A dataset ROW carries its other languages (`entry.translations`): only the fields that differ, any
// field — the rest follows the main language. Translated pages INHERIT the main page's source, so one
// loop written once must render each row in the reader's language on every surface: published pages,
// the editor preview, the code-editor render — and a REFERENCE (read with sw-pick-entry) must land on the
// referenced row in that language too.

const root = { id: 'r', type: 'Section' as const };
const SOURCE =
  '<section>' +
  '{{#each dataset.services}}<div class="svc-{{@entry.id}}"><h3>{{title}}</h3><span>{{price}}</span>' +
  '{{#sw-pick-entry "team" lead}}<i>{{role}}</i>{{/sw-pick-entry}}</div>{{/each}}' +
  '<b class="item">{{item.services.web.title}}</b>' +
  '</section>';

/** The text of the first element whose class is `cls`, tags stripped. */
const textOf = (html: string, cls: string): string | undefined =>
  new RegExp(`class="${cls}"[^>]*>(.*?)</(?:div|b)>`, 's').exec(html)?.[1]?.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');

describe('dataset entries in the reader’s language', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  const slug = 'site';
  let publishRoot: string;
  let mediaRoot: string;
  const proj = () => client.project(projectId);
  const getEntry = async (dataset: string, id: string) =>
    (await client.get(`/projects/${projectId}/content/entry/${id}?dataset=${dataset}`)).json() as { item: Record<string, unknown> };

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-entry-tr-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-entry-tr-media-'));
    harness = await makeHarness({ publishRoot, mediaRoot, renderPool: new RenderPool({ size: 1, workerPath }) });
    client = await harness.signup();
    projectId = await client.createProject('Site', slug);
    await proj().putContent('settings', 'settings', {
      identity: { name: 'Acme', colors: { primary: '#0a7' } },
      settings: { defaultLocale: 'en', locales: ['en', 'de'] },
      website: {},
    });
    await proj().putContent('dataset', 'team', { id: 'team', name: 'Team', slug: 'team', fields: [{ name: 'name', type: 'text' }, { name: 'role', type: 'text' }] });
    await proj().putContent('dataset', 'services', {
      id: 'services', name: 'Services', slug: 'services',
      fields: [{ name: 'title', type: 'text' }, { name: 'price', type: 'number' }, { name: 'lead', type: 'reference', config: { dataset: 'team' } }],
    });
    await proj().putContent('entry', 'ana', { id: 'ana', dataset: 'team', status: 'published', values: { name: 'Ana', role: 'Designer' }, translations: { de: { role: 'Gestalterin' } } });
    await proj().putContent('entry', 'web', {
      id: 'web', dataset: 'services', status: 'published', values: { title: 'Web design', price: 900, lead: 'ana' },
      // Copied whole, as the editor's "Translate" button does — only the title actually differs.
      translations: { de: { title: 'Webdesign', price: 900, lead: 'ana' } },
    });
    await proj().putContent('entry', 'seo', { id: 'seo', dataset: 'services', status: 'published', values: { title: 'SEO', price: 400, lead: 'ana' } });
    await proj().putContent('page', 'home', { id: 'home', path: '', title: 'Home', root, translationGroup: 'home', source: SOURCE });
    // The German home INHERITS the main page's source.
    await proj().putContent('page', 'home-de', { id: 'home-de', path: 'de', parent: 'home', title: 'Start', locale: 'de', translationGroup: 'home', root });
  });

  afterEach(async () => {
    await harness.close();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  it('★ stores only what differs: the copied price and reference keep following the main language', async () => {
    const web = (await getEntry('services', 'web')).item;
    expect(web.translations).toEqual({ de: { title: 'Webdesign' } });
  });

  it('★ publish: the German page shows each row in German, the rest — and the references — follow', async () => {
    // A price changed in the main language after translating reaches the German page too.
    expect((await client.put(`${proj().base}/content/entry/web?merge=1`, { dataset: 'services', values: { price: 950 } })).statusCode).toBe(200);
    expect((await client.post(`${proj().base}/publish`)).statusCode).toBe(200);

    const de = (await client.get(`/sites/${slug}/de/index.html`)).body;
    expect(textOf(de, 'svc-web')).toBe('|Webdesign|950|Gestalterin|');
    expect(textOf(de, 'svc-seo')).toBe('|SEO|400|Gestalterin|'); // untranslated row: main language, German reference
    expect(textOf(de, 'item')).toBe('Webdesign');

    const en = (await client.get(`/sites/${slug}/index.html`)).body;
    expect(textOf(en, 'svc-web')).toBe('|Web design|950|Designer|');
    expect(textOf(en, 'item')).toBe('Web design');
  });

  it('editor preview and the code-editor render show the German rows on a German page', async () => {
    const preview = await client.post(`/projects/${projectId}/preview`, {
      id: 'home-de', path: 'de', parent: 'home', title: 'Start', locale: 'de', translationGroup: 'home', root,
    });
    expect(preview.statusCode).toBe(200);
    expect(textOf((preview.json() as { html: string }).html, 'svc-web')).toBe('|Webdesign|900|Gestalterin|');

    await proj().putContent('page', 'home-de', {
      id: 'home-de', path: 'de', parent: 'home', title: 'Start', locale: 'de', translationGroup: 'home', root, source: SOURCE,
    });
    const rendered = await client.post(`/projects/${projectId}/render-template`, { pageId: 'home-de' });
    expect(rendered.statusCode).toBe(200);
    expect(textOf((rendered.json() as { html: string }).html, 'svc-web')).toBe('|Webdesign|900|Gestalterin|');
  });

  it('a <slug>_<locale> dataset still wins over entry translations for its language', async () => {
    await proj().putContent('dataset', 'services_de', { id: 'services_de', name: 'Services DE', slug: 'services_de', fields: [{ name: 'title', type: 'text' }] });
    await proj().putContent('entry', 'web', { id: 'web', dataset: 'services_de', status: 'published', values: { title: 'Webdesign (Kopie)', price: 1, lead: 'ana' } });
    expect((await client.post(`${proj().base}/publish`)).statusCode).toBe(200);
    const de = (await client.get(`/sites/${slug}/de/index.html`)).body;
    expect(textOf(de, 'svc-web')).toBe('|Webdesign (Kopie)|1|Gestalterin|');
    expect(textOf(de, 'svc-seo')).toBeUndefined(); // the copy has no "seo" row
  });

  it('★ merge writes one language, null makes a field follow again, and null on a language removes it', async () => {
    const put = (body: unknown) => client.put(`${proj().base}/content/entry/web?merge=1`, body);
    expect((await put({ dataset: 'services', translations: { de: { price: 990 } } })).statusCode).toBe(200);
    expect((await getEntry('services', 'web')).item.translations).toEqual({ de: { title: 'Webdesign', price: 990 } });

    expect((await put({ dataset: 'services', translations: { de: { price: null } } })).statusCode).toBe(200);
    expect((await getEntry('services', 'web')).item.translations).toEqual({ de: { title: 'Webdesign' } });

    expect((await put({ dataset: 'services', translations: { de: null } })).statusCode).toBe(200);
    expect((await getEntry('services', 'web')).item).not.toHaveProperty('translations.de');
  });

  it('refuses a language the site does not have, and the main language — naming what it does have', async () => {
    const fr = await client.put(`${proj().base}/content/entry/seo?merge=1`, { dataset: 'services', translations: { fr: { title: 'Référencement' } } });
    expect(fr.statusCode).toBe(409);
    expect(fr.json().error).toMatch(/no "fr" language.*de/);

    const en = await client.put(`${proj().base}/content/entry/seo?merge=1`, { dataset: 'services', translations: { en: { title: 'Search' } } });
    expect(en.statusCode).toBe(409);
    expect(en.json().error).toMatch(/main language/);

    const bad = await client.put(`${proj().base}/content/entry/seo?merge=1`, { dataset: 'services', translations: { 'de de': { title: 'x' } } });
    expect(bad.statusCode).toBe(400);
  });

  it('★ removing a language takes its version out of every entry — and History keeps it', async () => {
    expect((await client.del(`/projects/${projectId}/locales/de`)).statusCode).toBe(200);
    expect((await getEntry('services', 'web')).item).not.toHaveProperty('translations');
    expect((await getEntry('team', 'ana')).item).not.toHaveProperty('translations');

    const base = `/projects/${projectId}/content/entry/web/revisions`;
    const items = ((await client.get(`${base}?dataset=services`)).json() as { items: Array<{ id: string; note?: string }> }).items;
    const before = items.find((r) => r.note === 'Before its language was removed');
    expect(before).toBeDefined();
    const snapshot = (await client.get(`${base}/${before!.id}`)).json() as { revision: { data: { translations?: unknown } } };
    expect(snapshot.revision.data.translations).toEqual({ de: { title: 'Webdesign' } });
  });

  it('★ removing a language does not revert an edit saved while it runs', async () => {
    // Open the window deterministically: the moment the removal has listed the entries, another writer
    // saves a new price. Rewriting from that list would put the old price back.
    const list = ContentRepository.prototype.list;
    let raced = false;
    const spy = vi.spyOn(ContentRepository.prototype, 'list').mockImplementation(async function (this: ContentRepository, ...args) {
      const out = await list.apply(this, args);
      if (args[1] === 'entry' && !raced) {
        raced = true;
        spy.mockRestore();
        expect((await client.put(`${proj().base}/content/entry/web?merge=1`, { dataset: 'services', values: { price: 777 } })).statusCode).toBe(200);
      }
      return out;
    });
    try {
      expect((await client.del(`/projects/${projectId}/locales/de`)).statusCode).toBe(200);
    } finally {
      spy.mockRestore();
    }
    expect(raced).toBe(true);
    const web = (await getEntry('services', 'web')).item;
    expect(web.values).toMatchObject({ price: 777 });
    expect(web).not.toHaveProperty('translations');
  });

  it('★ History restores the version kept before a language was removed — without that language, and says so', async () => {
    expect((await client.del(`/projects/${projectId}/locales/de`)).statusCode).toBe(200);
    const base = `/projects/${projectId}/content/entry/web/revisions`;
    const items = ((await client.get(`${base}?dataset=services`)).json() as { items: Array<{ id: string; note?: string }> }).items;
    const before = items.find((r) => r.note === 'Before its language was removed')!;
    const restored = await client.post(`${base}/${before.id}/restore?dataset=services`);
    expect(restored.statusCode).toBe(200);
    expect((await getEntry('services', 'web')).item).not.toHaveProperty('translations');
    const after = ((await client.get(`${base}?dataset=services`)).json() as { items: Array<{ op: string; note?: string }> }).items;
    expect(after.find((r) => r.op === 'restore')?.note).toMatch(/without de, no longer a language of the site/);
  });

  it('a bundle import keeps only the site’s other languages, and only what differs', async () => {
    const res = await client.post(`/projects/${projectId}/import`, {
      entries: [{
        id: 'ux', dataset: 'services', status: 'published', values: { title: 'UX', price: 300 },
        translations: { de: { title: 'UX-Design', price: 300 }, fr: { title: 'Design UX' }, en: { title: 'Main?' } },
      }],
      datasets: [{ id: 'services', name: 'Services', slug: 'services', fields: [{ name: 'title', type: 'text' }] }],
    });
    expect(res.statusCode).toBe(200);
    expect((await getEntry('services', 'ux')).item.translations).toEqual({ de: { title: 'UX-Design' } });
  });

  it('a data file with a locale emits that language’s rows', async () => {
    await proj().putContent('settings', 'settings', {
      identity: { name: 'Acme', colors: { primary: '#0a7' } },
      settings: { defaultLocale: 'en', locales: ['en', 'de'] },
      website: { dataFiles: [{ path: 'services-de.json', dataset: 'services', fields: ['title'], locale: 'de' }, { path: 'services.json', dataset: 'services', fields: ['title'] }] },
    });
    expect((await client.post(`${proj().base}/publish`)).statusCode).toBe(200);
    const de = JSON.parse(await readFile(join(publishRoot, slug, 'data', 'services-de.json'), 'utf8')) as unknown;
    const en = JSON.parse(await readFile(join(publishRoot, slug, 'data', 'services.json'), 'utf8')) as unknown;
    expect(JSON.stringify(de)).toContain('Webdesign');
    expect(JSON.stringify(en)).toContain('Web design');
    expect(JSON.stringify(en)).not.toContain('Webdesign');
  });
});
