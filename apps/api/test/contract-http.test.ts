import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestDb } from './helpers.js';
import { createApp } from '../src/http/app.js';
import { collectRoutes, expectContract } from './contract-helpers.js';

/**
 * An app configured the way PRODUCTION is, not the way a unit test is.
 *
 * Most of the surface sits behind an option: `/media/:projectSlug/:file` and `/sites/:slug/*` — the
 * two routes published output depends on most — only exist when a media/publish root is given. A bare
 * `createApp({ db })` registers 140 routes; a production-shaped one registers 190, and the 50 it drops
 * are disproportionately the public ones. Generating the contract from the bare app would have
 * under-reported exactly what matters.
 *
 * ★ `encryptionKey` IS PART OF "PRODUCTION-SHAPED", and used not to be. Every route that stores a
 * secret — per-project SMTP, per-project captcha, the BYO-agent AI config — is registered inside
 * `if (opts.encryptionKey)`, so a contract generated without one silently omitted them. The gate
 * therefore could not have caught those routes being renamed or dropped, which is precisely the
 * breakage it exists to prevent: an instance without an encryption key is a dev instance, and
 * pinning only what a dev instance serves pins the wrong surface.
 */
async function productionShapedApp(onRoute: (r: { method: string | string[]; url: string }) => void) {
  const root = await mkdtemp(join(tmpdir(), 'sw-contract-'));
  return createApp({
    db: await makeTestDb(),
    onRoute,
    mediaRoot: join(root, 'media'),
    publishRoot: join(root, 'sites'),
    previewRoot: join(root, 'preview'),
    dataDir: root,
    encryptionKey: randomBytes(32),
  });
}

// The HTTP surface, pinned. A route that disappears or changes method breaks whoever was calling it —
// and for the public routes below, "whoever" includes exported HTML on servers we do not control.
// See contract/README.md for what to do when this fails.
describe('contract: HTTP routes', () => {
  it('matches the committed inventory', async () => {
    const routes = collectRoutes();
    const app = await productionShapedApp(routes.onRoute);
    await app.ready();
    expectContract('http-routes.json', routes.inventory());
  });

  // Asserted by NAME as well as by inventory. In a diff a rename reads as one removal plus one
  // addition, which looks routine; naming these makes the breakage unmissable.
  it('keeps the routes that published artifacts hard-code', async () => {
    const routes = collectRoutes();
    const app = await productionShapedApp(routes.onRoute);
    await app.ready();
    const inventory = routes.inventory();
    for (const route of [
      'POST /f/:projectId/:formId', // baked into every exported form
      'GET /media/:projectSlug/:file', // flat media delivery
      'GET /sites/:slug/*', // locally-hosted published site
      'GET /health',
      'GET /ready',
      'GET /version',
    ]) {
      expect(inventory, `${route} is hard-coded into published output or ops tooling`).toContain(route);
    }
  });
});
