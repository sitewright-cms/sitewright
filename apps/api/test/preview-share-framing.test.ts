import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_SHARE_EMBEDDING_ORIGINS,
  PREVIEW_SANDBOX_CSP,
  ShareEmbeddingSchema,
  shareFrameAncestorsFor,
} from '@sitewright/schema';
import { makeHarness, type Harness, type TestClient } from './harness.js';

/**
 * PREVIEW SHARE LINKS IN A FRAME: an admin allowlists sites (`shareEmbedding`) that may frame a preview
 * share link. Only HTML answered to a request that authenticated AS A SHARE changes; everything else keeps
 * its policy. jsdom enforces no CSP, so `preview-share-framing.browser.test.ts` proves what a browser does.
 */

const LEAD = 'https://preview.business.na';
const FRAMED_CSP = `${PREVIEW_SANDBOX_CSP}; frame-ancestors 'self' ${LEAD}`;

describe('ShareEmbeddingSchema / shareFrameAncestorsFor', () => {
  it('lists self first, then the origins; an empty list is no policy at all', () => {
    expect(shareFrameAncestorsFor({ origins: [LEAD, 'https://*.example.com'] })).toBe(`'self' ${LEAD} https://*.example.com`);
    expect(shareFrameAncestorsFor({ origins: [] })).toBeNull();
    expect(shareFrameAncestorsFor(undefined)).toBeNull();
  });

  it('takes only what the admin-panel allowlist takes: no injected policy, no bare wildcard, no paths', () => {
    for (const bad of ["https://evil.test; default-src *", 'https://a.test https://b.test', '*', 'https://x.test/embed', 'javascript:alert(1)']) {
      expect(ShareEmbeddingSchema.safeParse({ origins: [bad] }).success, bad).toBe(false);
    }
    expect(ShareEmbeddingSchema.safeParse({ origins: [LEAD] }).success).toBe(true);
  });

  it(`holds at most ${MAX_SHARE_EMBEDDING_ORIGINS} origins`, () => {
    const many = Array.from({ length: MAX_SHARE_EMBEDDING_ORIGINS + 1 }, (_, i) => `https://s${i}.example.com`);
    expect(ShareEmbeddingSchema.safeParse({ origins: many }).success).toBe(false);
    expect(ShareEmbeddingSchema.safeParse({ origins: many.slice(1) }).success).toBe(true);
  });
});

describe('preview share links in a frame', () => {
  let previewRoot: string;
  let h: Harness;
  let admin: TestClient;
  let projectId: string;

  beforeEach(async () => {
    previewRoot = await mkdtemp(join(tmpdir(), 'sw-share-frame-'));
    h = await makeHarness({ previewRoot, cookieSecret: 'share-frame-secret' });
    admin = await h.signup({ admin: true });
    projectId = await admin.createProject('Site', 'site', { localHosting: false });
    const p = admin.project(projectId);
    expect((await p.putContent('page', 'home', { id: 'home', path: '', title: 'Home', source: '<h1>Shared Draft</h1>' })).statusCode).toBe(200);
    expect(
      (await p.putContent('page', 'wip', { id: 'wip', path: 'wip', title: 'Secret Launch', status: 'draft', source: '<h1>WIP</h1>' })).statusCode,
    ).toBe(200);
  });
  afterEach(async () => {
    await h.close();
    await rm(previewRoot, { recursive: true, force: true });
  });

  async function setShareEmbedding(value: unknown): Promise<void> {
    const res = await admin.put('/admin/settings', { shareEmbedding: value });
    expect(res.statusCode, res.body).toBe(200);
  }
  async function createShare(payload: Record<string, unknown> = { label: 'Client review' }): Promise<{ id: string; url: string }> {
    const res = await admin.post(`/projects/${projectId}/preview-shares`, payload);
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as { id: string; url: string };
  }
  async function defaultBase(): Promise<string> {
    const res = await admin.get(`/projects/${projectId}/preview-url`);
    expect(res.statusCode).toBe(200);
    return (res.json() as { base: string }).base;
  }
  /** A request with NO session, as the framing site's visitor makes it. */
  const visit = (url: string) => h.app.inject({ method: 'GET', url });
  const framing = (res: { headers: Record<string, unknown> }) => ({
    csp: res.headers['content-security-policy'],
    xfo: res.headers['x-frame-options'],
  });

  it('★ a share link with the allowlist set: frame-ancestors self + the sites, and no X-Frame-Options', async () => {
    await setShareEmbedding({ origins: [LEAD] });
    const share = await createShare();
    const res = await visit(share.url);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Shared Draft'); // presence guard: this IS the page, not an error
    expect(framing(res)).toEqual({ csp: FRAMED_CSP, xfo: undefined });
    // The sandbox is untouched: still an opaque origin, never same-origin with the app.
    expect(String(res.headers['content-security-policy'])).not.toContain('allow-same-origin');
    // The page's other headers stay as they were.
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['content-security-policy-report-only']).toBeDefined();
  });

  it('a share link with no allowlist: unchanged (SAMEORIGIN)', async () => {
    const share = await createShare();
    const res = await visit(share.url);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Shared Draft');
    expect(framing(res)).toEqual({ csp: PREVIEW_SANDBOX_CSP, xfo: 'SAMEORIGIN' });
  });

  it('the member-only (non-share) preview URL with the allowlist set: unchanged (SAMEORIGIN)', async () => {
    await setShareEmbedding({ origins: [LEAD] });
    const res = await visit(await defaultBase());
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Shared Draft');
    expect(framing(res)).toEqual({ csp: PREVIEW_SANDBOX_CSP, xfo: 'SAMEORIGIN' });
  });

  it('the draft-page notice follows the same rule: framed through a share, SAMEORIGIN otherwise', async () => {
    await setShareEmbedding({ origins: [LEAD] });
    const share = await createShare();
    const viaShare = await visit(`${share.url}wip/`);
    expect(viaShare.statusCode).toBe(404);
    expect(viaShare.body).toContain('Secret Launch'); // presence guard: the notice, not the blank 404
    expect(framing(viaShare)).toEqual({ csp: FRAMED_CSP, xfo: undefined });

    const viaDefault = await visit(`${await defaultBase()}wip/`);
    expect(viaDefault.statusCode).toBe(404);
    expect(viaDefault.body).toContain('Secret Launch');
    expect(framing(viaDefault)).toEqual({ csp: PREVIEW_SANDBOX_CSP, xfo: 'SAMEORIGIN' });
  });

  it('a share link on its old address (the project id) redirects, and the page it lands on is framed', async () => {
    await setShareEmbedding({ origins: [LEAD] });
    const share = await createShare();
    const legacy = share.url.replace('/preview-site/site/', `/preview-site/${projectId}/`);
    expect(legacy).not.toBe(share.url);
    const hop = await visit(legacy);
    expect(hop.statusCode).toBe(301);
    expect(hop.headers.location).toBe(share.url);
    const landed = await visit(String(hop.headers.location));
    expect(landed.statusCode).toBe(200);
    expect(landed.body).toContain('Shared Draft');
    expect(framing(landed)).toEqual({ csp: FRAMED_CSP, xfo: undefined });
  });

  it('a revoked, an expired or a forged share: the same "link does not work" page, still unframeable', async () => {
    const live = await createShare();
    const revoked = await createShare({ label: 'Gone' });
    expect((await admin.del(`/projects/${projectId}/preview-shares/${revoked.id}`)).statusCode).toBe(200);
    const expired = await createShare({ label: 'Lapsed', expiresAt: Date.now() - 60_000 });
    const forged = live.url.replace(/-([A-Za-z0-9_]+)\/$/, '-AAAAAAAAAAAAAAAAAAAAAAAAAAAA/');
    expect(forged).not.toBe(live.url);

    const before = await Promise.all([revoked.url, expired.url, forged].map(visit));
    await setShareEmbedding({ origins: [LEAD] });
    const after = await Promise.all([revoked.url, expired.url, forged].map(visit));
    for (const [i, res] of after.entries()) {
      expect(res.statusCode).toBe(404);
      expect(res.body).toContain('Preview link expired or invalid');
      expect(res.body).toBe(before[i]!.body);
      expect(framing(res)).toEqual(framing(before[i]!));
      // The app's own default: framed by nobody.
      expect(String(res.headers['content-security-policy'])).toContain("frame-ancestors 'none'");
      expect(res.headers['x-frame-options']).toBe('DENY');
    }
  });

  it("the preview's static assets: unchanged", async () => {
    const share = await createShare();
    const page = await visit(share.url);
    const asset = /(?:href|src)="([^"]*_assets\/[^"]+)"/.exec(page.body)?.[1];
    expect(asset, 'the preview page references an _assets file').toBeTruthy();
    const assetUrl = new URL(asset!, `http://x${share.url}`).pathname;
    const before = await visit(assetUrl);
    expect(before.statusCode).toBe(200);
    await setShareEmbedding({ origins: [LEAD] });
    const after = await visit(assetUrl);
    expect(after.statusCode).toBe(200);
    for (const name of ['content-security-policy', 'x-frame-options', 'access-control-allow-origin', 'cross-origin-resource-policy']) {
      expect(after.headers[name], name).toEqual(before.headers[name]);
    }
  });

  it('a saved change applies to the next request, and clearing it restores SAMEORIGIN', async () => {
    const share = await createShare();
    await setShareEmbedding({ origins: [LEAD] });
    expect(framing(await visit(share.url))).toEqual({ csp: FRAMED_CSP, xfo: undefined });
    await setShareEmbedding({ origins: [LEAD, 'https://*.example.com'] });
    expect(framing(await visit(share.url)).csp).toBe(`${FRAMED_CSP} https://*.example.com`);
    await setShareEmbedding(null);
    expect(framing(await visit(share.url))).toEqual({ csp: PREVIEW_SANDBOX_CSP, xfo: 'SAMEORIGIN' });
  });

  it('is its own setting: it never frames the admin panel, and the admin-panel list never frames a share link', async () => {
    const share = await createShare();
    await setShareEmbedding({ origins: [LEAD] });
    const panel = await visit('/health');
    expect(String(panel.headers['content-security-policy'])).toContain("frame-ancestors 'none'");
    expect(panel.headers['x-frame-options']).toBe('DENY');

    await setShareEmbedding(null);
    expect((await admin.put('/admin/settings', { embedding: { enabled: true, origins: ['https://portal.example.com'] } })).statusCode).toBe(200);
    expect(framing(await visit(share.url))).toEqual({ csp: PREVIEW_SANDBOX_CSP, xfo: 'SAMEORIGIN' });
  });

  it('round-trips through the admin settings, survives a save that leaves it out, and is admin-only', async () => {
    await setShareEmbedding({ origins: [LEAD] });
    expect(((await admin.get('/admin/settings')).json() as { settings: { shareEmbedding?: unknown } }).settings.shareEmbedding).toEqual({
      origins: [LEAD],
    });
    // Another panel saves without the field: the allowlist stays.
    expect((await admin.put('/admin/settings', { shareExpiryDays: 7 })).statusCode).toBe(200);
    expect(((await admin.get('/admin/settings')).json() as { settings: { shareEmbedding?: unknown } }).settings.shareEmbedding).toEqual({
      origins: [LEAD],
    });
    // A value that would inject policy is refused, and nothing changes.
    expect((await admin.put('/admin/settings', { shareEmbedding: { origins: [`${LEAD}; script-src *`] } })).statusCode).toBe(400);
    // A project owner who is not an instance admin cannot set it.
    const owner = await h.signup();
    expect((await owner.put('/admin/settings', { shareEmbedding: { origins: ['https://evil.test'] } })).statusCode).toBe(403);
    const share = await createShare();
    expect(framing(await visit(share.url))).toEqual({ csp: FRAMED_CSP, xfo: undefined });
  });
});
