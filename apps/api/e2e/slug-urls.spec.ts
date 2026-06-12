import { test, expect } from '@playwright/test';

const stamp = Date.now();

// A tiny valid 1x1 PNG (the sharp pipeline decodes + optimizes it).
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==',
  'base64',
);

// Media + preview URLs are addressed by the project SLUG (not its UUID), and the published export
// rebases them to the bundled `_assets/`. Verified against a deployed instance.
test('media + preview URLs are slug-based end to end', async ({ playwright, baseURL }) => {
  const ctx = await playwright.request.newContext({ baseURL });
  expect((await ctx.post('/auth/register', { data: { email: `slug-${stamp}@e2e.test`, password: 'Pw-secret-1' } })).status()).toBe(201);
  const slug = `acme-studio-${stamp}`;
  const proj = await ctx.post('/projects', { data: { name: 'Acme', slug } });
  expect(proj.status()).toBe(201);
  const projectId = (await proj.json()).project.id as string;
  const base = `/projects/${projectId}`;

  // Upload an image → its URL is keyed by the SLUG, and it serves publicly from that URL.
  const up = await ctx.post(`${base}/media`, {
    multipart: { file: { name: 'logo.png', mimeType: 'image/png', buffer: PNG_1X1 } },
  });
  expect(up.status()).toBe(201);
  const asset = (await up.json()).item as { id: string; url: string };
  expect(asset.url.startsWith(`/media/${slug}/${asset.id}/`)).toBe(true); // slug, not the UUID
  expect(asset.url).not.toContain(projectId);
  const served = await ctx.get(asset.url);
  expect(served.status()).toBe(200);
  expect(served.headers()['content-type']).toContain('image');

  // Preview: POST mints the token + returns the slug; the doc serves at /preview/<slug>/<token>.
  const home = { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' }, source: '<div><h1>{{company.name}}</h1></div>' };
  const prev = await ctx.post(`${base}/preview`, { data: home });
  expect(prev.status()).toBe(200);
  const { token, slug: respSlug } = (await prev.json()) as { token: string; slug: string };
  expect(respSlug).toBe(slug);
  const doc = await ctx.get(`/preview/${slug}/${token}`);
  expect(doc.status()).toBe(200);
  expect(doc.headers()['content-security-policy']).toBe('sandbox allow-scripts');
  // A mismatched slug for a real token is a uniform opaque 404 (never leaks existence).
  expect((await ctx.get(`/preview/no-such-project-${stamp}/${token}`)).status()).toBe(404);

  // Publish: the slug-based media URL is rebased to the bundled `_assets/` (no slug/UUID in the export).
  const page = { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' }, source: `<div><img src="${asset.url}"></div>` };
  expect((await ctx.put(`${base}/content/page/home`, { data: page })).status()).toBe(200);
  expect((await ctx.post(`${base}/publish`)).status()).toBe(200);
  const html = await (await ctx.get(`/sites/${slug}/index.html`)).text();
  expect(html).toContain('_assets/'); // media rebased into the portable artifact
  // The published doc carries the platform semantic skeleton: the page body is wrapped in the
  // <main id="page-content"> landmark (the author wrote a neutral <div>).
  expect(html).toContain('<main id="page-content"><div><img src="_assets/');
  expect(html).not.toContain(`/media/${slug}/`); // the editor media URL is gone from the export

  await ctx.dispose();
});
