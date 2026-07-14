import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { makeTestDb } from './helpers.js';
import type { Database } from '../src/db/client.js';
import { createApp } from '../src/http/app.js';
import { registerAccount } from '../src/repo/accounts.js';
import { users } from '../src/db/schema.js';
import { MediaStorage } from '../src/media/storage.js';
import { globalTemplateMap } from '../src/repo/global-library.js';
import { AgentGrantsRepository } from '../src/repo/agent-grants.js';
import { InstanceSettingsRepository } from '../src/repo/instance-settings.js';

// Targeted coverage for handlers/utilities the broader suites don't exercise (authoring preview
// routes, admin read routes, and a few repo/storage units) — keeps the api coverage gate green.

const ENC_KEY = randomBytes(32);

function token(res: { cookies: Array<{ name: string; value: string }> }): string {
  const t = res.cookies.find((c) => c.name === 'sw_session')?.value;
  if (!t) throw new Error('no session cookie');
  return t;
}

describe('coverage backfill', () => {
  describe('unauthenticated authoring preview routes', () => {
    let app: FastifyInstance;
    beforeEach(async () => {
      const db = await makeTestDb();
      app = await createApp({ db, encryptionKey: ENC_KEY });
      await app.ready();
    });

    it('serves the compiled button-preview stylesheet', async () => {
      const res = await app.inject({ method: 'GET', url: '/authoring/button-preview-css' });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { css: string }).css).toContain('.btn');
    });

    it('serves the effect-forks stylesheet', async () => {
      const res = await app.inject({ method: 'GET', url: '/authoring/effect-forks' });
      expect(res.statusCode).toBe(200);
    });

    it('serves the sandboxed svg-studio preview document', async () => {
      const res = await app.inject({ method: 'GET', url: '/authoring/svg-studio-preview' });
      expect(res.statusCode).toBe(200);
      expect(String(res.headers['content-security-policy'])).toContain('sandbox');
    });
  });

  describe('admin read routes', () => {
    let app: FastifyInstance;
    let db: Database;
    beforeEach(async () => {
      db = await makeTestDb();
      app = await createApp({ db, encryptionKey: ENC_KEY });
      await app.ready();
    });

    it('lists users, deleted projects, and invites for an admin', async () => {
      await registerAccount(db, 'admin@cov.test', 'Pw-secret-1', { platformRole: 'admin' });
      const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'admin@cov.test', password: 'Pw-secret-1' } });
      const t = token(login);
      for (const url of ['/admin/users', '/admin/deleted-projects', '/admin/invites']) {
        const res = await app.inject({ method: 'GET', url, cookies: { sw_session: t } });
        expect(res.statusCode).toBe(200);
      }
    });
  });

  describe('repo + storage units', () => {
    it('MediaStorage.removeFile is idempotent; copyProjectMedia tolerates a missing source and rejects bad slugs', async () => {
      const root = await mkdtemp(join(tmpdir(), 'sw-cov-media-'));
      const store = new MediaStorage(root);
      await store.removeFile('proj', 'asset1', 'x.webp'); // no file present → no-op, but the body runs
      await store.copyProjectMedia('src-slug', 'dst-slug'); // source has no media dir → ENOENT swallowed
      // success paths: stage a real asset, then copy the whole project + a single asset
      await store.stageUpload('srcproj', 'asset9', Buffer.from('data'));
      await store.copyProjectMedia('srcproj', 'dstproj');
      await store.copyAsset('srcproj', 'asset9', 'asset10');
      await expect(store.copyProjectMedia('bad slug!', 'ok')).rejects.toThrow(/invalid media project slug/);
    });

    it('globalTemplateMap keys template rows by their global:<id> reference', () => {
      const rows = [
        { id: 'a1', name: 'A', source: '<i/>' },
        { id: 'b2', name: 'B', source: '<j/>' },
      ] as unknown as Parameters<typeof globalTemplateMap>[0];
      const map = globalTemplateMap(rows);
      expect(map.size).toBe(2);
      expect([...map.keys()].every((k) => k.startsWith('global:'))).toBe(true);
      expect(map.get('global:a1')).toBe(rows[0]);
    });

    it('InstanceSettingsRepository lists only enabled OIDC providers and merges brand/image fields', async () => {
      const db = await makeTestDb();
      const repo = new InstanceSettingsRepository(db, ENC_KEY);
      await repo.put({
        oidcProviders: [
          { id: 'google', label: 'Google', issuer: 'https://accounts.google.com', clientId: 'cid', enabled: true, usePkce: true },
          { id: 'okta', label: 'Okta', issuer: 'https://okta.test', clientId: 'cid2', enabled: false, usePkce: true },
        ],
      });
      expect(await repo.listEnabledOidcProviders()).toEqual([{ id: 'google', label: 'Google' }]);
      // brand + image-format fields exercise the mergeNullable callbacks in put()
      await repo.put({ platformName: 'Cov', brandPrimary: '#123456', brandSecondary: '#654321', defaultImageFormat: 'avif' });
      const pub = await repo.getPublic();
      expect(pub.platformName).toBe('Cov');
      expect(pub.defaultImageFormat).toBe('avif');
      // secret round-trips exercise the decrypt branches of the secret getters
      await repo.put({ hcaptcha: { siteKey: 'sk', secret: 'hc-secret' }, stock: { unsplash: 'uk', pexels: 'pk' } });
      expect(await repo.getHcaptchaSecret()).toBe('hc-secret');
      expect(await repo.getStockKey('unsplash')).toBe('uk');
      expect(await repo.getStockKey('pexels')).toBe('pk');
    });
  });

  describe('agent grants (real user + project)', () => {
    let app: FastifyInstance;
    let db: Database;
    beforeEach(async () => {
      db = await makeTestDb();
      app = await createApp({ db, encryptionKey: ENC_KEY });
      await app.ready();
    });

    it('AgentGrantsRepository upserts, reads, updates on conflict, and revokes', async () => {
      await registerAccount(db, 'grant@cov.test', 'Pw-secret-1', { platformRole: 'developer' });
      const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'grant@cov.test', password: 'Pw-secret-1' } });
      const t = token(login);
      const proj = await app.inject({ method: 'POST', url: '/projects', cookies: { sw_session: t }, payload: { name: 'Grant Site', slug: 'grant-site' } });
      const projectId = (proj.json() as { project: { id: string } }).project.id;
      const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, 'grant@cov.test'));
      const userId = u!.id;

      // exercise two more owner/project route handlers while we hold a project + owner cookie
      const patch = await app.inject({ method: 'PATCH', url: `/projects/${projectId}`, cookies: { sw_session: t }, payload: { name: 'Renamed' } });
      expect(patch.statusCode).toBe(200);
      const glob = await app.inject({ method: 'GET', url: '/global/snippet', cookies: { sw_session: t } });
      expect(glob.statusCode).toBe(200);

      const repo = new AgentGrantsRepository(db);
      expect(await repo.get(userId, projectId)).toBeNull();
      await repo.upsert(userId, projectId, { capabilities: ['content:read'], autonomy: 'ask' });
      expect(await repo.get(userId, projectId)).toEqual({ capabilities: ['content:read'], autonomy: 'ask' });
      await repo.upsert(userId, projectId, { capabilities: ['content:read', 'content:write'], autonomy: 'full' });
      expect((await repo.get(userId, projectId))?.autonomy).toBe('full');
      await repo.revoke(userId, projectId);
      expect(await repo.get(userId, projectId)).toBeNull();
    });
  });
});
