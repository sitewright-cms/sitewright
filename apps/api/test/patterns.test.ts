import { describe, it, expect, afterEach } from 'vitest';
import { makeHarness, type Harness } from './harness.js';

let h: Harness;
afterEach(async () => {
  await h?.close();
});

const pattern = {
  id: 'pricing-3up',
  name: 'Pricing — 3 columns',
  root: {
    id: 'r',
    type: 'Section',
    className: 'py-16',
    children: [
      { id: 'g', type: 'Grid', props: { columns: 3 }, children: [{ id: 'c', type: 'Card' }] },
    ],
  },
};

describe('Patterns library (pattern content kind)', () => {
  it('round-trips a pattern through generic content CRUD (put/get/list/delete)', async () => {
    h = await makeHarness();
    const a = await h.signup();
    const proj = a.project(await a.createProject());

    expect((await proj.putContent('pattern', pattern.id, pattern)).statusCode).toBe(200);

    const got = await proj.getContent('pattern', pattern.id);
    expect(got.statusCode).toBe(200);
    expect((got.json() as { item: typeof pattern }).item.name).toBe('Pricing — 3 columns');
    expect((got.json() as { item: typeof pattern }).item.root.type).toBe('Section');

    const list = await proj.listContent('pattern');
    expect(list.statusCode).toBe(200);
    expect((list.json() as { items: unknown[] }).items).toHaveLength(1);

    expect((await a.del(`${proj.base}/content/pattern/${pattern.id}`)).statusCode).toBe(204);
    expect((await proj.getContent('pattern', pattern.id)).statusCode).toBe(404);
  });

  it('rejects an invalid pattern (missing root / bad name)', async () => {
    h = await makeHarness();
    const a = await h.signup();
    const proj = a.project(await a.createProject());
    expect((await proj.putContent('pattern', 'x', { id: 'x', name: 'No root' })).statusCode).toBe(400);
    expect(
      (await proj.putContent('pattern', 'y', { id: 'y', name: '', root: { id: 'r', type: 'Section' } }))
        .statusCode,
    ).toBe(400);
  });

  it('rejects a pathologically deep pattern tree before parsing (stack-overflow guard)', async () => {
    h = await makeHarness();
    const a = await h.signup();
    const proj = a.project(await a.createProject());
    // 200 levels — well over the 100-level (MAX_PAGE_TREE_DEPTH) guard, yet shallow
    // enough that the test injector can still serialize the payload.
    let deep: unknown = { id: 'leaf', type: 'Section' };
    for (let i = 0; i < 200; i++) deep = { id: `n${i}`, type: 'Section', children: [deep] };
    const res = await proj.putContent('pattern', 'deep', { id: 'deep', name: 'Deep', root: deep });
    expect([400, 413]).toContain(res.statusCode);
  });

  it('scopes patterns per tenant (another org cannot read them)', async () => {
    h = await makeHarness();
    const a = await h.signup();
    const b = await h.signup();
    const projectId = await a.createProject();
    await a.project(projectId).putContent('pattern', pattern.id, pattern);
    const cross = await b.get(`/orgs/${a.orgId}/projects/${projectId}/content/pattern/${pattern.id}`);
    expect([403, 404]).toContain(cross.statusCode);
  });
});
