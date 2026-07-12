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

const cards = JSON.parse(readFileSync(SP + '/cards.json', 'utf8'));
const hero = readFileSync(SP + '/hero.txt', 'utf8').trim();

// 1) dataset
await put('dataset', 'serviceportfolio', {
  id: 'serviceportfolio', name: 'Service Portfolio', slug: 'serviceportfolio',
  fields: [
    { name: 'title', type: 'text', required: true, localized: false },
    { name: 'image', type: 'text', required: false, localized: false },
    { name: 'link', type: 'text', required: false, localized: false },
  ],
});
// 2) entries
let order = 0;
for (const c of cards) {
  const id = 'sp-' + c.link.split('/').pop();
  if (!(await put('entry', id, { id, dataset: 'serviceportfolio', status: 'published', order: order++, values: c }))) process.exit(1);
}

// 3) home page (native, full-bleed hero + centered intro + portfolio grid; left-aligned captions; no framed box)
const source = `<section class="w-full">
  <div class="w-full bg-cover bg-center min-h-[200px] sm:min-h-[320px] lg:min-h-[440px]" style="background-image:url('${hero}')" role="img" aria-label="Burmeister & Partners head office building"></div>
</section>
<section class="mx-auto max-w-screen-xl px-4 pt-10 pb-6 text-center lg:pt-14">
  <h1 class="text-2xl font-bold leading-tight text-primary lg:text-4xl" data-sw-text="welcome_title">Welcome To Burmeister &amp; Partners (Pty) Ltd</h1>
  <p class="mx-auto mt-4 max-w-3xl text-sm text-base-content/75 lg:text-base" data-sw-text="welcome_subtitle">We are a multi-disciplinary consulting engineering company which provides the full spectrum of engineering and project management services</p>
</section>
<section class="mx-auto max-w-screen-xl px-4 pb-14">
  <h2 class="text-center text-xl font-bold text-primary lg:text-2xl" data-sw-text="portfolio_title">Our Service Portfolio</h2>
  <div class="mx-auto mt-2 mb-8 h-0.5 w-24 bg-primary/30"></div>
  <div class="grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-5">
    {{#each dataset.serviceportfolio}}
    <a href="{{sw-url link}}" class="group block overflow-hidden rounded bg-base-200/60 no-underline shadow-sm transition hover:shadow-md">
      <div class="aspect-[4/3] overflow-hidden">
        <img src="{{sw-url image}}" alt="{{title}}" class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" />
      </div>
      <div class="px-3 py-3"><span class="text-xs font-semibold leading-snug text-base-content lg:text-sm">{{title}}</span></div>
    </a>
    {{/each}}
  </div>
</section>`;

const home = JSON.parse(readFileSync(SP + '/home-imported.json', 'utf8')).item;
const ok = await put('page', home.id, {
  ...home,
  source,
  data: {
    ...(home.data || {}),
    // Flip OUT of rawFidelity so the platform injects Tailwind/DaisyUI + theme (native render).
    swImport: { ...((home.data || {}).swImport || {}), rewritten: true },
    welcome_title: 'Welcome To Burmeister & Partners (Pty) Ltd',
    welcome_subtitle: 'We are a multi-disciplinary consulting engineering company which provides the full spectrum of engineering and project management services',
    portfolio_title: 'Our Service Portfolio',
  },
});
console.log(ok ? `HOME authored OK (source ${source.length} bytes, ${cards.length} cards)` : 'HOME failed');
