# Nativize — golden snippets

> Verified, copy-paste patterns from the burmeister-native spike (rendered + render-diffed faithful at
> desktop+mobile). Agents ADAPT these rather than re-derive. Rule refs → [author-brief.md](./author-brief.md).
> Swap the burmeister-specific URLs/text/dataset slugs for the target site.

## F1 · Foundation: `criticalCss` block (captured fonts + texture + helpers)
Extracted from the foreign CSS; set on `website.criticalCss` (Phase A, not per-page). `!important` beats
the platform's default typography (emitted last in `<head>`).
```css
@font-face{font-family:"bp-heading";src:url('/media/<slug>/<uuid>/primary-font-400.woff') format('woff');font-display:swap;}
@font-face{font-family:"bp-body";src:url('/media/<slug>/<uuid>/secondary-font-400.woff') format('woff');font-display:swap;}
body,p,li,td,th,a,span,div,input,textarea,button,select{font-family:"bp-body",Verdana,Arial,sans-serif !important;}
h1,h2,h3,h4,h5,h6,.bp-heading{font-family:"bp-heading",Georgia,"Times New Roman",serif !important;}
body{background-color:#e6e6e9;background-image:url("data:image/svg+xml,…fractalNoise opacity .07…");}
.bp-hero{position:relative;overflow:hidden;}
.bp-hero::before{content:"";position:absolute;inset:0;background-image:url("…geometric squares OR the real .bm-header asset…");background-size:420px 280px;pointer-events:none;}
.bp-hero>*{position:relative;}
.bp-card{box-shadow:0 8px 17px rgba(0,0,0,.16),0 6px 20px rgba(0,0,0,.10);}
```
Mapping rule: read the foreign CSS — headings use `var(--primary-font)`, body uses `var(--text-font)`;
CI colors from `--primary-color`/`--secondary-color` → `identity.colors`.

## F2 · Foundation: data-driven nav (chrome `mainNav` slot, → `<nav id="main-nav">`) — R13
<!-- NB: since #486 there is a SINGLE `website.mainNav` slot (was topNav/mobileNav). The live
     foundation code (transform/foundation.ts `nativeMainNav`) targets `mainNav`; the markup below is
     illustrative — model it on the global `navbar` recipe (.navbar + .menu.menu-horizontal + .dropdown-hover). -->
```hbs
<div class="bg-base-100 shadow-md"><div class="navbar mx-auto min-h-0 max-w-screen-xl px-3 py-1.5 sm:px-6">
  <div class="flex-1"><a href="/" class="flex items-center gap-2 no-underline"><img src="<LOGO>" class="h-12 w-auto" alt="…"/>…</a></div>
  <div class="hidden flex-none lg:block"><ul class="menu menu-horizontal items-center gap-0.5 px-1 text-[15px] font-medium">
    {{#each nav.header}}
      {{#if children}}
        <li><details><summary class="{{#if (sw-active path)}}text-primary{{/if}}">{{sw-label}}</summary>
          <ul class="z-20 w-64 rounded-box bg-base-100 p-2 shadow-lg">
            {{#each children}}<li><a href="{{sw-url path}}" class="{{#if (sw-active path)}}active{{/if}}">{{sw-label}}</a></li>{{/each}}
          </ul></details></li>
      {{else}}
        <li><a href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}} class="{{#if (sw-active path)}}active{{/if}}">{{sw-label}}</a></li>
      {{/if}}
    {{/each}}
  </ul></div>
  <!-- mobile: a dropdown iterating the same nav.header -->
</div></div>
```
Page nav config (so `nav.header` is correct): top pages `nav.slots:['header','mobile']` + `nav.order`;
dropdown parents `nav.dropdown:true`; CHILDREN carry NO `nav` object (empty slots is rejected on PUT) —
they nest via `parent` + page `order`; set the home item's label with `nav.title:"Home"`.

## P1 · Service-detail `template` (hero + 2-col intro + projects loop + View→PDF modal + CTA) — R3,R16,R17
```hbs
<section class="bp-hero w-full bg-primary text-primary-content"><div class="mx-auto max-w-screen-xl px-4 py-16 text-center lg:py-20">
  <h1 class="text-3xl font-bold lg:text-5xl" data-sw-text="page.data.title">Service</h1></div></section>
<div class="bg-base-100">
  <section class="mx-auto max-w-screen-xl px-4 py-12 lg:py-16"><div class="grid gap-10 lg:grid-cols-2 lg:items-start">
    <div class="text-base leading-relaxed text-base-content/85 lg:text-lg [&_p]:mb-4 [&_ul]:list-disc [&_ul]:pl-5 [&_h6]:font-bold" data-sw-html="page.data.intro"></div>
    <div class="bp-card overflow-hidden rounded-lg ring-1 ring-base-200"><img src="{{sw-url page.data.image}}" alt="{{page.data.title}}" class="h-full w-full object-cover"/></div>
  </div></section>
  <section class="mx-auto max-w-screen-xl px-4 pb-10"><h2 class="mb-4 text-xl font-bold uppercase tracking-wide text-primary lg:text-2xl">Recent Projects</h2>
    <div class="bp-card overflow-hidden rounded-lg border border-base-200 bg-base-100 text-base">
      {{#each page.data.projects}}<div class="grid grid-cols-1 gap-1 border-b border-base-200 px-4 py-3.5 last:border-0 sm:grid-cols-[3fr_1.6fr_1.1fr_auto] sm:items-center sm:gap-4">
        <span class="font-semibold">{{name}}</span><span class="text-sm text-base-content/70">{{location}}</span><span class="text-sm text-base-content/70">{{value}}</span>
        {{#if download}}<span class="flex gap-3 sm:justify-end">
          <a href="#pm{{@index}}" class="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">{{sw-icon "eye" "h-4 w-4"}}View</a>
          <a href="{{sw-url download}}" download target="_blank" rel="noopener" class="inline-flex items-center gap-1 text-sm font-semibold text-base-content/70 hover:text-primary">{{sw-icon "download" "h-4 w-4"}}Download</a>
        </span>{{/if}}
      </div>{{/each}}
    </div></section>
  <section class="mx-auto max-w-screen-xl px-4 pb-16 pt-2"><div class="flex flex-wrap items-center gap-3">
    <a href="/services" class="btn btn-primary gap-2">{{sw-icon "layout-grid" "h-4 w-4"}}See all services</a>
    <span class="text-sm text-base-content/60">or</span>
    <a href="/contact" class="btn btn-neutral gap-2">{{sw-icon "mail" "h-4 w-4"}}Contact us</a>
  </div></section>
</div>
{{#each page.data.projects}}{{#if download}}
<dialog id="pm{{@index}}" data-sw-component="modal" class="h-[85vh] w-full max-w-5xl p-0"><iframe src="{{sw-url download}}" class="h-full w-full" title="{{name}}"></iframe></dialog>
{{/if}}{{/each}}
```
Pages set `template:"service-detail"` + `page.data:{title,intro,image,projects:[{name,location,value,download}]}`.
The `<dialog>`s are a SECOND loop AFTER the list (R17) so `last:`/nth styling on the rows survives.

## P2 · Hero-slider WIDGET (e.g. an event slideshow) — R16
Page body: `{{> hero-slider}}` (auto-provisions the `hero` dataset). Then ONE `hero` entry:
```json
{ "id":"<page>-hero", "dataset":"hero", "status":"published", "order":0,
  "values":{ "autoplay":true, "interval":5000, "kenburns":true, "show_arrows":true, "show_indicators":true,
             "slides":[ {"image":"/media/<slug>/<uuid>/photo-1200.jpg","caption":""}, … ] } }
```
Gotchas: image URLs must be clean (a leading quote → `{{sw-url}}` emits `src="#"` → blank slide); an
empty `caption` renders a small empty pill (give a caption or leave it for the editor).

## P3 · Contact: bg-image + overlay + functional form — R11,R18, C-FIDELITY
```hbs
<section class="relative overflow-hidden">
  <div class="absolute inset-0 bg-cover bg-center" style="background-image:url('<BUILDING>')"></div>
  <div class="absolute inset-0 bg-base-100/88"></div>
  <div class="relative mx-auto max-w-screen-xl px-4 pt-12 lg:pt-16"><div class="flex items-start justify-between gap-6">
    <div><h1 class="text-4xl font-bold text-primary lg:text-5xl" data-sw-text="page.data.heroTitle">GET IN TOUCH</h1>
      <p class="mt-2 text-base-content/70 lg:text-lg" data-sw-text="page.data.heroSubtitle">QUESTIONS ? CONTACT US TODAY</p></div>
    <img src="<LOGO>" class="hidden h-20 w-auto lg:block" alt="logo"/></div><hr class="mt-6 border-base-300/70"/></div>
  <div class="relative mx-auto grid max-w-screen-xl gap-10 px-4 py-10 lg:grid-cols-3 lg:pb-16">
    <div class="lg:col-span-2">{{sw-form "contact" class="flex flex-col gap-4 [&_input]:rounded-md [&_textarea]:rounded-md [&_textarea]:min-h-[10rem]"}}</div>
    <div class="flex flex-col gap-8 text-center lg:text-right">…contact details (data-sw-text)…</div>
  </div>
</section>
```
Form definition first (kind `form`): `{id:"contact",name:"…",fields:[{name:"name",label:"Your Full Name",type:"text",required:true},{name:"email",…type:"email"},{name:"phone",…type:"tel"},{name:"message",…type:"textarea"}]}` → `{{sw-form}}` injects the endpoint + honeypot.

## P4 · Lightbox gallery — R15
```hbs
<div data-sw-component="lightbox" class="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Gallery">
  {{#each dataset.<slug>}}
  <a href="{{sw-url image}}" data-caption="{{title}}" class="bp-card block overflow-hidden rounded-lg">
    <img src="{{sw-url image}}" alt="{{title}}" loading="lazy" class="aspect-square w-full object-cover"/>
  </a>{{/each}}
</div>
```

## P5 · Card grid from a dataset (portfolio / services index) — R3,R23
```hbs
<div class="grid grid-cols-2 gap-5 lg:grid-cols-4 lg:gap-6">
  {{#each dataset.serviceportfolio}}
  <a href="{{sw-url link}}" class="bp-card group block overflow-hidden rounded-lg bg-base-100 no-underline ring-1 ring-base-200 transition hover:-translate-y-1">
    <div class="aspect-[4/3] overflow-hidden"><img src="{{sw-url image}}" alt="{{title}}" class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy"/></div>
    <div class="px-3 py-3.5"><span class="text-sm font-semibold text-base-content lg:text-base">{{title}}</span></div>
  </a>{{/each}}
</div>
```
