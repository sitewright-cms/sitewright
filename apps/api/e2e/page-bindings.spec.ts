import { test, expect } from '@playwright/test';

const stamp = Date.now();

// The page-context bindings against a deployed instance: a child code-first page
// reads its OWN segment ({{page.slug}}) and a lean view of its direct parent
// ({{parentPage.title}}, {{parentPage.path}}, {{parentPage.data.*}}). Verified
// through BOTH the sandboxed live preview (WYSIWYG parity) and the published export.

test('page.slug + parentPage bindings render in preview and the published export', async ({ playwright, baseURL }) => {
  const ctx = await playwright.request.newContext({ baseURL });

  const reg = await ctx.post('/auth/register', {
    data: { email: `bindings-${stamp}@e2e.test`, password: 'Pw-secret-1' },
  });
  expect(reg.status()).toBe(201);
  const slug = `bindings-${stamp}`;
  const proj = await ctx.post(`/projects`, { data: { name: 'Bindings Site', slug } });
  expect(proj.status()).toBe(201);
  const projectId = (await proj.json()).project.id as string;
  const base = `/projects/${projectId}`;

  // Home is the PARENT and carries page.data the child inherits.
  const home = {
    id: 'home', path: '', title: 'Home',
    root: { id: 'r', type: 'Section' },
    source: '<div>{{ company.name }}</div>',
    data: { section_color: 'tomato' },
  };
  expect((await ctx.put(`${base}/content/page/home`, { data: home })).status()).toBe(200);

  // The child reads its own slug + the parent view. `parentPage` resolves from the SAVED home above.
  const child = {
    id: 'services', path: 'services', parent: 'home', title: 'Services',
    root: { id: 'r', type: 'Section' },
    source:
      '<div>' +
      '<b id="{{page.slug}}">slug:{{page.slug}}</b> ' +
      'route:{{page.path}} ' +
      'up:<a href="{{sw-url parentPage.path}}">{{parentPage.title}}</a> ' +
      'color:{{parentPage.data.section_color}}' +
      '</div>',
  };
  expect((await ctx.put(`${base}/content/page/services`, { data: child })).status()).toBe(200);

  // Sandboxed live preview (WYSIWYG parity with publish).
  const preview = await ctx.post(`${base}/preview`, { data: child });
  expect(preview.status()).toBe(200);
  const previewHtml = (await preview.json()).html as string;
  expect(previewHtml).toContain('slug:services'); // page.slug = the page's OWN segment
  expect(previewHtml).toContain('id="services"'); // usable in an attribute too
  expect(previewHtml).toContain('>Home</a>'); // parentPage.title — the parent (home)
  expect(previewHtml).toContain('color:tomato'); // parentPage.data.* — inherited from the parent

  // Publish, then verify the exported child page over HTTP.
  expect((await ctx.post(`${base}/publish`)).status()).toBe(200);
  const page = await ctx.get(`/sites/${slug}/services/index.html`);
  expect(page.status()).toBe(200);
  const html = await page.text();
  expect(html).toContain('slug:services'); // own segment, NOT the full /services route
  expect(html).toContain('route:/services'); // page.path stays the FULL computed route
  expect(html).toContain('>Home</a>'); // parentPage.title
  expect(html).toContain('color:tomato'); // parentPage.data.section_color

  await ctx.dispose();
});
