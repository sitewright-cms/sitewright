// A realistic agent session over /mcp, through the WAF: read every page / entry of a duplicated
// example project and write it back, edit CSS, custom code and text, upload media, import by URL,
// preview, deploy. Setup (login, duplicate, access key) goes DIRECT so only agent traffic is measured.
// usage: node mcp-driver.mjs <sdkRoot> <direct base> <waf base> [--setup-only]
// Prints {projectId, slug, …} on stdout (the other drivers target that project).
const [sdkRoot, DIRECT, WAF, flag] = process.argv.slice(2);
const { Client } = await import(`${sdkRoot}/dist/esm/client/index.js`);
const { StreamableHTTPClientTransport } = await import(`${sdkRoot}/dist/esm/client/streamableHttp.js`);

// The instance's seeded admin (run.sh passes the same values it seeded the container with).
const ADMIN_EMAIL = process.env.SW_WAF_ADMIN_EMAIL ?? 'admin@e2e.test';
const ADMIN_PASSWORD = process.env.SW_WAF_ADMIN_PASSWORD ?? 'Pw-secret-1';
// Cookies by name: a response that sets an unrelated cookie must not drop the session.
const jar = new Map();
let cookie = '';
async function api(method, path, body) {
  const res = await fetch(DIRECT + path, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
  }
  cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : undefined;
}

await api('POST', '/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
const projects = await api('GET', '/projects');
const list = Array.isArray(projects) ? projects : projects.projects;
const example = list.find((p) => p.slug === 'example');
if (!example) throw new Error('no example project');
// The seeded example project: real authored content, and a local-hosting target to deploy to. The
// instance is a throwaway, so the session edits it in place.
const projectId = example.id;
const slug = example.slug;
const key = await api('POST', `/projects/${projectId}/api-keys`, {
  name: 'waf-mcp',
  role: 'owner',
  capabilities: ['content:read', 'content:write', 'content:delete', 'publish', 'deploy'],
  expiresInDays: 1,
});
console.error(`project ${projectId} (${slug})`);
if (flag === '--setup-only') {
  // Publish it (for its Local Hosting target that IS the deploy) so the site exists for the public
  // driver, which checks it is actually served.
  await api('POST', `/projects/${projectId}/publish`);
  console.log(JSON.stringify({ projectId, slug }));
  process.exit(0);
}

const transport = new StreamableHTTPClientTransport(new URL(`${WAF}/mcp`), {
  requestInit: { headers: { authorization: `Bearer ${key.token}` } },
});
const client = new Client({ name: 'waf-probe', version: '1.0.0' });
await client.connect(transport);
const tools = await client.listTools();
console.error(`tools: ${tools.tools.length}`);

const stats = { calls: 0, errors: 0, byTool: {} };
async function call(name, args) {
  stats.calls++;
  stats.byTool[name] = (stats.byTool[name] ?? 0) + 1;
  try {
    const r = await client.callTool({ name, arguments: args });
    if (r.isError) {
      stats.errors++;
      console.error(`  ${name}: tool error ${JSON.stringify(r.content).slice(0, 160)}`);
    }
    const text = r.content?.find((c) => c.type === 'text')?.text;
    try {
      return text ? JSON.parse(text) : r;
    } catch {
      return text;
    }
  } catch (e) {
    stats.errors++;
    console.error(`  ${name}: ${e.message.slice(0, 160)}`);
    return undefined;
  }
}

await call('get_scope', {});
await call('get_capabilities', {});
await call('get_guide', { topic: 'templates' });
await call('get_reference', {});
await call('get_components', {});
await call('search_icons', { query: 'arrow right' });
const pages = await call('list_pages', {});
const pageList = (pages?.pages ?? pages?.items ?? (Array.isArray(pages) ? pages : [])).slice(0, 60);
console.error(`pages: ${pageList.length}`);

// Round-trip every page: read, then write it back with a small, realistic edit.
for (const p of pageList) {
  const page = await call('get_page', { id: p.id });
  const body = page?.page ?? page;
  if (!body?.id) continue;
  const edited = { ...body, title: `${body.title ?? ''}`.trim() || body.id };
  delete edited.version;
  delete edited.updatedAt;
  delete edited.createdAt;
  await call('put_page', { page: edited });
}

// Dataset entries: read and write back.
const datasets = await call('list_content', { kind: 'dataset' });
const dsList = (datasets?.items ?? datasets ?? []).slice?.(0, 10) ?? [];
for (const d of dsList) {
  const entries = await call('list_content', { kind: 'entry', dataset: d.slug ?? d.id });
  for (const e of (entries?.items ?? entries ?? []).slice?.(0, 6) ?? []) {
    const full = await call('get_content', { kind: 'entry', id: e.id, dataset: d.slug ?? d.id });
    const data = full?.values ? full : undefined;
    if (data) await call('put_content', { kind: 'entry', id: e.id, dataset: d.slug ?? d.id, data });
  }
}

// A typical agent page: hero, cards, a form embed, an inline script, an animated SVG, template helpers.
const agentPage = {
  id: 'waf-agent-page',
  path: 'pricing',
  title: 'Pricing — Plans & FAQ',
  source: `<section class="hero min-h-[60vh] bg-base-200" style="background-image:url('/media/example/hero.jpg')">
  <div class="hero-content text-center"><div class="max-w-md">
    <h1 class="text-5xl font-bold">Plans that grow with you</h1>
    <p class="py-6">Start free. Upgrade when you're ready — cancel anytime, no questions asked.</p>
    <a href="{{sw-url '/contact/'}}" class="btn btn-primary" data-plan="pro">Get started</a>
  </div></div>
</section>
<section class="grid md:grid-cols-3 gap-6 p-8">
{{#each (sw-dataset "plans")}}
  <div class="card bg-base-100 shadow-xl"><div class="card-body">
    <h2 class="card-title">{{this.name}}</h2><p>{{this.price}} / month</p>
    {{#if this.featured}}<span class="badge badge-secondary">Most popular</span>{{/if}}
  </div></div>
{{/each}}
</section>
<svg viewBox="0 0 100 100" width="80"><circle cx="50" cy="50" r="40"><animate attributeName="r" values="40;30;40" dur="2s" repeatCount="indefinite"/></circle></svg>
<section class="p-8"><h2>Questions? Select a plan, or drop us a line.</h2>{{sw-form "contact"}}</section>
<script>
  document.querySelectorAll('[data-plan]').forEach(function (el) {
    el.addEventListener('click', function () { localStorage.setItem('plan', el.dataset.plan); });
  });
  if (window.location.search.indexOf('utm_source=') > -1) { console.log('campaign'); }
</script>`,
  data: { description: "Compare plans: free, pro and business. Select the one that's right for you — and switch or cancel anytime." },
};
await call('put_page', { page: agentPage });
await call('patch_page', { page: { id: 'waf-agent-page', nav: { title: 'Pricing & Plans' } } });
await call('patch_text', { kind: 'page', id: 'waf-agent-page', field: 'source', edits: [{ old: 'Plans that grow with you', new: "Plans that grow with you — or don't" }] });
await call('patch_critical_css', {
  css: `.hero{min-height:60vh;background:linear-gradient(90deg,#000 0%,rgba(0,0,0,.5) 100%)}\n@media (min-width:768px){.card:hover{transform:translateY(-2px)}}\n.btn[data-plan="pro"]::after{content:"→";margin-left:.25rem}`,
});
// Custom head code in settings: an analytics snippet, a JSON-LD block.
await call('put_content', {
  kind: 'settings',
  id: 'settings',
  merge: true,
  data: {
    website: {
      headHtml: `<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-ABC123');</script>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Acme","url":"https://acme.example","sameAs":["https://www.linkedin.com/company/acme"]}</script>`,
    },
  },
});
await call('preview_page', { page: { id: 'waf-agent-page' }, screenshot: false });
await call('preview_page', { page: { id: 'waf-agent-page' }, screenshot: true, viewports: ['mobile'] });

// Media: inline SVG, a ticket upload (bytes PUT like `curl -T`), import by URL, alt text.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><style>.a{fill:#0af}</style><rect class="a" width="64" height="64" rx="12"/><path d="M16 32h32M32 16v32" stroke="#fff" stroke-width="6"/></svg>`;
const up = await call('upload_media', { filename: 'logo-mark.svg', content_base64: Buffer.from(svg).toString('base64'), alt: 'Acme logo' });
const ticket = await call('create_media_upload', { filename: 'team-photo.jpg', folder: 'photos' });
const jpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKAAH//Z',
  'base64',
);
const uploadUrl = ticket?.uploadUrl ?? ticket?.url ?? ticket?.tickets?.[0]?.uploadUrl ?? ticket?.tickets?.[0]?.url;
const uploads = [];
if (uploadUrl) {
  const target = new URL(uploadUrl, WAF);
  target.host = new URL(WAF).host;
  // `curl -T file URL` sends no content type; many clients send the file's.
  for (const ct of [undefined, 'image/jpeg']) {
    const t2 = ct ? await call('create_media_upload', { filename: `team-photo-${ct.split('/')[1]}.jpg` }) : null;
    const u = ct ? new URL(t2?.uploadUrl ?? t2?.url ?? t2?.tickets?.[0]?.url, WAF) : target;
    u.host = new URL(WAF).host;
    const res = await fetch(u, { method: 'PUT', headers: ct ? { 'content-type': ct } : {}, body: jpeg });
    uploads.push(`${ct ?? '(none)'} → ${res.status}`);
  }
} else console.error(`  no upload link in the create_media_upload result (keys: ${Object.keys(ticket ?? {}).join(', ')})`);
await call('import_image', { url: 'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=1600&q=80&fm=jpg', alt: 'Team at work' });
await call('search_stock_images', { provider: 'all', query: 'team meeting office' });
const upId = up?.id ?? up?.asset?.id;
if (upId) await call('set_media_alt', { items: [{ id: upId, alt: 'Acme logo mark — a plus on blue' }] });
await call('import_website', { url: 'https://www.example.com/', maxPages: 1 });
await call('get_publish_status', {});
await call('deploy_project', {});

// The largest everyday writes: the whole site settings document (on the example project ~100 KB and
// ~1,100 values — past a default WAF's 1,000-argument limit), from the editor (session cookie, REST)
// and from an agent (put_content full replace, inside the JSON-RPC envelope).
const big = {};
// A multilingual site's settings carry its translation catalog: take the example bundle's website
// settings (SW_WAF_BUNDLE = apps/api/example_projects/example/bundle.json) when given.
const { item: current } = await api('GET', `/projects/${projectId}/content/settings/settings`);
const bundlePath = process.env.SW_WAF_BUNDLE;
const fullWebsite = bundlePath ? JSON.parse((await import('node:fs')).readFileSync(bundlePath, 'utf8')).project.website : {};
const settingsDoc = { ...current, website: { ...current.website, ...fullWebsite } };
const editorSave = await fetch(`${WAF}/projects/${projectId}/content/settings/settings`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify(settingsDoc),
});
big.editorSettingsSave = `${editorSave.status} (${JSON.stringify(settingsDoc).length} bytes)`;
const agentSave = await call('put_content', { kind: 'settings', id: 'settings', data: settingsDoc });
big.agentSettingsSave = agentSave?.bytes ? `ok (${agentSave.bytes} bytes)` : JSON.stringify(agentSave)?.slice(0, 120);

console.log(JSON.stringify({ projectId, slug, stats, uploads, big }, null, 1));
await client.close();
