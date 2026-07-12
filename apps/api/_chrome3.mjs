import { readFileSync } from 'node:fs';
const SP = process.argv[2];
const BASE = 'http://dind.local:2003';
const NID = readFileSync(SP + '/nid.txt', 'utf8').trim();
const jar = readFileSync(SP + '/../sw-cookies.txt', 'utf8').split(/\n/).filter((l) => l.trim() && (!l.startsWith('#') || l.startsWith('#HttpOnly_')));
const cookie = jar.map((l) => l.replace(/^#HttpOnly_/, '').split(/\t/)).filter((a) => a.length >= 7).map((a) => `${a[5]}=${a[6]}`).join('; ');
const H = { 'content-type': 'application/json', cookie };
const settings = (await (await fetch(`${BASE}/projects/${NID}/content/settings/settings`, { headers: H })).json()).item;

const LOGO = '/media/burmeister-native/4dff80ae-5a79-4098-8499-24604a5dce08/4dff80ae-5a79-4098-8499-24604a5dce08-291.webp';

// ── TOP NAV: full-width white bar, content in a centered container; menu GENERATED from nav.header ──
const topNav = `<div class="bg-base-100 shadow-md">
  <div class="navbar mx-auto min-h-0 max-w-screen-xl px-3 py-1.5 sm:px-6">
    <div class="flex-1">
      <a href="/" class="flex items-center gap-2 no-underline hover:bg-transparent">
        <img src="${LOGO}" alt="Burmeister &amp; Partners (PTY) Ltd Logo" class="h-12 w-auto" />
        <span class="hidden leading-tight sm:block">
          <span class="block text-base font-bold text-primary">Burmeister &amp; Partners (PTY) Ltd</span>
          <span class="block text-xs text-base-content/70">Multi-Disciplinary Consulting Engineers &amp; Project Managers</span>
        </span>
      </a>
    </div>
    <div class="hidden flex-none lg:block">
      <ul class="menu menu-horizontal items-center gap-0.5 px-1 text-[15px] font-medium">
        {{#each nav.header}}
        {{#if children}}
        <li>
          <details>
            <summary class="{{#if (sw-active path)}}text-primary{{/if}}">{{sw-label}}</summary>
            <ul class="z-20 w-64 rounded-box bg-base-100 p-2 shadow-lg">
              {{#each children}}
              <li><a href="{{sw-url path}}" class="{{#if (sw-active path)}}active{{/if}}">{{sw-label}}</a></li>
              {{/each}}
            </ul>
          </details>
        </li>
        {{else}}
        <li><a href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}} class="{{#if (sw-active path)}}active{{/if}}">{{sw-label}}</a></li>
        {{/if}}
        {{/each}}
      </ul>
    </div>
    <div class="flex-none lg:hidden">
      <div class="dropdown dropdown-end">
        <div tabindex="0" role="button" class="btn btn-outline btn-primary btn-sm gap-1">{{sw-icon "menu" "h-4 w-4"}}<span class="font-semibold">MENU</span></div>
        <ul tabindex="0" class="menu dropdown-content z-30 mt-2 w-72 gap-0.5 rounded-box bg-base-100 p-2 text-[15px] shadow-lg">
          {{#each nav.header}}
          {{#if children}}
          <li class="menu-title text-primary">{{sw-label}}</li>
          {{#each children}}<li><a href="{{sw-url path}}">{{sw-label}}</a></li>{{/each}}
          {{else}}
          <li><a href="{{sw-url path}}"{{#if newTab}} target="_blank" rel="noopener"{{/if}}>{{sw-label}}</a></li>
          {{/if}}
          {{/each}}
        </ul>
      </div>
    </div>
  </div>
</div>`;

// ── FOOTER: dark 3-col offices (list flush-left: list-none pl-0) + red copyright bar ──
const office = (city, sub, addr, person, phone, tel, email) => `      <div>
        <h3 class="text-xl font-bold">${city.replace(/&/g, '&amp;')}</h3>
        <p class="mb-4 text-xs uppercase tracking-wide text-neutral-content/50">${sub}</p>
        <ul class="m-0 list-none space-y-2.5 p-0 text-[15px] text-neutral-content/85">
          <li class="flex items-start gap-2.5">{{sw-icon "map-pin" "mt-0.5 h-4 w-4 shrink-0 text-primary"}}<span>${addr}</span></li>
          <li class="flex items-start gap-2.5">{{sw-icon "user" "mt-0.5 h-4 w-4 shrink-0 text-primary"}}<span>${person}</span></li>
          <li class="flex items-start gap-2.5">{{sw-icon "phone" "mt-0.5 h-4 w-4 shrink-0 text-primary"}}<a href="tel:${tel}" class="hover:text-primary">${phone}</a></li>
          <li class="flex items-start gap-2.5">{{sw-icon "mail" "mt-0.5 h-4 w-4 shrink-0 text-primary"}}<a href="mailto:${email}" class="hover:text-primary">${email}</a></li>
        </ul>
      </div>`;
const footer = `<div class="bg-neutral text-neutral-content">
  <div class="mx-auto grid max-w-screen-xl grid-cols-1 gap-x-8 gap-y-10 px-6 py-14 md:grid-cols-3">
${office('Windhoek', 'Namibia (Head Office)', 'Corner of Andimba Toivo Ya Toivo & Van Zyl Streets, Suiderhof', 'Mr. Ronald Kubas', '+264 61 379 000', '+26461379000', 'bp@burmeister.com.na')}
${office('Swakopmund', 'Namibia', '3 Tobias Hainyeko Street', 'Mr. Morné Izaks', '+264 64 403 155', '+26464403155', 'morne@burmeister.com.na')}
${office('East Africa Region', 'DRC', '9 avenue de l’ecole, Kinshasa – Gombe (DRC)', 'Mr. Wilson Mbonimpa', '+250 788 38 14 63', '+250788381463', 'wilson@burmeister.com.na')}
  </div>
  <div class="bg-primary text-primary-content">
    <div class="mx-auto flex max-w-screen-xl flex-col gap-1 px-6 py-3.5 text-[13px] sm:flex-row sm:items-center sm:justify-between">
      <span>© 2026 Burmeister &amp; Partners (PTY) Ltd | Windhoek | Namibia | +264-61-379-000</span>
      <a href="https://phoenix-tech.net" class="opacity-90 hover:opacity-100">a PHOENIX Website development</a>
    </div>
  </div>
</div>`;

// ── Reusable site CSS: body grey texture + .bp-hero red-band geometric pattern + .bp-card elevation ──
const NOISE = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)' opacity='0.07'/%3E%3C/svg%3E\")";
const SQUARES = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='420' height='280'%3E%3Cg fill='none' stroke='%23ffffff' stroke-width='2' opacity='0.16'%3E%3Crect x='24' y='34' width='74' height='74' rx='13'/%3E%3Crect x='312' y='18' width='92' height='92' rx='15'/%3E%3Crect x='168' y='168' width='62' height='62' rx='11'/%3E%3Crect x='372' y='150' width='54' height='54' rx='10'/%3E%3C/g%3E%3Cg fill='%23ffffff' opacity='0.09'%3E%3Crect x='118' y='66' width='54' height='54' rx='11'/%3E%3Crect x='250' y='138' width='86' height='86' rx='15'/%3E%3Crect x='44' y='168' width='44' height='44' rx='9'/%3E%3Crect x='210' y='20' width='40' height='40' rx='8'/%3E%3C/g%3E%3C/svg%3E\")";
const head = `<style>
body{background-color:#e6e6e9;background-image:${NOISE};}
.bp-hero{position:relative;overflow:hidden;}
.bp-hero::before{content:"";position:absolute;inset:0;background-image:${SQUARES};background-size:420px 280px;background-position:center;pointer-events:none;}
.bp-hero>*{position:relative;}
.bp-card{box-shadow:0 8px 17px rgba(0,0,0,.16),0 6px 20px rgba(0,0,0,.10);}
</style>`;

settings.website = { ...settings.website, head, scripts: '', topNav, mobileNav: '', sidebarLeft: '', sidebarRight: '', bottom: '', footer };
const r = await fetch(`${BASE}/projects/${NID}/content/settings/settings`, { method: 'PUT', headers: H, body: JSON.stringify(settings) });
console.log('chrome3 PUT', r.status, r.ok ? 'OK (data-driven nav + container + footer + body texture)' : (await r.text()).slice(0, 300));
