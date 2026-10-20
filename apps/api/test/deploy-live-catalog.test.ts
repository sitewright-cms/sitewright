import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { PaymentGatewayStoredSchema } from '@sitewright/schema';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import { shopCatalog, instanceSettings, INSTANCE_SETTINGS_ID, content } from '../src/db/schema.js';
import { GLOBAL_SCOPE_ID, ensureGlobalProject } from '../src/repo/global-library.js';
import { encryptSecret } from '../src/crypto/secret.js';

// ★ A REMOTE deploy makes its build the live site, so checkout must charge that build's price list.
// Only a Local Hosting publish used to write it: a shop deployed only by FTP/SFTP/git had no price
// list at all ("no published price list yet"), or kept charging the prices of its last publish while
// the uploaded pages showed new ones. The upload itself is faked; the build and the bookkeeping are real.

const upload = vi.hoisted(() => ({ fail: false }));
vi.mock('../src/publish/adapters.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/publish/adapters.js')>();
  return {
    ...actual,
    deploySite: vi.fn(async () => {
      if (upload.fail) throw new Error('connect ECONNREFUSED');
      return { protocol: 'sftp', files: 1, uploaded: 1, skipped: 0, removed: 0, strategy: 'full', bytes: 1 };
    }),
  };
});

// The deploy's temp build is removed SLOWLY, so a route that answers before that removal (and
// releases its lock only after it) is caught every time, not only when the disk happens to be slow.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rm: async (path: Parameters<typeof actual.rm>[0], opts?: Parameters<typeof actual.rm>[1]) => {
      if (String(path).includes('sw-deploy-')) await new Promise((r) => setTimeout(r, 300));
      return actual.rm(path, opts);
    },
  };
});

const KEY = Buffer.alloc(32, 9);
const gateway = PaymentGatewayStoredSchema.parse({
  id: 'card',
  name: 'card',
  apiBase: { test: 'https://mock-pay.invalid', live: 'https://mock-pay.invalid' },
  auth: { kind: 'bearer', secretField: 'apiKey' },
  credentialFields: [{ key: 'apiKey', label: 'API key', kind: 'secret' }, { key: 'webhookSecret', label: 'Secret', kind: 'secret' }],
  checkout: {
    request: { method: 'POST', path: '/sessions', format: 'json', headers: {}, body: { amount: '${#AMOUNT:minor}' } },
    refPath: 'id',
    redirectUrlPath: 'url',
  },
  verification: { scheme: 'hmac-sha256-header', header: 'x-sig', encoding: 'hex', secretField: 'webhookSecret' },
  events: { refPath: 'id', types: {}, defaultKind: 'paid' },
  allowedOrigins: ['https://mock-pay.invalid'],
  enabled: true,
  verified: true,
});
const SHOP = {
  enabled: true,
  currency: { code: 'EUR' },
  channels: [{ kind: 'checkout', key: 'card', gatewayId: 'card', email: 'o@shop.test', captcha: false, pow: false }],
};

let h: Harness;
let owner: TestClient;
let projectId: string;
let publishRoot: string;
let targetId: string;

async function sellMugAt(price: string): Promise<void> {
  const page = await owner.project(projectId).putContent('page', 'home', {
    id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' },
    source: `<section>{{sw-add-to-cart sku="mug" name="Mug" price="${price}"}}</section>`,
  });
  if (page.statusCode >= 400) throw new Error(`page put failed: ${page.body}`);
}
async function liveMugPrice(): Promise<number | undefined> {
  const rows = await h.db.select().from(shopCatalog).where(eq(shopCatalog.mode, 'live'));
  return (rows[0]?.items as Record<string, { priceMinor: number }> | undefined)?.mug?.priceMinor;
}

beforeEach(async () => {
  upload.fail = false;
  publishRoot = await mkdtemp(join(tmpdir(), 'sw-deploy-catalog-'));
  h = await makeHarness({ encryptionKey: KEY, publicUrl: 'https://sw.test', publishRoot, deployAllowedHosts: ['allowed.example.com'] });
  owner = await h.signup({ admin: true });
  projectId = await owner.createProject('Shop', 'shop');
  const data = { formModes: { globalSmtp: true, userSmtp: false, contactPhp: false, contactPhpSmtp: false, thirdParty: false, whatsapp: false }, paymentsEnabled: true };
  await h.db.insert(instanceSettings).values({ id: INSTANCE_SETTINGS_ID, data, updatedAt: new Date() }).onConflictDoUpdate({ target: instanceSettings.id, set: { data, updatedAt: new Date() } });
  await ensureGlobalProject(h.db);
  await h.db.insert(content).values({ id: 'gw_card', projectId: GLOBAL_SCOPE_ID, kind: 'payment_gateway', entityId: 'card', scope: '', data: gateway, createdAt: new Date(), updatedAt: new Date() });
  await h.db.insert(content).values({
    id: 'bind_card', projectId, kind: 'project_payment', entityId: 'card', scope: '',
    data: { gatewayId: 'card', mode: 'test', values: { test: { apiKey: encryptSecret('sk', KEY), webhookSecret: encryptSecret('wh', KEY) } } },
    createdAt: new Date(), updatedAt: new Date(),
  });
  const settings = await owner.project(projectId).putContent('settings', 'settings', {
    identity: { name: 'Shop', colors: { primary: '#0a7' } },
    website: { shop: SHOP },
    settings: {},
  });
  if (settings.statusCode >= 400) throw new Error(`settings put failed: ${settings.body}`);
  const target = await owner.post(`/projects/${projectId}/deploy-targets`, {
    name: 'Webspace', protocol: 'sftp', host: 'allowed.example.com', user: 'deployer', password: 'pw', remoteDir: '/var/www',
  });
  targetId = (target.json() as { target: { id: string } }).target.id;
});
afterEach(async () => {
  await h.close?.();
  await rm(publishRoot, { recursive: true, force: true });
});

describe('★★ a remote deploy is what makes its prices the ones checkout charges', () => {
  it('a shop deployed only remotely gets a price list — none existed without a publish', async () => {
    await sellMugAt('9.50');
    expect(await liveMugPrice()).toBeUndefined();
    const res = await owner.post(`/projects/${projectId}/deploy-targets/${targetId}/deploy`, {});
    expect(res.statusCode).toBe(200);
    expect(await liveMugPrice()).toBe(950);
    // The manifest comes back as a publish's does, so the deployer can read what now sells.
    expect((res.json() as { release: { shopCatalog?: { items: Record<string, { priceMinor: number }> } } }).release.shopCatalog?.items.mug?.priceMinor).toBe(950);
  });

  it('a price changed since the last publish is charged as deployed, not as published', async () => {
    await sellMugAt('5.00');
    expect((await owner.post(`/projects/${projectId}/publish`, {})).statusCode).toBe(200);
    expect(await liveMugPrice()).toBe(500);
    await sellMugAt('9.50');
    expect((await owner.post(`/projects/${projectId}/deploy-targets/${targetId}/deploy`, {})).statusCode).toBe(200);
    expect(await liveMugPrice()).toBe(950);
  });

  it('the streaming deploy (the editor’s) saves it too', async () => {
    await sellMugAt('9.50');
    const res = await owner.post(`/projects/${projectId}/deploy-targets/${targetId}/deploy/stream`, {});
    expect(res.body).toContain('event: done');
    expect(await liveMugPrice()).toBe(950);
  });

  it('a FAILED upload changes nothing: the old site is still what buyers see', async () => {
    await sellMugAt('5.00');
    expect((await owner.post(`/projects/${projectId}/publish`, {})).statusCode).toBe(200);
    await sellMugAt('9.50');
    upload.fail = true;
    expect((await owner.post(`/projects/${projectId}/deploy-targets/${targetId}/deploy`, {})).statusCode).toBe(502);
    // ★ Straight after the failed deploy answers: its lock must already be released.
    const stream = await owner.post(`/projects/${projectId}/deploy-targets/${targetId}/deploy/stream`, {});
    expect(stream.body).toContain('event: error');
    expect(await liveMugPrice()).toBe(500);
  });
});
