import { readFileSync } from 'node:fs';
const SP = process.argv[2];
const BASE = 'http://dind.local:2003';
const BID = readFileSync(SP + '/bid.txt', 'utf8').match(/[A-Za-z0-9]+\s*$/)[0].trim();
const jar = readFileSync(SP + '/../sw-cookies.txt', 'utf8').split(/\n/).filter(l => l.trim() && (!l.startsWith('#') || l.startsWith('#HttpOnly_')));
const cookie = jar.map(l => l.replace(/^#HttpOnly_/, '').split(/\t/)).filter(a => a.length >= 7).map(a => `${a[5]}=${a[6]}`).join('; ');
const H = { 'content-type': 'application/json', cookie };
const put = async (kind, id, body) => {
  const r = await fetch(`${BASE}/projects/${BID}/content/${kind}/${encodeURIComponent(id)}`, { method: 'PUT', headers: H, body: JSON.stringify(body) });
  if (!r.ok) { console.log('PUT', kind, id, r.status, (await r.text()).slice(0, 200)); return false; }
  return true;
};

const { hero, cards } = JSON.parse(readFileSync(SP + '/home-cards.json', 'utf8'));

// 1) service-portfolio dataset
await put('dataset', 'serviceportfolio', {
  id: 'serviceportfolio', name: 'Service Portfolio', slug: 'serviceportfolio',
  fields: ['title', 'image', 'link'].map(name => ({ name, type: 'text', required: false, localized: false })),
});
// 2) entries
let order = 0;
for (const c of cards) {
  const id = 'sp-' + c.link.split('/').pop();
  if (!(await put('entry', id, { id, dataset: 'serviceportfolio', status: 'published', order: order++, values: { title: c.label, image: c.img, link: c.link } }))) process.exit(1);
}

// 3) home page source (native, responsive)
const card = `        {{#each dataset.serviceportfolio}}
        <a href="{{sw-url link}}" class="group block overflow-hidden rounded bg-white shadow-sm ring-1 ring-base-200 no-underline">
          <div class="aspect-[4/3] overflow-hidden"><img src="{{sw-url image}}" alt="{{title}}" class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"></div>
          <div class="px-2 py-3 text-center"><span class="text-xs lg:text-sm font-semibold leading-snug text-base-content">{{title}}</span></div>
        </a>
        {{/each}}`;
const source = `<div class="w-full bg-black/5">
  <div class="sw-container bg-white ring-1 ring-base-200">
    <div class="w-full bg-cover bg-center min-h-[220px] sm:min-h-[340px] lg:min-h-[520px]" style="background-image:url('${hero}')"></div>
    <section class="text-center px-4 py-10 lg:py-14">
      <h1 class="text-primary text-2xl lg:text-4xl font-bold leading-tight">Welcome To Burmeister &amp; Partners (Pty) Ltd</h1>
      <p class="mt-4 mx-auto max-w-3xl text-sm lg:text-base text-base-content/80">We are a multi-disciplinary consulting engineering company which provides the full spectrum of engineering and project management services</p>
    </section>
    <section class="px-4 lg:px-8 pb-14">
      <h2 class="text-center text-primary text-xl lg:text-2xl font-bold">Our Service Portfolio</h2>
      <div class="mx-auto mt-3 mb-8 h-px w-40 bg-base-300"></div>
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-5">
${card}
      </div>
    </section>
  </div>
</div>`;

const pages = JSON.parse(readFileSync(SP + '/pages.json', 'utf8')).items || [];
const home = pages.find(p => !p.path || p.path === '');
const ok = await put('page', home.id, { ...home, source });
console.log(ok ? 'HOME authored OK (source ' + source.length + ' bytes, ' + cards.length + ' cards)' : 'HOME failed');
