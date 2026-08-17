import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeHarness, type Harness, type TestClient, type ProjectClient } from './harness.js';

// The content LIST endpoint gained `?limit`/`?offset` and `?summary=1`, but a caller still could not
// SEARCH, and `?dataset=` refused to combine with `?limit` (the dataset filter ran in memory AFTER the
// page was taken, which would have returned "the first N rows of ALL datasets that happen to be X").
// These tests pin the search semantics, the now-composable dataset scope, and — most importantly — that
// the default response is unchanged for every existing caller.

let harness: Harness;
let client: TestClient;
let project: ProjectClient;

beforeEach(async () => {
  harness = await makeHarness();
  client = await harness.signup();
  project = client.project(await client.createProject('Site', 'query-site', { localHosting: false }));
});
afterEach(async () => {
  await harness.close();
});

const list = async (query: string): Promise<{ status: number; body: Record<string, unknown> }> => {
  const res = await client.get(`${project.base}/content/${query}`);
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
};
const ids = (body: Record<string, unknown>): string[] =>
  (body.items as Array<{ id: string }>).map((i) => i.id).sort();

async function seed(): Promise<void> {
  await project.importBundle({
    pages: [
      { id: 'home', path: '', title: 'Home', source: '<p>h</p>' },
      { id: 'about', path: 'about-us', title: 'About the studio', description: 'Who we are', source: '<p>a</p>' },
      { id: 'contact', path: 'contact', title: 'Contact', description: 'Reach the STUDIO team', source: '<p>c</p>' },
      { id: 'pricing', path: 'pricing', title: 'Pricing', source: '<p>p</p>' },
      { id: 'odd', path: 'odd-100', title: '100% cotton_shirt', source: '<p>o</p>' },
    ],
    datasets: [
      { id: 'news', name: 'News', slug: 'news', fields: [{ name: 'title', type: 'text' }] },
      { id: 'shop', name: 'Shop', slug: 'shop', fields: [{ name: 'title', type: 'text' }] },
    ],
    entries: [
      { id: 'n_1', dataset: 'news', status: 'published', values: { title: 'Sports day' } },
      { id: 'n_2', dataset: 'news', status: 'published', values: { title: 'Choir concert' } },
      { id: 'n_3', dataset: 'news', status: 'published', values: { title: 'Sports awards' } },
      { id: 's_1', dataset: 'shop', status: 'published', values: { title: 'Sports shirt' } },
    ],
  });
}

describe('content list: ?q= search', () => {
  beforeEach(seed);

  it('matches a page TITLE, case-insensitively', async () => {
    const { body } = await list('page?q=about');
    expect(ids(body)).toEqual(['about']);
  });

  it('matches the PATH and the DESCRIPTION too, not just the title', async () => {
    expect(ids((await list('page?q=about-us')).body)).toEqual(['about']);
    // "STUDIO" appears in one title and one description — both are hits.
    expect(ids((await list('page?q=studio')).body)).toEqual(['about', 'contact']);
  });

  it('searches an ENTRY across its stored values', async () => {
    const { body } = await list('entry?q=sports');
    expect(ids(body)).toEqual(['n_1', 'n_3', 's_1']);
  });

  it('treats LIKE wildcards in the query as literal characters', async () => {
    // Unescaped, "100%" would match every row via the trailing wildcard, and "_" any single character.
    expect(ids((await list('page?q=100%25')).body)).toEqual(['odd']);
    expect(ids((await list('page?q=cotton_shirt')).body)).toEqual(['odd']);
    // A bare wildcard must match the pages that literally contain it — here, none.
    expect(ids((await list('page?q=%25%25')).body)).toEqual([]);
  });

  it('returns an empty list (not everything) when nothing matches', async () => {
    expect(ids((await list('page?q=zzzznope')).body)).toEqual([]);
  });

  it('composes with pagination, and `total` counts the MATCHES not the kind', async () => {
    const { body } = await list('entry?q=sports&limit=2');
    expect((body.items as unknown[]).length).toBe(2);
    expect(body.total).toBe(3); // 3 entries match "sports", not the 4 entries that exist
  });

  it('rejects an over-long query rather than scanning with it', async () => {
    const { status } = await list(`page?q=${'a'.repeat(300)}`);
    expect(status).toBe(400);
  });
});

describe('content list: ?dataset= now composes with ?limit=', () => {
  beforeEach(seed);

  it('scopes a PAGED entry list to one dataset, with the dataset’s own total', async () => {
    const { status, body } = await list('entry?dataset=news&limit=2');
    expect(status).toBe(200);
    expect((body.items as Array<{ dataset: string }>).every((e) => e.dataset === 'news')).toBe(true);
    expect((body.items as unknown[]).length).toBe(2);
    expect(body.total).toBe(3); // news has 3 entries; the shop entry must not be counted
  });

  it('pages through one dataset without leaking or repeating rows', async () => {
    const first = await list('entry?dataset=news&limit=2&offset=0');
    const second = await list('entry?dataset=news&limit=2&offset=2');
    const seen = [...ids(first.body), ...ids(second.body)];
    expect(seen.sort()).toEqual(['n_1', 'n_2', 'n_3']);
    expect(new Set(seen).size).toBe(3); // no row returned twice
  });

  it('combines dataset scope WITH search', async () => {
    expect(ids((await list('entry?dataset=news&q=sports')).body)).toEqual(['n_1', 'n_3']);
    expect(ids((await list('entry?dataset=shop&q=sports')).body)).toEqual(['s_1']);
  });

  it('still rejects an invalid dataset slug', async () => {
    expect((await list('entry?dataset=NOT VALID&limit=2')).status).toBe(400);
  });
});

describe('content list: the default response is unchanged', () => {
  beforeEach(seed);

  it('returns only `items`, with full bodies, when no query parameters are given', async () => {
    const { body } = await list('page');
    expect(Object.keys(body)).toEqual(['items']);
    const home = (body.items as Array<{ id: string; source?: string }>).find((p) => p.id === 'home');
    expect(home?.source).toBe('<p>h</p>');
  });

  it('keeps the unpaginated `?dataset=` shape (items only, no total)', async () => {
    const { body } = await list('entry?dataset=news');
    expect(Object.keys(body)).toEqual(['items']);
    expect(ids(body)).toEqual(['n_1', 'n_2', 'n_3']);
  });
});
