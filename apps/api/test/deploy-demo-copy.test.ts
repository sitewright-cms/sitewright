import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { PaymentGatewayStoredSchema } from '@sitewright/schema';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import { shopCatalog, instanceSettings, INSTANCE_SETTINGS_ID, content } from '../src/db/schema.js';
import { GLOBAL_SCOPE_ID, ensureGlobalProject } from '../src/repo/global-library.js';
import { encryptSecret } from '../src/crypto/secret.js';
import { recordDeployed } from '../src/http/deploy-targets.js';
import type { DeployTarget } from '@sitewright/schema';

/**
 * ★★ A DEMO COPY: a deploy target whose build shows the live features working while nothing can reach anyone.
 *
 * The same project is deployed twice, once to an ordinary target and once to a demo copy, and what each upload
 * carries is compared. The ordinary one proves the fixture exercises every receiver (an SMTP form with a captcha,
 * a contact.php form, a third-party form, a WhatsApp form, a WhatsApp and a mailto order channel, a checkout with
 * its guards, a booking with a captcha, the statistics counter); the demo copy must carry none of them, and none
 * of the platform's addresses. The upload is faked and copied aside; the build and the bookkeeping are real.
 */

const uploads = vi.hoisted(() => ({ dirs: [] as string[], into: '' }));
vi.mock('../src/publish/adapters.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/publish/adapters.js')>();
  const fsp = await import('node:fs/promises');
  const path = await import('node:path');
  return {
    ...actual,
    deploySite: vi.fn(async (dir: string) => {
      const copy = path.join(uploads.into, `upload-${uploads.dirs.length}`);
      await fsp.cp(dir, copy, { recursive: true });
      uploads.dirs.push(copy);
      return { protocol: 'sftp', files: 1, uploaded: 1, skipped: 0, removed: 0, strategy: 'full', bytes: 1 };
    }),
  };
});

const KEY = Buffer.alloc(32, 7);
const PLATFORM = 'https://sw.test';
const SITE_KEY = '10000000-ffff-ffff-ffff-000000000001';
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
  channels: [
    { kind: 'checkout', key: 'card', gatewayId: 'card', email: 'orders@shop.test', captcha: true, pow: true, returnPath: '/thank-you/' },
    { kind: 'form', key: 'order', email: 'orders@shop.test', captcha: true },
    { kind: 'whatsapp', key: 'wa', number: '+264811234567' },
    { kind: 'mailto', key: 'mail', email: 'mailto-orders@shop.test' },
  ],
};
const field = [{ name: 'email', label: 'Email', type: 'email', required: true }];
const FORMS = [
  { id: 'contact', name: 'Contact', recipient: 'leads@shop.test', fields: field, mode: 'globalSmtp', captcha: true, pow: true, redirectUrl: 'https://elsewhere.test/thanks' },
  { id: 'php', name: 'PHP', recipient: 'php@shop.test', fields: field, mode: 'contactPhp' },
  { id: 'tp', name: 'Third party', recipient: 'tp@shop.test', fields: field, mode: 'thirdParty', thirdPartyUrl: 'https://forms.elsewhere.test/in' },
  { id: 'wa', name: 'WhatsApp', recipient: 'wa@shop.test', fields: field, mode: 'whatsapp', whatsappNumber: '+264819876543' },
];
const BOOKING = {
  resources: [{ id: 'anna', name: 'Anna', timeZone: 'Europe/Berlin', hours: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '09:00', to: '17:00' }] }],
  offerings: [{ id: 'massage', name: 'Massage', resourceIds: ['anna'], mode: 'duration', durationMin: 60 }],
  statusPath: '/my-booking/',
  captcha: true,
  pow: true,
};
const HOME =
  '<section>{{sw-form "contact"}}{{sw-form "php"}}{{sw-form "tp"}}{{sw-form "wa"}}' +
  '{{sw-add-to-cart sku="mug" name="Enamel mug" price="9.50"}}{{sw-cart}}{{sw-booking "massage"}}</section>';

let h: Harness;
let owner: TestClient;
let projectId: string;
let publishRoot: string;

async function target(name: string, demo: boolean): Promise<string> {
  const res = await owner.post(`/projects/${projectId}/deploy-targets`, {
    name, protocol: 'sftp', host: 'allowed.example.com', user: 'deployer', password: 'pw', remoteDir: '/var/www', ...(demo ? { demo: true } : {}),
  });
  expect(res.statusCode, res.body).toBe(201);
  return (res.json() as { target: { id: string } }).target.id;
}
/** Deploys to a target and returns the directory its upload was copied to. */
async function deploy(targetId: string): Promise<string> {
  const res = await owner.post(`/projects/${projectId}/deploy-targets/${targetId}/deploy`, {});
  expect(res.statusCode, res.body).toBe(200);
  return uploads.dirs.at(-1)!;
}
async function files(dir: string): Promise<string[]> {
  return (await readdir(dir, { recursive: true })).map((f) => f.replaceAll('\\', '/')).sort();
}
async function livePriceList(): Promise<unknown> {
  return (await h.db.select().from(shopCatalog).where(eq(shopCatalog.mode, 'live')))[0];
}

beforeEach(async () => {
  publishRoot = await mkdtemp(join(tmpdir(), 'sw-demo-copy-'));
  uploads.dirs = [];
  uploads.into = await mkdtemp(join(tmpdir(), 'sw-demo-uploads-'));
  h = await makeHarness({ encryptionKey: KEY, publicUrl: PLATFORM, publishRoot, deployAllowedHosts: ['allowed.example.com'] });
  owner = await h.signup({ admin: true });
  projectId = await owner.createProject('Shop', 'shop');
  const data = { formModes: { globalSmtp: true, userSmtp: true, contactPhp: true, contactPhpSmtp: true, thirdParty: true, whatsapp: true }, paymentsEnabled: true };
  await h.db.insert(instanceSettings).values({ id: INSTANCE_SETTINGS_ID, data, updatedAt: new Date() }).onConflictDoUpdate({ target: instanceSettings.id, set: { data, updatedAt: new Date() } });
  await ensureGlobalProject(h.db);
  await h.db.insert(content).values({ id: 'gw_card', projectId: GLOBAL_SCOPE_ID, kind: 'payment_gateway', entityId: 'card', scope: '', data: gateway, createdAt: new Date(), updatedAt: new Date() });
  await h.db.insert(content).values({
    id: 'bind_card', projectId, kind: 'project_payment', entityId: 'card', scope: '',
    data: { gatewayId: 'card', mode: 'test', values: { test: { apiKey: encryptSecret('sk', KEY), webhookSecret: encryptSecret('wh', KEY) } } },
    createdAt: new Date(), updatedAt: new Date(),
  });
  const proj = owner.project(projectId);
  expect((await owner.put(`/projects/${projectId}/captcha`, { provider: 'hcaptcha', siteKey: SITE_KEY, secret: 'vendor-secret' })).statusCode).toBe(200);
  for (const form of FORMS) {
    const res = await proj.putContent('form', form.id, form);
    expect(res.statusCode, res.body).toBeLessThan(400);
  }
  const settings = await proj.putContent('settings', 'settings', {
    identity: { name: 'Shop', colors: { primary: '#0a7' } },
    website: { shop: SHOP, statistics: { enabled: true } },
    settings: {},
  });
  expect(settings.statusCode, settings.body).toBeLessThan(400);
  expect((await owner.put(`/projects/${projectId}/content/booking/booking`, BOOKING)).statusCode).toBe(200);
  const home = await proj.putContent('page', 'home', { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' }, source: HOME });
  expect(home.statusCode, home.body).toBeLessThan(400);
});
afterEach(async () => {
  await h.close?.();
  await rm(publishRoot, { recursive: true, force: true });
  await rm(uploads.into, { recursive: true, force: true });
});

describe('★★ a demo copy shows the live features and carries no receiver', () => {
  it('leaves out every receiver the ordinary deploy of the same site carries', async () => {
    const live = await deploy(await target('Webspace', false));
    const demo = await deploy(await target('Public demo', true));

    // The ordinary deploy: the fixture really does exercise each receiver.
    const liveFiles = await files(live);
    expect(liveFiles).toContain('contact.php');
    expect(liveFiles).toContain('_assets/_sw/stats.js');
    const liveHome = await readFile(join(live, 'index.html'), 'utf8');
    for (const marker of ['window.__swf=', 'data-sw-captcha="hcaptcha"', 'data-sw-pow', 'data-sw-whatsapp=', 'data-sw-redirect=', 'data-sw-endpoint=', 'forms.elsewhere.test', '+264811234567', 'mailto-orders@shop.test']) {
      expect(liveHome, marker).toContain(marker);
    }

    // The demo copy: none of it.
    const demoFiles = await files(demo);
    expect(demoFiles).not.toContain('contact.php');
    expect(demoFiles).not.toContain('sw-mail.config.php');
    expect(demoFiles).not.toContain('_assets/_sw/stats.js');
    expect(demoFiles).toContain('_assets/_sw/sw-demo.js');
    const home = await readFile(join(demo, 'index.html'), 'utf8');
    for (const marker of [
      'window.__swf=', 'data-sw-captcha', 'data-captcha-sitekey', SITE_KEY, 'data-sw-pow', 'data-sw-whatsapp', 'data-sw-redirect',
      'data-sw-endpoint', 'elsewhere.test', '+264811234567', '+264819876543', '@shop.test', 'sw.test', '/a/', 'data-sw-captcha-missing',
    ]) {
      expect(home, marker).not.toContain(marker);
    }
    // In the blob's place, the demo runtime: a plain script, so it runs before the deferred runtimes.
    expect(home).toMatch(/<script src="_assets\/_sw\/sw-demo\.js\?v=[^"]+"><\/script>/);
    // Every form is answered in the page now, the WhatsApp and third-party ones included.
    expect(home.match(/data-sw-routed="[^"]+"/g)).toEqual(['data-sw-routed="contact"', 'data-sw-routed="php"', 'data-sw-routed="tp"', 'data-sw-routed="wa"']);
    // The cart keeps the two channels the page can answer: the checkout and the order form.
    const channels = JSON.parse(
      (/data-channels="([^"]*)"/.exec(home)?.[1] ?? '[]').replaceAll('&quot;', '"').replaceAll('&amp;', '&'),
    ) as Array<{ kind: string; captcha?: boolean; pow?: boolean }>;
    expect(channels.map((c) => c.kind)).toEqual(['checkout', 'form']);
    expect(channels.some((c) => c.captcha || c.pow)).toBe(false);
    // The booking widget still mounts, with no captcha to load and none missing.
    expect(home).toContain('data-sw-booking="massage"');
    // No platform origin in the page's content policy either.
    expect(/<meta name="sw-csp" content="([^"]*)"/.exec(home)?.[1] ?? '').not.toContain('sw.test');

    // The runtime knows only what the site shows anyway: the price, the offering, the thank-you page.
    const runtime = await readFile(join(demo, '_assets', '_sw', 'sw-demo.js'), 'utf8');
    expect(runtime).toContain('sw-demo:');
    // (Minified: the keys lose their quotes.)
    expect(runtime).toContain('mug:{n:"Enamel mug",p:950}');
    expect(runtime).toContain('massage:{id:"massage",name:"Massage",mode:"duration"');
    expect(runtime).toContain('returnPaths:{card:"/thank-you/"}');
    for (const secret of ['@shop.test', 'sw.test', SITE_KEY, 'vendor-secret', 'mock-pay.invalid', '+264']) {
      expect(runtime, secret).not.toContain(secret);
    }
  });

  it('never sets what checkout charges: a demo copy takes no orders', async () => {
    await deploy(await target('Public demo', true));
    expect(await livePriceList()).toBeUndefined();
    await deploy(await target('Webspace', false));
    expect(await livePriceList()).toBeDefined();
  });

  it('builds no differently for Local Hosting: a publish stays live', async () => {
    // A new project is locally hosted already.
    expect((await owner.get(`/projects/${projectId}/deploy-targets`)).body).toContain('"protocol":"local"');
    expect((await owner.post(`/projects/${projectId}/publish`, {})).statusCode).toBe(200);
    const home = await readFile(join(publishRoot, 'shop', 'index.html'), 'utf8');
    expect(home).toContain('window.__swf=');
    expect(home).not.toContain('sw-demo.js');
    expect(existsSync(join(publishRoot, 'shop', '_assets', '_sw', 'sw-demo.js'))).toBe(false);
  });
});

describe('★ turning a target that serves a site into a demo copy', () => {
  const put = (targetId: string, body: Record<string, unknown>) => owner.put(`/projects/${projectId}/deploy-targets/${targetId}`, body);
  const get = async (targetId: string) =>
    ((await owner.get(`/projects/${projectId}/deploy-targets`)).json() as { items: Array<{ id: string; demo?: boolean; lastDeployedAt?: string }> }).items.find(
      (t) => t.id === targetId,
    )!;

  it('needs no confirmation before the first deploy', async () => {
    const id = await target('Webspace', false);
    expect((await put(id, { demo: true })).statusCode).toBe(200);
    expect((await get(id)).demo).toBe(true);
  });

  it('asks once the target has been deployed — still after a rename — and never to switch back', async () => {
    const id = await target('Webspace', false);
    await deploy(id);
    const deployedAt = (await get(id)).lastDeployedAt;
    expect(deployedAt).toBeDefined();

    // A rename keeps when it was deployed, so it cannot be used to skip the question.
    expect((await put(id, { name: 'Renamed' })).statusCode).toBe(200);
    expect((await get(id)).lastDeployedAt).toBe(deployedAt);

    const refused = await put(id, { demo: true });
    expect(refused.statusCode).toBe(400);
    expect(refused.body).toContain('already serves a site');
    expect(refused.body).toContain('demoAck');
    expect((await get(id)).demo).toBeUndefined();

    expect((await put(id, { demo: true, demoAck: true })).statusCode).toBe(200);
    expect((await get(id)).demo).toBe(true);
    // A demo copy already: editing it needs nothing more, and neither does switching it back to live.
    expect((await put(id, { name: 'Public demo' })).statusCode).toBe(200);
    expect((await put(id, { demo: false })).statusCode).toBe(200);
    expect((await get(id)).demo).toBeUndefined();
  });

  it('shows changes to deploy once the target is set up for a different site (demo on or off, minified)', async () => {
    const id = await target('Webspace', false);
    await deploy(id);
    const deployedAt = (await get(id)).lastDeployedAt;
    // Same destination, same site: nothing to redeploy.
    expect((await put(id, { name: 'Renamed' })).statusCode).toBe(200);
    expect((await get(id)).lastDeployedAt).toBe(deployedAt);
    // The host still holds the LIVE site, so the editor must show that the demo copy is not deployed yet.
    expect((await put(id, { demo: true, demoAck: true })).statusCode).toBe(200);
    expect((await get(id)).lastDeployedAt).toBeUndefined();
    await deploy(id);
    expect((await get(id)).lastDeployedAt).toBeDefined();
    expect((await put(id, { demo: false })).statusCode).toBe(200);
    expect((await get(id)).lastDeployedAt).toBeUndefined();
  });

  it('starts afresh when an edit points the target somewhere else', async () => {
    const id = await target('Webspace', false);
    await deploy(id);
    expect((await get(id)).lastDeployedAt).toBeDefined();
    // Another folder is another site: nothing has been deployed THERE, so it reads as not yet deployed and
    // making it a demo copy asks nothing.
    expect((await put(id, { remoteDir: '/demo' })).statusCode).toBe(200);
    expect((await get(id)).lastDeployedAt).toBeUndefined();
    expect((await put(id, { demo: true })).statusCode).toBe(200);
    expect((await get(id)).demo).toBe(true);
  });
});

describe('recording a finished deploy', () => {
  const base: DeployTarget = { id: 't1', name: 'Webspace', protocol: 'sftp', host: 'example.com', user: 'site', remoteDir: '/', secret: { iv: 'x', ct: 'x', tag: 'x' } };
  const repo = (stored: DeployTarget | undefined) => {
    const put = vi.fn(async (_c: unknown, _k: string, _id: string, value: unknown) => value);
    const get = vi.fn(async () => {
      if (!stored) throw new Error('not found');
      return stored;
    });
    return { put, get, repo: { put, get } as unknown as Parameters<typeof recordDeployed>[0] };
  };
  const ctx = {} as Parameters<typeof recordDeployed>[1];
  const now = () => '2026-11-27T12:00:00.000Z';

  it('stamps the record stored NOW, keeping an edit saved while the deploy ran', async () => {
    const r = repo({ ...base, name: 'Renamed meanwhile' });
    await recordDeployed(r.repo, ctx, base, now);
    expect(r.put).toHaveBeenCalledWith(ctx, 'deploy_target', 't1', { ...base, name: 'Renamed meanwhile', lastDeployedAt: now() });
  });

  it('stamps nothing when the target was switched to another site meanwhile (this deploy did not ship it)', async () => {
    const toggled = repo({ ...base, demo: true });
    await recordDeployed(toggled.repo, ctx, base, now);
    expect(toggled.put).not.toHaveBeenCalled();
    const moved = repo({ ...base, remoteDir: '/elsewhere' });
    await recordDeployed(moved.repo, ctx, base, now);
    expect(moved.put).not.toHaveBeenCalled();
  });

  it('leaves a target deleted meanwhile deleted', async () => {
    const gone = repo(undefined);
    await recordDeployed(gone.repo, ctx, base, now);
    expect(gone.put).not.toHaveBeenCalled();
  });
});
