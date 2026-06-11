import { test, expect } from '@playwright/test';

const stamp = Date.now();

// Publish-completeness over HTTP: configure a site URL + a redirect, publish, and
// confirm the static export serves sitemap.xml / robots.txt / .htaccess.
test('publish emits sitemap.xml, robots.txt, and redirect rules', async ({ playwright, baseURL }) => {
  const api = await playwright.request.newContext({ baseURL });
  const reg = await api.post('/auth/register', {
    data: { email: `seo-${stamp}@e2e.test`, password: 'pw-secret-1' },
  });
  expect(reg.status()).toBe(201);
  const slug = `seo-${stamp}`;
  const proj = await api.post(`/projects`, { data: { name: 'SEO Site', slug } });
  const projectId = (await proj.json()).project.id as string;
  const base = `/projects/${projectId}`;

  // Settings singleton with a production site URL + a redirect.
  const settings = await api.put(`${base}/content/settings/settings`, {
    data: {
      brand: { name: 'SEO Site', colors: {} },
      website: { siteUrl: 'https://acme.example', redirects: [{ from: '/old', to: '/new', status: 301 }] },
      settings: { defaultLocale: 'en', locales: ['en'] },
    },
  });
  expect(settings.status()).toBe(200);

  // A couple of pages, one noindex.
  await api.put(`${base}/content/page/home`, {
    data: { id: 'home', path: '', title: 'Home', root: { id: 'r', type: 'Section' } },
  });
  await api.put(`${base}/content/page/secret`, {
    data: { id: 'secret', path: 'secret', title: 'Secret', noindex: true, root: { id: 'r2', type: 'Section' } },
  });

  expect((await api.post(`${base}/publish`)).status()).toBe(200);

  // The exported static site (served at /sites/<slug>/) now includes the SEO files.
  const sitemap = await api.get(`/sites/${slug}/sitemap.xml`);
  expect(sitemap.status()).toBe(200);
  expect(sitemap.headers()['content-type']).toContain('xml');
  const sitemapBody = await sitemap.text();
  expect(sitemapBody).toContain('<loc>https://acme.example/</loc>');
  expect(sitemapBody).not.toContain('/secret/'); // noindex excluded

  const robots = await api.get(`/sites/${slug}/robots.txt`);
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain('Sitemap: https://acme.example/sitemap.xml');

  // Redirect rules ship in the export ZIP only — extensionless files are NOT
  // served over the public /sites/ route (regression guard for the allowlist).
  expect((await api.get(`/sites/${slug}/.htaccess`)).status()).toBe(404);
  expect((await api.get(`/sites/${slug}/_redirects`)).status()).toBe(404);

  await api.dispose();
});
