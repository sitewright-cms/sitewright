import { describe, it, expect, afterEach } from 'vitest';
import { makeHarness, type Harness } from './harness.js';

let h: Harness;
afterEach(async () => {
  await h?.close();
});

const dataset = (slug: string) => ({
  id: slug,
  name: 'List',
  slug,
  fields: [{ name: 'text', type: 'text', required: false, localized: false }],
});

// Regression: a bodyless DELETE that still carries a default `Content-Type: application/json` header
// (many HTTP clients set it on every request) used to hit Fastify's FST_ERR_CTP_EMPTY_JSON_BODY (400),
// which the error handler mislabeled as an opaque 500 — blocking every dataset/content delete for such
// clients. An empty JSON body must now parse to `undefined` and the delete must succeed.
describe('empty application/json body handling', () => {
  it('DELETEs content with an empty body under Content-Type: application/json (was a 500)', async () => {
    h = await makeHarness();
    const a = await h.signup();
    const proj = a.project(await a.createProject());

    expect((await proj.putContent('dataset', 'zz', dataset('zz'))).statusCode).toBe(200);

    const del = await a.inject({
      method: 'DELETE',
      url: `/projects/${proj.projectId}/content/dataset/zz`,
      headers: { 'content-type': 'application/json' },
      payload: '',
    });
    expect(del.statusCode).toBe(204);
    // …and the row is actually gone.
    expect((await proj.getContent('dataset', 'zz')).statusCode).toBe(404);
  });

  it('still parses a real JSON body on write paths', async () => {
    h = await makeHarness();
    const a = await h.signup();
    const proj = a.project(await a.createProject());
    // A normal PUT (non-empty JSON body) round-trips unchanged.
    expect((await proj.putContent('dataset', 'real', dataset('real'))).statusCode).toBe(200);
    expect((await proj.getContent('dataset', 'real')).statusCode).toBe(200);
  });

  it('rejects a MALFORMED JSON body with a clean 400 (not a 500)', async () => {
    h = await makeHarness();
    const a = await h.signup();
    const proj = a.project(await a.createProject());
    const res = await a.inject({
      method: 'PUT',
      url: `/projects/${proj.projectId}/content/dataset/x`,
      headers: { 'content-type': 'application/json' },
      payload: '{ not valid json',
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a prototype-pollution payload (secure JSON parse retained)', async () => {
    h = await makeHarness();
    const a = await h.signup();
    const proj = a.project(await a.createProject());
    const res = await a.inject({
      method: 'PUT',
      url: `/projects/${proj.projectId}/content/dataset/p`,
      headers: { 'content-type': 'application/json' },
      payload: '{"id":"p","name":"P","slug":"p","fields":[],"__proto__":{"polluted":true}}',
    });
    // secure-json-parse throws on a __proto__ key → a clean 400, and Object.prototype stays clean.
    expect(res.statusCode).toBe(400);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('rejects a constructor.prototype pollution payload (secure JSON parse retained)', async () => {
    h = await makeHarness();
    const a = await h.signup();
    const proj = a.project(await a.createProject());
    const res = await a.inject({
      method: 'PUT',
      url: `/projects/${proj.projectId}/content/dataset/c`,
      headers: { 'content-type': 'application/json' },
      payload: '{"id":"c","name":"C","slug":"c","fields":[],"constructor":{"prototype":{"polluted":true}}}',
    });
    expect(res.statusCode).toBe(400);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
