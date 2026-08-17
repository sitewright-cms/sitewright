import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ORDER_MAX } from '@sitewright/core';
import { makeHarness, type Harness, type TestClient, type ProjectClient } from './harness.js';

// Reordering used to be one PUT per moved sibling. A dense 0..n reindex rewrites everything after the
// moved item, so one drag in an 831-page group meant ~700 PUTs against a route capped at 60/min — it
// 429s partway and leaves the group half-reordered. This endpoint writes the whole group in ONE
// transaction, and (like importBundle) records no revisions: a reorder is structural, not a content edit.

let harness: Harness;
let client: TestClient;
let project: ProjectClient;

beforeEach(async () => {
  harness = await makeHarness();
  client = await harness.signup();
  project = client.project(await client.createProject('Site', 'reorder-site', { localHosting: false }));
});
afterEach(async () => {
  await harness.close();
});

const PAGES = 6;

async function seedPages(): Promise<void> {
  const res = await project.importBundle({
    pages: [
      { id: 'home', path: '', title: 'Home', source: '<p>h</p>' },
      ...Array.from({ length: PAGES }, (_, i) => ({
        id: `p-${i}`,
        path: `p-${i}`,
        parent: 'home',
        order: i * 1000,
        title: `Page ${i}`,
        source: `<p>body ${i}</p>`,
      })),
    ],
  });
  expect(res.statusCode).toBe(200);
}

async function seedEntries(): Promise<void> {
  await project.importBundle({
    datasets: [{ id: 'news', name: 'News', slug: 'news', fields: [{ name: 'title', type: 'text' }] }],
    entries: Array.from({ length: 4 }, (_, i) => ({
      id: `n_${i}`,
      dataset: 'news',
      status: 'published',
      order: i * 1000,
      values: { title: `Item ${i}` },
    })),
  });
}

const reorder = (kind: string, body: unknown) => client.post(`${project.base}/content/${kind}/reorder`, body);

const ordersOf = async (kind: string, query = ''): Promise<Record<string, number | undefined>> => {
  const res = await client.get(`${project.base}/content/${kind}${query}`);
  const items = (res.json() as { items: Array<{ id: string; order?: number }> }).items;
  return Object.fromEntries(items.map((i) => [i.id, i.order]));
};

describe('bulk reorder', () => {
  it('writes every supplied order in one request', async () => {
    await seedPages();

    const res = await reorder('page', { items: [{ id: 'p-0', order: 5000 }, { id: 'p-1', order: 6000 }] });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ updated: 2 });
    const orders = await ordersOf('page');
    expect(orders['p-0']).toBe(5000);
    expect(orders['p-1']).toBe(6000);
    expect(orders['p-2'], 'an untouched sibling keeps its order').toBe(2000);
  });

  it('★ leaves every OTHER field of the page intact — it writes the order, not the page', async () => {
    await seedPages();

    await reorder('page', { items: [{ id: 'p-3', order: 42 }] });

    const res = await client.get(`${project.base}/content/page/p-3`);
    expect(res.json()).toMatchObject({
      item: { id: 'p-3', title: 'Page 3', path: 'p-3', parent: 'home', source: '<p>body 3</p>', order: 42 },
    });
  });

  it('reorders dataset ENTRIES, scoped to their dataset', async () => {
    await seedEntries();

    const res = await reorder('entry', { dataset: 'news', items: [{ id: 'n_3', order: 1 }, { id: 'n_0', order: 9000 }] });

    expect(res.statusCode).toBe(200);
    const orders = await ordersOf('entry', '?dataset=news');
    expect(orders['n_3']).toBe(1);
    expect(orders['n_0']).toBe(9000);
    expect(orders['n_1']).toBe(1000);
  });

  it('requires the dataset for entries — an entry id is unique only within one', async () => {
    await seedEntries();
    expect((await reorder('entry', { items: [{ id: 'n_0', order: 5 }] })).statusCode).toBe(400);
  });

  it('accepts an order across the whole raised range', async () => {
    await seedPages();
    expect((await reorder('page', { items: [{ id: 'p-0', order: ORDER_MAX }] })).statusCode).toBe(200);
    expect((await ordersOf('page'))['p-0']).toBe(ORDER_MAX);
  });

  it('rejects an out-of-range or fractional order without writing ANY of the batch', async () => {
    await seedPages();

    const res = await reorder('page', { items: [{ id: 'p-0', order: 7000 }, { id: 'p-1', order: -1 }] });

    expect(res.statusCode).toBe(400);
    // Atomic: the valid half of a rejected batch must not land, or the group is left half-moved.
    expect((await ordersOf('page'))['p-0']).toBe(0);
  });

  it('★ is ATOMIC across the batch — an unknown id rolls the whole thing back', async () => {
    await seedPages();

    const res = await reorder('page', { items: [{ id: 'p-0', order: 7000 }, { id: 'nope', order: 8000 }] });

    expect(res.statusCode).toBe(404);
    expect((await ordersOf('page'))['p-0'], 'the earlier item must not have been written').toBe(0);
  });

  it('rejects a kind that has no sibling order', async () => {
    expect((await reorder('settings', { items: [{ id: 'settings', order: 1 }] })).statusCode).toBe(400);
    expect((await reorder('snippet', { items: [{ id: 'x', order: 1 }] })).statusCode).toBe(400);
  });

  it('rejects an empty batch and one past the size cap', async () => {
    await seedPages();
    expect((await reorder('page', { items: [] })).statusCode).toBe(400);
    const tooMany = Array.from({ length: 5001 }, (_, i) => ({ id: `p-${i}`, order: i }));
    expect((await reorder('page', { items: tooMany })).statusCode).toBe(400);
  });

  it('refuses a caller from another project (the ids are resolved per project)', async () => {
    await seedPages();
    const other = await harness.signup({ email: 'outsider@e2e.test' });
    const res = await other.post(`${project.base}/content/page/reorder`, { items: [{ id: 'p-0', order: 1 }] });
    expect([403, 404]).toContain(res.statusCode);
    expect((await ordersOf('page'))['p-0']).toBe(0);
  });
});
