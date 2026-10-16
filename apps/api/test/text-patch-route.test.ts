import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeHarness, type Harness, type TestClient, type ProjectClient } from './harness.js';
import { ContentRepository } from '../src/repo/content.js';
import type { ProjectContext } from '../src/repo/context.js';

/**
 * Open the lost-update window DETERMINISTICALLY: the first time a route reads `kind`, another writer
 * changes the stored entity (via `mutate`) before the route gets to write. In-process requests don't
 * interleave reliably on their own — a burst of concurrent requests passed with the guard switched off.
 */
function interleaveOnce(kind: string, mutate: (item: Record<string, unknown>) => Record<string, unknown>): void {
  const original = ContentRepository.prototype.getWithVersion;
  let fired = false;
  vi.spyOn(ContentRepository.prototype, 'getWithVersion').mockImplementation(async function (this: ContentRepository, ...args) {
    const read = await original.apply(this, args);
    if (!fired && args[1] === kind) {
      fired = true;
      const [ctx, k, id] = args as [ProjectContext, Parameters<typeof original>[1], string];
      await this.put(ctx, k, id, mutate(read.item as Record<string, unknown>));
    }
    return read; // the STALE copy — exactly what the route would have merged into
  });
}

// POST /projects/:id/content/:kind/:id/text-patch — find-and-replace inside ONE text field, so a
// two-line fix no longer re-sends a 20 KB page. Plus the lost-update guard every server-side
// read-modify-write now carries: a write landing between the route's read and its write used to be
// silently reverted by `?merge=1` and the stylesheet patch (every call 200).

const SOURCE = '<section><h1 data-sw-text="title">Hello</h1><p>One</p><p>Two</p><p>Two</p></section>';

describe('text-patch', () => {
  let harness: Harness;
  let client: TestClient;
  let proj: ProjectClient;

  beforeEach(async () => {
    harness = await makeHarness();
    client = await harness.signup();
    proj = client.project(await client.createProject('Site', 'site'));
    expect((await proj.putContent('page', 'home', { id: 'home', path: '', title: 'Home', source: SOURCE })).statusCode).toBe(200);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await harness.close();
  });

  const patch = (kind: string, id: string, body: unknown) => client.post(`${proj.base}/content/${kind}/${id}/text-patch`, body);
  const source = async (): Promise<string> => ((await proj.getContent('page', 'home')).json() as { item: { source: string } }).item.source;

  it('replaces the anchored text, keeps every other field, and returns a receipt — not the text', async () => {
    const res = await patch('page', 'home', { field: 'source', edits: [{ old: '<p>One</p>', new: '<p>Uno</p>' }] });
    expect(res.statusCode).toBe(200);
    const receipt = res.json() as Record<string, unknown>;
    expect(receipt).toMatchObject({ kind: 'page', id: 'home', field: 'source', edits: 1, replacements: 1, changed: true });
    expect(receipt).toMatchObject({ bytes: SOURCE.length, bytesBefore: SOURCE.length });
    expect(typeof receipt.version).toBe('string');
    expect(JSON.stringify(receipt)).not.toContain('<section>');
    expect(await source()).toBe(SOURCE.replace('<p>One</p>', '<p>Uno</p>'));
    const page = (await proj.getContent('page', 'home')).json() as { item: { title: string } };
    expect(page.item.title).toBe('Home');
  });

  it('refuses an ambiguous or missing anchor with 422 and writes NOTHING (all-or-nothing)', async () => {
    const ambiguous = await patch('page', 'home', { field: 'source', edits: [{ old: '<p>One</p>', new: 'x' }, { old: '<p>Two</p>', new: 'y' }] });
    expect(ambiguous.statusCode).toBe(422);
    expect(ambiguous.json()).toMatchObject({ edit: 1, found: 2 });
    const missing = await patch('page', 'home', { field: 'source', edits: [{ old: '<p>Three</p>', new: 'z' }] });
    expect(missing.statusCode).toBe(422);
    expect((missing.json() as { error: string }).error).toMatch(/not found/);
    expect(await source()).toBe(SOURCE); // the first, matching edit of the refused batch did not land either
  });

  it('replaces every occurrence with all:true', async () => {
    const res = await patch('page', 'home', { field: 'source', edits: [{ old: '<p>Two</p>', new: '<p>2</p>', all: true }] });
    expect(res.json()).toMatchObject({ replacements: 2 });
    expect(await source()).toContain('<p>2</p><p>2</p>');
  });

  it('validates the result exactly like a full save (an unsafe template is refused)', async () => {
    // A bare value in a URL attribute — the template-safety gate every full save runs.
    const res = await patch('page', 'home', { field: 'source', edits: [{ old: '<p>One</p>', new: '<a href="{{ page.title }}">x</a>' }] });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toMatch(/sw-url/);
    expect(await source()).toBe(SOURCE);
  });

  it('patches a settings chrome slot and the stylesheet, keeping every sibling', async () => {
    const settings = (await proj.getContent('settings', 'settings')).json() as { item: Record<string, unknown> };
    const website = (settings.item.website ?? {}) as Record<string, unknown>;
    expect(
      (await proj.putContent('settings', 'settings', { ...settings.item, website: { ...website, footer: '<div>© Acme</div>', criticalCss: '.a{color:red}' } })).statusCode,
    ).toBe(200);
    expect((await patch('settings', 'settings', { field: 'website.footer', edits: [{ old: 'Acme', new: 'Acme GmbH' }] })).statusCode).toBe(200);
    expect((await patch('settings', 'settings', { field: 'website.criticalCss', edits: [{ old: 'red', new: 'blue' }] })).statusCode).toBe(200);
    const after = ((await proj.getContent('settings', 'settings')).json() as { item: { identity: unknown; website: Record<string, unknown> } }).item;
    expect(after.website.footer).toBe('<div>© Acme GmbH</div>');
    expect(after.website.criticalCss).toBe('.a{color:blue}');
    expect(after.identity).toEqual(settings.item.identity);
  });

  it('refuses a field outside the allowlist, a kind with no text field, and a missing entity', async () => {
    const head = await patch('settings', 'settings', { field: 'website.head', edits: [{ old: 'a', new: 'b' }] });
    expect(head.statusCode).toBe(400);
    expect((head.json() as { error: string }).error).toMatch(/website\.footer/);
    expect((await patch('dataset', 'x', { field: 'name', edits: [{ old: 'a', new: 'b' }] })).statusCode).toBe(400);
    expect((await patch('page', 'nope', { field: 'source', edits: [{ old: 'a', new: 'b' }] })).statusCode).toBe(404);
    expect((await patch('page', 'home', { field: 'source', edits: [] })).statusCode).toBe(400);
  });

  it('a caller-pinned If-Match LOSES a race with 409 instead of re-applying', async () => {
    const res = await client.inject({
      method: 'POST',
      url: `${proj.base}/content/page/home/text-patch`,
      headers: { 'if-match': '"stale-version"' },
      payload: { field: 'source', edits: [{ old: '<p>One</p>', new: 'x' }] },
    });
    expect(res.statusCode).toBe(409);
    expect(await source()).toBe(SOURCE);
  });

  it('a write that lands between its read and its write is NOT reverted — the edit is re-applied on top', async () => {
    interleaveOnce('page', (page) => ({ ...page, title: 'Renamed meanwhile', source: `${page.source as string}<!--other-->` }));
    const res = await patch('page', 'home', { field: 'source', edits: [{ old: '<p>One</p>', new: '<p>Uno</p>' }] });
    expect(res.statusCode).toBe(200);
    const page = ((await proj.getContent('page', 'home')).json() as { item: { title: string; source: string } }).item;
    expect(page.title).toBe('Renamed meanwhile');
    expect(page.source).toContain('<!--other-->');
    expect(page.source).toContain('<p>Uno</p>');
  });
});

describe('server-side read-modify-writes no longer revert a concurrent writer', () => {
  let harness: Harness;
  let client: TestClient;
  let proj: ProjectClient;

  beforeEach(async () => {
    harness = await makeHarness();
    client = await harness.signup();
    proj = client.project(await client.createProject('Site', 'site'));
  });

  afterEach(async () => {
    await harness.close();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const intrude = (settings: Record<string, unknown>) => {
    const website = (settings.website ?? {}) as Record<string, unknown>;
    return { ...settings, website: { ...website, data: { ...((website.data ?? {}) as object), intruder: 'kept' }, criticalCss: `${(website.criticalCss as string | undefined) ?? ''}.intruder{}` } };
  };
  const stored = async () => ((await proj.getContent('settings', 'settings')).json() as { item: { website: { data?: Record<string, unknown>; criticalCss?: string } } }).item.website;

  it('?merge=1: a concurrent settings write survives a fragment merged from an older read', async () => {
    interleaveOnce('settings', intrude);
    const res = await client.put(`${proj.base}/content/settings/settings?merge=1&receipt=1`, { website: { data: { mine: 'set' } } });
    expect(res.statusCode).toBe(200);
    const website = await stored();
    expect(website.data).toMatchObject({ intruder: 'kept', mine: 'set' });
  });

  it('patch_critical_css: a concurrent settings write survives the block upsert', async () => {
    interleaveOnce('settings', intrude);
    const res = await client.post(`${proj.base}/critical-css`, { block: 'nav', css: '.nav{color:red}' });
    expect(res.statusCode).toBe(200);
    const website = await stored();
    expect(website.criticalCss).toContain('.intruder{}');
    expect(website.criticalCss).toContain('.nav{color:red}');
    expect(website.data).toMatchObject({ intruder: 'kept' });
  });

  it('?merge=1 with a caller-pinned If-Match still refuses a stale version (no silent re-apply)', async () => {
    const res = await client.inject({
      method: 'PUT',
      url: `${proj.base}/content/settings/settings?merge=1`,
      headers: { 'if-match': '"stale-version"' },
      payload: { website: { data: { x: 1 } } },
    });
    expect(res.statusCode).toBe(409);
  });
});
