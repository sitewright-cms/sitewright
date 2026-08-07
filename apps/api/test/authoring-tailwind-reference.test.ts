import { describe, it, expect } from 'vitest';
import { tailwindReference } from '@sitewright/tailwind-reference';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';

// GET /authoring/tailwind/reference — the dataset behind the editor's TailwindCSS Reference modal.
// Public, static platform metadata (no tenant data), like /authoring/components and
// /authoring/icons/names. It is ~1.8 MB, so the route's job is as much about NOT resending it as
// about serving it: a strong content ETag plus `no-cache` turns a returning editor into a 304.
describe('GET /authoring/tailwind/reference', () => {
  it('serves the reference without authentication', async () => {
    const app = await createApp({ db: await makeTestDb() });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/authoring/tailwind/reference' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);

    const body = res.json() as ReturnType<typeof tailwindReference>;
    expect(body.tailwindVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(body.classCount).toBeGreaterThan(20_000);
    expect(body.topics.length).toBeGreaterThan(100);
    await app.close();
  });

  it('carries the authored prose and the generated CSS on every topic', async () => {
    const app = await createApp({ db: await makeTestDb() });
    await app.ready();
    const body = (await app.inject({ method: 'GET', url: '/authoring/tailwind/reference' })).json() as ReturnType<
      typeof tailwindReference
    >;

    const fontSize = body.topics.find((t) => t.sig === 'font-size,line-height');
    expect(fontSize?.title).toBe('Font Size');
    expect(fontSize?.category).toBe('typography');
    expect(fontSize?.preview).toBe('text');
    // The row an author reads: the class, and the value it actually resolves to.
    const textSm = fontSize?.classes.find(([name]) => name === 'text-sm');
    expect(textSm?.[1][0]).toEqual(['var(--text-sm)', '0.875rem']);
    await app.close();
  });

  it('sets a strong ETag and revalidates rather than caching blind', async () => {
    const app = await createApp({ db: await makeTestDb() });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/authoring/tailwind/reference' });
    expect(res.headers.etag).toMatch(/^"[\w-]+"$/);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    await app.close();
  });

  it('answers 304 with no body when the client already has that ETag', async () => {
    const app = await createApp({ db: await makeTestDb() });
    await app.ready();
    const first = await app.inject({ method: 'GET', url: '/authoring/tailwind/reference' });
    const etag = first.headers.etag as string;

    const second = await app.inject({
      method: 'GET',
      url: '/authoring/tailwind/reference',
      headers: { 'if-none-match': etag },
    });
    expect(second.statusCode).toBe(304);
    expect(second.body).toBe('');
    expect(second.headers.etag).toBe(etag);
    await app.close();
  });

  it('honours an If-None-Match list, not just a bare validator', async () => {
    // RFC 9110 §13.1.2 allows a comma-separated list; matching only the whole header would resend
    // the full 1.8 MB payload to any client that sent one.
    const app = await createApp({ db: await makeTestDb() });
    await app.ready();
    const etag = (await app.inject({ method: 'GET', url: '/authoring/tailwind/reference' })).headers.etag as string;

    const res = await app.inject({
      method: 'GET',
      url: '/authoring/tailwind/reference',
      headers: { 'if-none-match': `"stale-one", ${etag}` },
    });
    expect(res.statusCode).toBe(304);
    await app.close();
  });

  it('sends the payload when the client’s ETag is stale', async () => {
    const app = await createApp({ db: await makeTestDb() });
    await app.ready();
    const res = await app.inject({
      method: 'GET',
      url: '/authoring/tailwind/reference',
      headers: { 'if-none-match': '"not-the-current-one"' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.length).toBeGreaterThan(1000);
    await app.close();
  });
});
