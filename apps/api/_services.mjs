import { readFileSync } from 'node:fs';
const SP = process.argv[2];
const BASE = 'http://dind.local:2003';
const NID = readFileSync(SP + '/nid.txt', 'utf8').trim();
const jar = readFileSync(SP + '/../sw-cookies.txt', 'utf8').split(/\n/).filter(l => l.trim() && (!l.startsWith('#') || l.startsWith('#HttpOnly_')));
const cookie = jar.map(l => l.replace(/^#HttpOnly_/, '').split(/\t/)).filter(a => a.length >= 7).map(a => `${a[5]}=${a[6]}`).join('; ');
const H = { 'content-type': 'application/json', cookie };
const put = async (kind, id, body) => {
  const r = await fetch(`${BASE}/projects/${NID}/content/${kind}/${encodeURIComponent(id)}`, { method: 'PUT', headers: H, body: JSON.stringify(body) });
  if (!r.ok) { console.log('PUT', kind, id, r.status, (await r.text()).slice(0, 300)); return false; }
  return true;
};
const strip = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const cards = JSON.parse(readFileSync(SP + '/cards.json', 'utf8'));
const imgBySlug = Object.fromEntries(cards.map((c) => [c.link.split('/').pop(), c.image]));

const SLUGS = ['agri-industrial', 'logistics-transportation', 'hydro-business', 'health-pharmaceutical', 'energy', 'mining', 'urban-development', 'building-engineering', 'fuel-gas', 'special-projects'];

// ── native service-detail template ──
const TEMPLATE = `<section class="w-full bg-primary text-primary-content">
  <div class="mx-auto max-w-screen-xl px-4 py-12 text-center lg:py-16">
    <h1 class="text-2xl font-bold lg:text-4xl" data-sw-text="page.data.title">Service</h1>
  </div>
</section>
<section class="mx-auto max-w-screen-xl px-4 py-10">
  <div class="grid gap-8 lg:grid-cols-2 lg:items-start">
    <div class="text-sm leading-relaxed text-base-content/85 lg:text-base [&_b]:font-semibold [&_h6]:mb-1 [&_h6]:text-base [&_h6]:font-bold [&_h6]:text-base-content [&_li]:mb-1 [&_p]:mb-3 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5" data-sw-html="page.data.intro"></div>
    <div class="overflow-hidden rounded shadow-md">
      <img src="{{sw-url page.data.image}}" alt="{{page.data.title}}" class="h-full w-full object-cover" />
    </div>
  </div>
</section>
<section class="mx-auto max-w-screen-xl px-4 pb-6">
  <h2 class="mb-3 text-base font-bold uppercase tracking-wide text-primary">Recent Projects</h2>
  <div class="border-y border-base-200 text-sm">
    {{#each page.data.projects}}
    <div class="grid grid-cols-1 gap-0.5 border-b border-base-200 py-2.5 last:border-0 sm:grid-cols-[3fr_1.6fr_1.2fr_auto] sm:items-center sm:gap-3">
      <span class="font-semibold text-base-content">{{name}}</span>
      <span class="text-base-content/70">{{location}}</span>
      <span class="text-base-content/70">{{value}}</span>
      <span class="sm:justify-self-end">{{#if download}}<a href="{{sw-url download}}" target="_blank" rel="noopener" class="inline-flex items-center gap-1 text-primary hover:underline">{{sw-icon "download" "h-3.5 w-3.5"}}Download</a>{{/if}}</span>
    </div>
    {{/each}}
  </div>
</section>
<section class="mx-auto max-w-screen-xl px-4 pb-14">
  <div class="flex flex-wrap items-center gap-3">
    <a href="/services" class="btn btn-primary btn-sm">See all services</a>
    <span class="text-sm text-base-content/60">or</span>
    <a href="/contact" class="btn btn-neutral btn-sm">Contact us</a>
  </div>
</section>`;

if (!(await put('template', 'service-detail', { id: 'service-detail', name: 'Service Detail', source: TEMPLATE }))) process.exit(1);
console.log('template service-detail OK (', TEMPLATE.length, 'bytes )');

for (const slug of SLUGS) {
  const page = JSON.parse(readFileSync(SP + `/pagesrc/services__${slug}.json`, 'utf8')).item;
  const src = page.source || '';
  // intro rich HTML (description div has no nested divs → first </div> closes it)
  const intro = (src.match(/data-cb-html="description">([\s\S]*?)<\/div>/) || [, ''])[1].trim();
  // projects rows
  const projects = [...src.matchAll(/<div class="project[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g)].map((m) => {
    const row = m[1];
    const cells = [...row.matchAll(/<div class="bold[^"]*">([\s\S]*?)<\/div>/g)].map((c) => strip(c[1]));
    const download = (row.match(/<a[^>]*href="([^"]*)"[^>]*download/) || [, ''])[1];
    return { name: cells[0] || '', location: cells[1] || '', value: cells[2] || '', download };
  }).filter((p) => p.name);
  const data = {
    ...(page.data || {}),
    swImport: { ...((page.data || {}).swImport || {}), rewritten: true },
    title: page.title,
    intro,
    image: imgBySlug[slug] || '',
    projects,
  };
  const ok = await put('page', page.id, { ...page, source: '', template: 'service-detail', data });
  console.log(ok ? `  ${slug.padEnd(26)} OK (intro ${intro.length}b, ${projects.length} projects)` : `  ${slug} FAILED`);
}
