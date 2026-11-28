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

// Publish once, as an agency would before showing anyone: the live-site scenes need it served.
const published = await ok(a.post(`/projects/${pid}/publish`), 'publish');
console.log(`published: ${published.url ?? '(no url)'} dirty=${published.dirty}`);

console.log('base fixtures in place');
