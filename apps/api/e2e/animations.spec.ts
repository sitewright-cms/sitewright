import { test, expect } from '@playwright/test';

const stamp = Date.now();

// Scroll-reveal animations (the AOS `data-aos` vocabulary) against a deployed
// instance: an author writes plain data-aos attributes in a code-first source
// page; the published export ships the first-party runtime (animations.js +
// inline animation CSS) — and ONLY for sites that use it.

test('publish ships the data-aos runtime for an animated code-first site', async ({ playwright, baseURL }) => {
  const ctx = await playwright.request.newContext({ baseURL });

  const reg = await ctx.post('/auth/register', {
    data: { email: `anim-${stamp}@e2e.test`, password: 'Pw-secret-1' },
  });
  expect(reg.status()).toBe(201);
  const slug = `anim-${stamp}`;
  const proj = await ctx.post(`/projects`, { data: { name: 'Animated Site', slug } });
  expect(proj.status()).toBe(201);
  const projectId = (await proj.json()).project.id as string;
  const base = `/projects/${projectId}`;

  // A code-first page authored exactly the way the MCP instructions teach an agent.
  const page = {
    id: 'home',
    path: '',
    title: 'Home',
    root: { id: 'r', type: 'Section' },
    source:
      '<div class="p-8">' +
      '<h1 data-aos="fade-up">Welcome</h1>' +
      '<p data-aos="fade-up" data-aos-delay="200">Revealed on scroll</p>' +
      '<div data-aos="zoom-in" data-aos-duration="800" data-aos-once="false">Replays</div>' +
      '</div>',
  };
  expect((await ctx.put(`${base}/content/page/home`, { data: page })).status()).toBe(200);

  // The sandboxed live preview inlines the runtime (WYSIWYG parity).
  const preview = await ctx.post(`${base}/preview`, { data: page });
  expect(preview.status()).toBe(200);
  const previewHtml = (await preview.json()).html as string;
  expect(previewHtml).toContain('data-aos="fade-up"');
  expect(previewHtml).toContain('[data-aos].aos-init');
  expect(previewHtml).toContain('IntersectionObserver');

  // Publish, then verify the exported site over HTTP.
  expect((await ctx.post(`${base}/publish`)).status()).toBe(200);

  const index = await ctx.get(`/sites/${slug}/index.html`);
  expect(index.status()).toBe(200);
  const html = await index.text();
  // Authored attributes survive; runtime linked; CSS inlined with the a11y gate.
  expect(html).toContain('data-aos="fade-up"');
  expect(html).toContain('data-aos-delay="200"');
  expect(html).toContain('<script defer src="animations.js"></script>');
  expect(html).toContain('[data-aos].aos-init');
  expect(html).toContain('prefers-reduced-motion');

  // The runtime is served from the site root and is the real thing.
  const js = await ctx.get(`/sites/${slug}/animations.js`);
  expect(js.status()).toBe(200);
  const runtime = await js.text();
  expect(runtime).toContain('IntersectionObserver');
  expect(runtime).toContain('aos-animate');

  await ctx.dispose();
});

test('a site without data-aos ships no animation assets', async ({ playwright, baseURL }) => {
  const ctx = await playwright.request.newContext({ baseURL });

  const reg = await ctx.post('/auth/register', {
    data: { email: `plain-${stamp}@e2e.test`, password: 'Pw-secret-1' },
  });
  expect(reg.status()).toBe(201);
  const slug = `plain-${stamp}`;
  const proj = await ctx.post(`/projects`, { data: { name: 'Plain Site', slug } });
  expect(proj.status()).toBe(201);
  const base = `/projects/${(await proj.json()).project.id as string}`;

  const page = {
    id: 'home',
    path: '',
    title: 'Home',
    root: { id: 'r', type: 'Section' },
    source: '<div><h1>Static content</h1></div>',
  };
  expect((await ctx.put(`${base}/content/page/home`, { data: page })).status()).toBe(200);
  expect((await ctx.post(`${base}/publish`)).status()).toBe(200);

  const index = await ctx.get(`/sites/${slug}/index.html`);
  expect(index.status()).toBe(200);
  const html = await index.text();
  expect(html).not.toContain('animations.js');
  expect(html).not.toContain('aos-init');
  expect((await ctx.get(`/sites/${slug}/animations.js`)).status()).toBe(404);

  await ctx.dispose();
});
