import { readFileSync } from 'node:fs';
const SP = process.argv[2];
const BASE = 'http://dind.local:2003';
const NID = readFileSync(SP + '/nid.txt', 'utf8').trim();
const jar = readFileSync(SP + '/../sw-cookies.txt', 'utf8').split(/\n/).filter((l) => l.trim() && (!l.startsWith('#') || l.startsWith('#HttpOnly_')));
const cookie = jar.map((l) => l.replace(/^#HttpOnly_/, '').split(/\t/)).filter((a) => a.length >= 7).map((a) => `${a[5]}=${a[6]}`).join('; ');
const H = { 'content-type': 'application/json', cookie };
const put = async (kind, id, body) => { const r = await fetch(`${BASE}/projects/${NID}/content/${kind}/${encodeURIComponent(id)}`, { method: 'PUT', headers: H, body: JSON.stringify(body) }); if (!r.ok) console.log('  !!', kind, id, r.status, (await r.text()).slice(0, 200)); return r.ok; };

const page = JSON.parse(readFileSync(SP + '/inaug-cur.json', 'utf8')).item;
const photos = JSON.parse(readFileSync(SP + '/inaug-photos.json', 'utf8'));

// Page: red hero + intro, then the hero-slider WIDGET, then the description paragraphs (preserved page.data).
const source = `<section class="bp-hero w-full bg-primary text-primary-content">
  <div class="mx-auto max-w-screen-xl px-4 py-16 text-center lg:py-20">
    <h1 class="text-3xl font-bold lg:text-5xl" data-sw-text="page.data.heroTitle">Celebrating 40 years of Engineering Excellence</h1>
  </div>
</section>
<div class="bg-base-100">
  <section class="mx-auto max-w-screen-xl px-4 pt-12 lg:pt-16">
    <p class="mx-auto max-w-3xl text-center text-base leading-relaxed text-base-content/85 lg:text-lg" data-sw-text="page.data.intro">In 2018, we celebrated our 40th year of existence as well as the inauguration of our landmark new design studio in Suiderhof, Windhoek.</p>
  </section>
  <section class="mx-auto max-w-screen-xl px-4 py-10">
    {{> hero-slider}}
  </section>
  <section class="mx-auto max-w-screen-xl px-4 pb-16">
    <div class="mx-auto max-w-3xl space-y-4 text-base leading-relaxed text-base-content/85 lg:text-lg">
      <p data-sw-text="page.data.p2"></p>
      <p data-sw-text="page.data.p3"></p>
      <p data-sw-text="page.data.p4"></p>
      <p data-sw-text="page.data.p5"></p>
      <p data-sw-text="page.data.p6"></p>
    </div>
  </section>
</div>`;

// 1) page (composing {{> hero-slider}} auto-provisions the `hero` dataset)
await put('page', 'about__inauguration', { ...page, source, data: { ...(page.data || {}), swImport: { ...((page.data || {}).swImport || {}), rewritten: true } } });
// 2) the hero config entry: 18 event slides, Ken Burns drift, arrows + dots, autoplay
const slides = photos.map((image) => ({ image, caption: '' }));
const ok = await put('entry', 'inaug-hero', { id: 'inaug-hero', dataset: 'hero', status: 'published', order: 0, values: { autoplay: true, interval: 5000, kenburns: true, show_arrows: true, show_indicators: true, slides } });
console.log(ok ? `inauguration → hero-slider widget OK (${slides.length} slides)` : 'hero entry FAILED');
