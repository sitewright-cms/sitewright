// Base fixtures on a fresh capture slot: the platform's name and three preview share links, then one publish.
// Tokens are made only by the access-keys scene and revoked after it: the editor counts every token as a connected
// agent, and that pill's pulse under a modal's backdrop blur re-rasterises the blur every frame (~4 fps, no GPU). Everything here goes through the public API, as a person in the editor would.
//
//   CAPTURE_BASE=http://dind.local:<port> node seed-base.mjs
import { api, ok } from './lib.mjs';

import { ADMIN } from './admin.mjs';

const a = await api(ADMIN.email, ADMIN.password);
const { projects } = await ok(a.get('/projects'), 'list projects');
const project = projects.find((p) => p.slug === 'example');
if (!project) throw new Error('the seeded example project is missing');
const pid = project.id;
console.log(`project ${project.name} (${pid})`);

// The product's own name, as the brand spells it (the built-in default reads "SiteWright").
await ok(a.put('/admin/settings', { data: { platformName: 'Sitewright' } }), 'platform name');

// Preview share links: one for the client, one for the board that runs out soon, one for the copywriter.
const shares = await ok(a.get(`/projects/${pid}/preview-shares`), 'list shares');
const shared = new Set((shares.items ?? shares.shares ?? []).map((s) => s.label));
const day = 86_400_000;
for (const share of [
  { label: 'Client review — Alpine Outfitters', expiryDays: 14 },
  { label: 'Board preview', expiresAt: Date.now() + 2 * day + 3 * 3_600_000 },
  { label: 'Copywriter', expiryDays: 30 },
]) {
  if (!shared.has(share.label)) await ok(a.post(`/projects/${pid}/preview-shares`, { data: share }), `share ${share.label}`);
}

// A case-study page with the three kinds of client-editable content the inline-editing videos show: text
// (data-sw-text), a responsive image (sw-image editable=…) and a dataset loop (each card opens its entry).
const CASE_STUDY = `<section class="mx-auto grid max-w-6xl items-center gap-12 px-6 py-20 lg:grid-cols-2">
  <div>
    <span class="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Case study</span>
    <h1 class="mt-4 text-5xl font-bold tracking-tight" data-sw-text="cs_title">Alpine Outfitters, relaunched in six weeks</h1>
    <p class="mt-6 text-lg leading-relaxed opacity-70" data-sw-text="cs_intro">A new storefront, three languages and online fitting appointments, built by us and edited by their own team every week.</p>
  </div>
  {{sw-image "/media/example/0Kt7or-proj-flint.png" editable="cs_image" alt="The Alpine Outfitters storefront" class="w-full rounded-3xl shadow-2xl" sizes="100vw"}}
</section>
<section class="mx-auto max-w-6xl px-6 pb-24">
  <h2 class="text-2xl font-bold" data-sw-text="cs_team_title">The team on this project</h2>
  <div class="mt-8 grid gap-6 sm:grid-cols-4">
    {{#each dataset.team}}
    <div class="rounded-2xl border border-base-300 p-6 text-center">
      {{sw-image photo alt=name class="mx-auto h-24 w-24 rounded-full object-cover"}}
      <h3 class="mt-4 font-bold">{{name}}</h3>
      <p class="text-sm opacity-60">{{role}}</p>
    </div>
    {{/each}}
  </div>
</section>`;
await ok(a.put(`/projects/${pid}/content/page/case-study`, { data: { id: 'case-study', path: 'case-study', title: 'Case study: Alpine Outfitters', status: 'published', data: {}, source: CASE_STUDY } }), 'case-study page');

// Publish once, as an agency would before showing anyone: the live-site scenes need it served.
const published = await ok(a.post(`/projects/${pid}/publish`), 'publish');
console.log(`published: ${published.url ?? '(no url)'} dirty=${published.dirty}`);

console.log('base fixtures in place');
