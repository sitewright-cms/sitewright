import { describe, it, expect } from 'vitest';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';

describe('GET /version', () => {
  it('reports an available update when the latest is newer', async () => {
    const app = await createApp({
      db: await makeTestDb(),
      version: '1.0.0',
      latestVersion: async () => 'v1.2.0',
      releaseUrl: 'https://example.com/releases/latest',
    });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/version' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      current: '1.0.0',
      latest: 'v1.2.0',
      updateAvailable: true,
      releaseUrl: 'https://example.com/releases/latest',
    });
  });

  it('reports no update when the latest matches the current version', async () => {
    const app = await createApp({ db: await makeTestDb(), version: '1.2.0', latestVersion: async () => '1.2.0' });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/version' });
    expect(res.json()).toMatchObject({ updateAvailable: false });
  });

  it('is resilient when no release provider is configured', async () => {
    const app = await createApp({ db: await makeTestDb(), version: '1.0.0' });
    await app.ready();
    const body = (await app.inject({ method: 'GET', url: '/version' })).json() as {
      latest: string | null;
      updateAvailable: boolean;
    };
    expect(body.latest).toBeNull();
    expect(body.updateAvailable).toBe(false);
  });
});
