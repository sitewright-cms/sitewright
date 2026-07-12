import { readFileSync } from 'node:fs';
const SP = process.argv[2];
const BASE = 'http://dind.local:2003';
const NID = readFileSync(SP + '/nid.txt', 'utf8').trim();
const jar = readFileSync(SP + '/../sw-cookies.txt', 'utf8').split(/\n/).filter((l) => l.trim() && (!l.startsWith('#') || l.startsWith('#HttpOnly_')));
const cookie = jar.map((l) => l.replace(/^#HttpOnly_/, '').split(/\t/)).filter((a) => a.length >= 7).map((a) => `${a[5]}=${a[6]}`).join('; ');
const H = { 'content-type': 'application/json', cookie };

const TEMPLATE = `<section class="bp-hero w-full bg-primary text-primary-content">
  <div class="mx-auto max-w-screen-xl px-4 py-16 text-center lg:py-20">
    <h1 class="text-3xl font-bold lg:text-5xl" data-sw-text="page.data.title">Service</h1>
  </div>
</section>
<div class="bg-base-100">
  <section class="mx-auto max-w-screen-xl px-4 py-12 lg:py-16">
    <div class="grid gap-10 lg:grid-cols-2 lg:items-start">
      <div class="text-base leading-relaxed text-base-content/85 lg:text-lg [&_b]:font-semibold [&_h6]:mb-2 [&_h6]:text-lg [&_h6]:font-bold [&_h6]:text-base-content [&_li]:mb-1.5 [&_p]:mb-4 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5" data-sw-html="page.data.intro"></div>
      <div class="bp-card overflow-hidden rounded-lg ring-1 ring-base-200"><img src="{{sw-url page.data.image}}" alt="{{page.data.title}}" class="h-full w-full object-cover" /></div>
    </div>
  </section>
  <section class="mx-auto max-w-screen-xl px-4 pb-10">
    <h2 class="mb-4 text-xl font-bold uppercase tracking-wide text-primary lg:text-2xl">Recent Projects</h2>
    <div class="bp-card overflow-hidden rounded-lg border border-base-200 bg-base-100 text-base">
      {{#each page.data.projects}}
      <div class="grid grid-cols-1 gap-1 border-b border-base-200 px-4 py-3.5 last:border-0 sm:grid-cols-[3fr_1.6fr_1.1fr_auto] sm:items-center sm:gap-4">
        <span class="font-semibold text-base-content">{{name}}</span>
        <span class="text-sm text-base-content/70">{{location}}</span>
        <span class="text-sm text-base-content/70">{{value}}</span>
        {{#if download}}
        <span class="flex gap-3 sm:justify-end">
          <a href="#pm{{@index}}" class="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">{{sw-icon "eye" "h-4 w-4"}}View</a>
          <a href="{{sw-url download}}" download target="_blank" rel="noopener" class="inline-flex items-center gap-1 text-sm font-semibold text-base-content/70 hover:text-primary">{{sw-icon "download" "h-4 w-4"}}Download</a>
        </span>
        {{/if}}
      </div>
      {{/each}}
    </div>
  </section>
  <section class="mx-auto max-w-screen-xl px-4 pb-16 pt-2">
    <div class="flex flex-wrap items-center gap-3">
      <a href="/services" class="btn btn-primary gap-2">{{sw-icon "layout-grid" "h-4 w-4"}}See all services</a>
      <span class="text-sm text-base-content/60">or</span>
      <a href="/contact" class="btn btn-neutral gap-2">{{sw-icon "mail" "h-4 w-4"}}Contact us</a>
    </div>
  </section>
</div>
{{#each page.data.projects}}{{#if download}}
<dialog id="pm{{@index}}" data-sw-component="modal" class="h-[85vh] w-full max-w-5xl p-0">
  <iframe src="{{sw-url download}}" class="h-full w-full" title="{{name}}"></iframe>
</dialog>
{{/if}}{{/each}}`;

const r = await fetch(`${BASE}/projects/${NID}/content/template/service-detail`, { method: 'PUT', headers: H, body: JSON.stringify({ id: 'service-detail', name: 'Service Detail', source: TEMPLATE }) });
console.log('service-detail template', r.status, r.ok ? `OK (${TEMPLATE.length}b, View-modal + icons + bp-hero + larger type)` : (await r.text()).slice(0, 300));
