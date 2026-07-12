import { readFileSync } from 'node:fs';
const SP = process.argv[2];
const BASE = 'http://dind.local:2003';
const NID = readFileSync(SP + '/nid.txt', 'utf8').trim();
const jar = readFileSync(SP + '/../sw-cookies.txt', 'utf8').split(/\n/).filter(l => l.trim() && (!l.startsWith('#') || l.startsWith('#HttpOnly_')));
const cookie = jar.map(l => l.replace(/^#HttpOnly_/, '').split(/\t/)).filter(a => a.length >= 7).map(a => `${a[5]}=${a[6]}`).join('; ');
const H = { 'content-type': 'application/json', cookie };
const settings = JSON.parse(readFileSync(SP + '/settings.json', 'utf8')).item;

const LOGO = '/media/burmeister-native/4dff80ae-5a79-4098-8499-24604a5dce08/4dff80ae-5a79-4098-8499-24604a5dce08-291.webp';

// Service dropdown items (label, route)
const SERVICES = [
  ['Agri & Industrial Business', '/services/agri-industrial'],
  ['Logistics & Transportation Solutions', '/services/logistics-transportation'],
  ['Hydro Business Solutions', '/services/hydro-business'],
  ['Health & Pharmaceutical Solutions', '/services/health-pharmaceutical'],
  ['Energy Solutions', '/services/energy'],
  ['Mining Infrastructure Solutions', '/services/mining'],
  ['Urban Development Solutions', '/services/urban-development'],
  ['Building Engineering Solutions', '/services/building-engineering'],
  ['Fuel & Gas Solutions', '/services/fuel-gas'],
  ['Special Projects', '/services/special-projects'],
];
const ABOUT = [
  ['The Company', '/about/profile'],
  ['Management', '/about/management'],
  ['New Building Inauguration', '/about/inauguration'],
];
const esc = (s) => s.replace(/&/g, '&amp;');
const li = (label, route) => `<li><a href="${route}" class="{{#if (sw-active '${route}')}}active{{/if}}">${esc(label)}</a></li>`;
const subUl = (items, w) => `<ul class="bg-base-100 rounded-box z-20 ${w} p-2 shadow">${items.map(([l, r]) => li(l, r)).join('')}</ul>`;

// ── TOP NAV: white bar, logo + company text (lg) left, horizontal menu right; mobile = MENU dropdown ──
const topNav = `<div class="navbar min-h-0 bg-base-100 px-3 sm:px-5 py-1 shadow-sm">
  <div class="flex-1">
    <a href="/" class="flex items-center gap-2 no-underline hover:bg-transparent">
      <img src="${LOGO}" alt="Burmeister &amp; Partners (PTY) Ltd Logo" class="h-10 w-auto" />
      <span class="hidden leading-tight sm:block">
        <span class="block text-sm font-bold text-primary">Burmeister &amp; Partners (PTY) Ltd</span>
        <span class="block text-[11px] text-base-content/70">Multi-Disciplinary Consulting Engineers &amp; Project Managers</span>
      </span>
    </a>
  </div>
  <div class="hidden flex-none lg:block">
    <ul class="menu menu-horizontal items-center gap-0.5 px-1 text-[13px]">
      <li><a href="/" class="{{#if (sw-active '/' exact=true)}}active{{/if}}">Home</a></li>
      <li><details><summary>About Us</summary>${subUl(ABOUT, 'w-56')}</details></li>
      <li><details><summary>Our Services</summary>${subUl(SERVICES, 'w-64')}</details></li>
      <li><a href="/social-investment" class="{{#if (sw-active '/social-investment')}}active{{/if}}">Corporate Social Investment</a></li>
      <li><a href="/career" class="{{#if (sw-active '/career')}}active{{/if}}">Career</a></li>
      <li><a href="/contact" class="{{#if (sw-active '/contact')}}active{{/if}}">Contact Us</a></li>
    </ul>
  </div>
  <div class="flex-none lg:hidden">
    <div class="dropdown dropdown-end">
      <div tabindex="0" role="button" class="btn btn-outline btn-primary btn-sm gap-1">{{sw-icon "menu" "w-4 h-4"}}<span class="font-semibold">MENU</span></div>
      <ul tabindex="0" class="menu dropdown-content z-30 mt-2 w-72 gap-0.5 rounded-box bg-base-100 p-2 text-sm shadow-lg">
        <li><a href="/">Home</a></li>
        <li class="menu-title text-primary">About Us</li>
        ${ABOUT.map(([l, r]) => `<li><a href="${r}">${esc(l)}</a></li>`).join('\n        ')}
        <li class="menu-title text-primary">Our Services</li>
        ${SERVICES.map(([l, r]) => `<li><a href="${r}">${esc(l)}</a></li>`).join('\n        ')}
        <li><a href="/social-investment">Corporate Social Investment</a></li>
        <li><a href="/career">Career</a></li>
        <li><a href="/contact">Contact Us</a></li>
      </ul>
    </div>
  </div>
</div>`;

// ── FOOTER: dark 3-col office grid + red copyright bar ──
const office = (city, sub, addr, person, phone, tel, email) => `      <div>
        <h3 class="text-lg font-bold">${esc(city)}</h3>
        <p class="mb-3 text-xs uppercase tracking-wide text-neutral-content/50">${esc(sub)}</p>
        <ul class="space-y-2 text-sm text-neutral-content/85">
          <li class="flex gap-2">{{sw-icon "map-pin" "w-4 h-4 mt-0.5 shrink-0 text-primary"}}<span>${esc(addr)}</span></li>
          <li class="flex gap-2">{{sw-icon "user" "w-4 h-4 mt-0.5 shrink-0 text-primary"}}<span>${esc(person)}</span></li>
          <li class="flex gap-2">{{sw-icon "phone" "w-4 h-4 mt-0.5 shrink-0 text-primary"}}<a href="tel:${tel}" class="hover:text-primary">${phone}</a></li>
          <li class="flex gap-2">{{sw-icon "mail" "w-4 h-4 mt-0.5 shrink-0 text-primary"}}<a href="mailto:${email}" class="hover:text-primary">${email}</a></li>
        </ul>
      </div>`;
const footer = `<div class="bg-neutral text-neutral-content">
  <div class="mx-auto grid max-w-screen-xl grid-cols-1 gap-8 px-6 py-12 md:grid-cols-3">
${office('Windhoek', 'Namibia (Head Office)', 'Corner of Andimba Toivo Ya Toivo & Van Zyl Streets, Suiderhof', 'Mr. Ronald Kubas', '+264 61 379 000', '+26461379000', 'bp@burmeister.com.na')}
${office('Swakopmund', 'Namibia', '3 Tobias Hainyeko Street', 'Mr. Morné Izaks', '+264 64 403 155', '+26464403155', 'morne@burmeister.com.na')}
${office('East Africa Region', 'DRC', '9 avenue de l’ecole, Kinshasa – Gombe (DRC)', 'Mr. Wilson Mbonimpa', '+250 788 38 14 63', '+250788381463', 'wilson@burmeister.com.na')}
  </div>
  <div class="bg-primary text-primary-content">
    <div class="mx-auto flex max-w-screen-xl flex-col gap-1 px-6 py-3 text-xs sm:flex-row sm:items-center sm:justify-between">
      <span>© 2026 Burmeister &amp; Partners (PTY) Ltd | Windhoek | Namibia | +264-61-379-000</span>
      <a href="https://phoenix-tech.net" class="opacity-90 hover:opacity-100">a PHOENIX Website development</a>
    </div>
  </div>
</div>`;

settings.website = {
  ...settings.website,
  head: '',          // drop the foreign styles.css (collides with Tailwind/DaisyUI)
  scripts: '',       // drop the 8 foreign vendor scripts
  topNav,
  mobileNav: '',     // mobile handled inside topNav (DaisyUI dropdown — no foreign JS)
  sidebarLeft: '',   // drop the foreign Facebook-page iframe widget (rendered as a blue block)
  sidebarRight: '',
  bottom: '',
  footer,
};

const r = await fetch(`${BASE}/projects/${NID}/content/settings/settings`, { method: 'PUT', headers: H, body: JSON.stringify(settings) });
console.log('chrome PUT', r.status, r.ok ? 'OK (native nav+footer, foreign css/js cleared)' : (await r.text()).slice(0, 300));
