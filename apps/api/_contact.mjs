import { readFileSync } from 'node:fs';
const SP = process.argv[2];
const BASE = 'http://dind.local:2003';
const NID = readFileSync(SP + '/nid.txt', 'utf8').trim();
const jar = readFileSync(SP + '/../sw-cookies.txt', 'utf8').split(/\n/).filter((l) => l.trim() && (!l.startsWith('#') || l.startsWith('#HttpOnly_')));
const cookie = jar.map((l) => l.replace(/^#HttpOnly_/, '').split(/\t/)).filter((a) => a.length >= 7).map((a) => `${a[5]}=${a[6]}`).join('; ');
const H = { 'content-type': 'application/json', cookie };
const page = JSON.parse(readFileSync(SP + '/contact-cur3.json', 'utf8')).item;

const BUILDING = '/media/burmeister-native/c7af4a94-ec16-47bf-a02b-740522208f95/c7af4a94-ec16-47bf-a02b-740522208f95-1200.jpg';
const LOGO = '/media/burmeister-native/4dff80ae-5a79-4098-8499-24604a5dce08/4dff80ae-5a79-4098-8499-24604a5dce08-291.webp';
const PB_MAP = '!1m14!1m8!1m3!1d14734.615156307367!2d17.0977039!3d-22.5920485!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x440c547c43ce1a5c!2sBurmeister%20%26%20Partners%20(Pty)%20Ltd.%20Consulting%20Engineers!5e0!3m2!1sen!2sna!4v1608904602471!5m2!1sen!2sna';
const FORM = '{{sw-form "contact" class="flex flex-col gap-4 [&_[data-sw-part=label]]:mb-1 [&_[data-sw-part=label]]:text-base [&_[data-sw-part=label]]:font-medium [&_[data-sw-part=label]]:text-base-content [&_input]:rounded-md [&_textarea]:rounded-md [&_textarea]:min-h-[10rem] [&_[data-sw-part=submit]]:mt-2 [&_[data-sw-part=submit]]:self-start"}}';

const source = `<section class="relative overflow-hidden">
  <div class="absolute inset-0 bg-cover bg-center" style="background-image:url('${BUILDING}')"></div>
  <div class="absolute inset-0 bg-base-100/88"></div>
  <div class="relative mx-auto max-w-screen-xl px-4 pt-12 lg:pt-16">
    <div class="flex items-start justify-between gap-6">
      <div>
        <h1 class="text-4xl font-bold leading-none text-primary lg:text-5xl" data-sw-text="page.data.heroTitle">GET IN TOUCH</h1>
        <p class="mt-2 text-base text-base-content/70 lg:text-lg" data-sw-text="page.data.heroSubtitle">QUESTIONS ? CONTACT US TODAY</p>
      </div>
      <img src="${LOGO}" alt="Burmeister &amp; Partners logo" class="hidden h-20 w-auto lg:block" />
    </div>
    <hr class="mt-6 border-base-300/70" />
  </div>
  <div class="relative mx-auto grid max-w-screen-xl gap-10 px-4 py-10 lg:grid-cols-3 lg:pb-16">
    <div class="lg:col-span-2">
      ${FORM}
    </div>
    <div class="flex flex-col gap-8 text-center lg:text-right">
      <div>
        <h2 class="text-xl font-bold text-primary" data-sw-text="page.data.contactHeadline">Contact &amp; Enquiries:</h2>
        <p class="mt-3"><a href="mailto:bp@burmeister.com.na" class="inline-flex items-center gap-1.5 hover:text-primary lg:justify-end">{{sw-icon "mail" "h-4 w-4 text-primary"}}<span data-sw-text="page.data.contactEmail">bp@burmeister.com.na</span></a></p>
        <p class="mt-1"><a href="tel:+26461379000" class="inline-flex items-center gap-1.5 hover:text-primary lg:justify-end">{{sw-icon "phone" "h-4 w-4 text-primary"}}<span data-sw-text="page.data.contactPhone">+264-61-379-000</span></a></p>
      </div>
      <div>
        <h2 class="text-xl font-bold text-primary" data-sw-text="page.data.aboutHeadline">About Burmeister</h2>
        <p class="mt-3 text-base-content/75" data-sw-text="page.data.aboutBlurb">We are a multi-disciplinary consulting engineering company which provides the full spectrum of engineering and project management services</p>
      </div>
      <div>
        <h2 class="inline-flex items-center gap-1.5 text-xl font-bold text-primary lg:justify-end" data-sw-text="page.data.locationHeadline">{{sw-icon "map-pin" "h-5 w-5"}}Windhoek, Namibia</h2>
        <p class="mt-3 text-base-content/75" data-sw-text="page.data.locationAddress">Corner of Andimba Toivo Ya Toivo &amp; Van Zyl Streets, Suiderhof</p>
      </div>
    </div>
  </div>
</section>
<section class="mx-auto max-w-screen-xl px-4 pb-14">
  <div class="bp-card overflow-hidden rounded-lg border border-base-200">
    <iframe title="Burmeister &amp; Partners — Windhoek Head Office" src="https://www.google.com/maps/embed?pb=${PB_MAP}" class="block h-[360px] w-full border-0" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>
  </div>
</section>`;

const r = await fetch(`${BASE}/projects/${NID}/content/page/contact`, { method: 'PUT', headers: H, body: JSON.stringify({ ...page, source, data: { ...(page.data || {}), swImport: { ...((page.data || {}).swImport || {}), rewritten: true } } }) });
console.log('contact rebuild', r.status, r.ok ? `OK (${source.length}b, building bg + light overlay + functional form)` : (await r.text()).slice(0, 300));
