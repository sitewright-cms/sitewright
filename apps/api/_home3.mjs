import { readFileSync } from 'node:fs';
const SP = process.argv[2];
const BASE = 'http://dind.local:2003';
const NID = readFileSync(SP + '/nid.txt', 'utf8').trim();
const jar = readFileSync(SP + '/../sw-cookies.txt', 'utf8').split(/\n/).filter((l) => l.trim() && (!l.startsWith('#') || l.startsWith('#HttpOnly_')));
const cookie = jar.map((l) => l.replace(/^#HttpOnly_/, '').split(/\t/)).filter((a) => a.length >= 7).map((a) => `${a[5]}=${a[6]}`).join('; ');
const H = { 'content-type': 'application/json', cookie };
const cards = JSON.parse(readFileSync(SP + '/cards.json', 'utf8'));
const hero = readFileSync(SP + '/hero.txt', 'utf8').trim();

const source = `<section class="w-full">
  <div class="w-full bg-cover bg-center min-h-[220px] sm:min-h-[340px] lg:min-h-[460px]" style="background-image:url('${hero}')" role="img" aria-label="Burmeister & Partners head office building"></div>
</section>
<div class="bg-base-100">
  <section class="mx-auto max-w-screen-xl px-4 pt-12 pb-6 text-center lg:pt-16">
    <h1 class="text-3xl font-bold leading-tight text-primary lg:text-5xl" data-sw-text="welcome_title">Welcome To Burmeister &amp; Partners (Pty) Ltd</h1>
    <p class="mx-auto mt-5 max-w-3xl text-base text-base-content/75 lg:text-lg" data-sw-text="welcome_subtitle">We are a multi-disciplinary consulting engineering company which provides the full spectrum of engineering and project management services</p>
  </section>
  <section class="mx-auto max-w-screen-xl px-4 pb-16">
    <h2 class="text-center text-2xl font-bold text-primary lg:text-3xl" data-sw-text="portfolio_title">Our Service Portfolio</h2>
    <div class="mx-auto mt-3 mb-10 h-1 w-24 rounded bg-primary/40"></div>
    <div class="grid grid-cols-2 gap-5 lg:grid-cols-4 lg:gap-6">
      {{#each dataset.serviceportfolio}}
      <a href="{{sw-url link}}" class="bp-card group block overflow-hidden rounded-lg bg-base-100 no-underline ring-1 ring-base-200 transition hover:-translate-y-1">
        <div class="aspect-[4/3] overflow-hidden"><img src="{{sw-url image}}" alt="{{title}}" class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" /></div>
        <div class="px-3 py-3.5"><span class="text-sm font-semibold leading-snug text-base-content lg:text-base">{{title}}</span></div>
      </a>
      {{/each}}
    </div>
  </section>
</div>`;

const home = (await (await fetch(`${BASE}/projects/${NID}/content/page/home`, { headers: H })).json()).item;
const r = await fetch(`${BASE}/projects/${NID}/content/page/home`, { method: 'PUT', headers: H, body: JSON.stringify({ ...home, source, data: { ...(home.data || {}), swImport: { ...((home.data || {}).swImport || {}), rewritten: true } }, template: undefined }) });
console.log('home polish', r.status, r.ok ? `OK (${source.length}b, white wrapper + larger type + bp-card)` : (await r.text()).slice(0, 200));
