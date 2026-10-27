import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeHarness, type Harness, type TestClient } from './harness.js';
import { RenderPool } from '../src/render/render-pool.js';

const workerPath = fileURLToPath(new URL('./fixtures/blocks-render-worker.mjs', import.meta.url));

/**
 * ★ The booking widget on a published site: {{sw-booking}} and {{sw-booking-status}} render their mounts,
 * booking.js ships on exactly those pages, the API address stays out of the markup, and the page's policy
 * lets the widget reach the API from a hosted site. The editor's preview runs the same widget.
 */

const SLUG = 'studio';
const PLATFORM = 'https://platform.example.com';
const BOOKING = {
  resources: [{ id: 'anna', name: 'Anna', timeZone: 'Europe/Berlin', hours: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], from: '09:00', to: '17:00' }] }],
  offerings: [{ id: 'massage', name: 'Massage', resourceIds: ['anna'], mode: 'duration', durationMin: 60 }],
  statusPath: '/my-booking/',
};
const page = (id: string, path: string, source: string) => ({ id, path, title: id, root: { id: `r-${id}`, type: 'Section' }, source });

describe('booking widget → publish', () => {
  let harness: Harness;
  let client: TestClient;
  let projectId: string;
  let publishRoot: string;
  let mediaRoot: string;
  let pool: RenderPool;

  beforeEach(async () => {
    publishRoot = await mkdtemp(join(tmpdir(), 'sw-booking-sites-'));
    mediaRoot = await mkdtemp(join(tmpdir(), 'sw-booking-media-'));
    // The editor preview renders in a worker pool.
    pool = new RenderPool({ size: 1, workerPath });
    harness = await makeHarness({ publishRoot, mediaRoot, publicUrl: PLATFORM, renderPool: pool });
    client = await harness.signup();
    projectId = await client.createProject('Studio', SLUG);
    const proj = client.project(projectId);
    expect((await proj.putContent('settings', 'settings', { identity: { name: 'Studio' }, website: {}, settings: {} })).statusCode).toBe(200);
    expect((await proj.putContent('page', 'home', page('home', '', '<section><h1>Studio</h1></section>'))).statusCode).toBe(200);
    expect((await proj.putContent('page', 'book', page('book', 'book', '<section><h2>Book</h2>{{sw-booking "massage"}}</section>'))).statusCode).toBe(200);
    expect((await proj.putContent('page', 'mine', page('mine', 'my-booking', '<section>{{sw-booking-status}}</section>'))).statusCode).toBe(200);
  });

  afterEach(async () => {
    await harness.close();
    await pool.shutdown();
    await rm(publishRoot, { recursive: true, force: true });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  const published = (path: string) => readFile(join(publishRoot, SLUG, path, 'index.html'), 'utf8');
  const policy = (html: string) => (/<meta name="sw-csp" content="([^"]*)"/.exec(html)?.[1] ?? '').replace(/&#39;/g, "'");

  it('ships the widget and its runtime on the booking pages only, with the API reachable and unnamed', async () => {
    expect((await client.put(`/projects/${projectId}/content/booking/booking`, BOOKING)).statusCode).toBe(200);
    expect((await client.post(`/projects/${projectId}/publish`)).statusCode).toBe(200);

    const book = await published('book');
    expect(book).toContain('data-sw-booking="massage"');
    expect(book).toContain('data-status-path="/my-booking/"');
    expect(book).toMatch(/<script defer src="[^"]*booking\.js[^"]*"><\/script>/);
    expect(book).toContain('window.__swb=');
    // The address is assembled at runtime: no booking route in the markup.
    expect(book).not.toContain(`/b/${projectId}`);
    expect(/connect-src [^;]*/.exec(policy(book))?.[0]).toContain(PLATFORM);

    const mine = await published('my-booking');
    expect(mine).toContain('data-sw-booking-status');
    expect(mine).toMatch(/booking\.js/);
    expect(/connect-src [^;]*/.exec(policy(mine))?.[0]).toContain(PLATFORM);

    const home = await published('');
    expect(home).not.toMatch(/booking\.js/);
    expect(home).not.toContain('data-sw-booking');
    expect(policy(home)).not.toContain('platform.example.com');
    expect((await stat(join(publishRoot, SLUG, '_assets', '_sw', 'booking.js'))).size).toBeGreaterThan(1000);
  });

  it('puts the captcha the set-up asks for on the widget, and lets its provider load', async () => {
    expect((await client.put(`/projects/${projectId}/captcha`, { provider: 'hcaptcha', siteKey: '10000000-ffff-ffff-ffff-000000000001', secret: 'vendor-secret' })).statusCode).toBe(200);
    expect((await client.put(`/projects/${projectId}/content/booking/booking`, { ...BOOKING, captcha: true, pow: true })).statusCode).toBe(200);
    expect((await client.post(`/projects/${projectId}/publish`)).statusCode).toBe(200);
    const book = await published('book');
    expect(book).toContain('data-sw-captcha="hcaptcha"');
    expect(book).toContain('data-captcha-sitekey="10000000-ffff-ffff-ffff-000000000001"');
    expect(book).toContain('data-sw-pow');
    expect(policy(book)).toMatch(/script-src [^;]*https:\/\/hcaptcha\.com/);
    // The secret never reaches a page.
    expect(book).not.toContain('vendor-secret');
  });

  it('renders nothing for a project that offers nothing, and ships no runtime there', async () => {
    expect((await client.post(`/projects/${projectId}/publish`)).statusCode).toBe(200);
    const book = await published('book');
    expect(book).toContain('<h2>Book</h2>');
    expect(book).not.toContain('<div data-sw-booking=');
    expect(await published('my-booking')).not.toContain('<div data-sw-booking-status');
  });

  it('runs the same widget in the editor preview, as a dry run', async () => {
    expect((await client.put(`/projects/${projectId}/content/booking/booking`, BOOKING)).statusCode).toBe(200);
    const res = await client.post(`/projects/${projectId}/preview`, { id: 'book' });
    expect(res.statusCode).toBe(200);
    const html = (res.json() as { html: string }).html;
    expect(html).toContain('data-sw-booking="massage"');
    // Inlined, with the resolver in preview mode (a booking there adds ?preview=1).
    expect(html).toContain('function Widget(mount)');
    expect(html).toContain('window.__swb=');
    const blob = /<script data-sw-f>[^<]*?atob\("([^"]+)"\)/.exec(html);
    expect(JSON.parse(Buffer.from(blob![1]!, 'base64').toString('utf8'))).toMatchObject({ p: projectId, v: 1 });
    // An offering that does not exist is pointed out here, and only here.
    const typo = await client.post(`/projects/${projectId}/preview`, { ...page('typo', 'typo', '{{sw-booking "yoga"}}') });
    expect((typo.json() as { html: string }).html).toContain('There is no booking offering “yoga”.');
  });
});
