// Configure page nav so buildNav('header') yields: Home, About Us▾(children), Our Services▾(children),
// Corporate Social Investment, Career, Contact Us — in the original order. Run from apps/api.
import { readFileSync } from 'node:fs';
const SP = process.argv[2];
const BASE = 'http://dind.local:2003';
const NID = readFileSync(SP + '/nid.txt', 'utf8').trim();
const jar = readFileSync(SP + '/../sw-cookies.txt', 'utf8').split(/\n/).filter((l) => l.trim() && (!l.startsWith('#') || l.startsWith('#HttpOnly_')));
const cookie = jar.map((l) => l.replace(/^#HttpOnly_/, '').split(/\t/)).filter((a) => a.length >= 7).map((a) => `${a[5]}=${a[6]}`).join('; ');
const H = { 'content-type': 'application/json', cookie };
const get = async (id) => (await (await fetch(`${BASE}/projects/${NID}/content/page/${id}`, { headers: H })).json()).item;
const put = async (id, body) => { const r = await fetch(`${BASE}/projects/${NID}/content/page/${encodeURIComponent(id)}`, { method: 'PUT', headers: H, body: JSON.stringify(body) }); if (!r.ok) console.log('  !!', id, r.status, (await r.text()).slice(0, 160)); return r.ok; };

// id -> {slots?, order, dropdown?}  (children keep their parent; order is within their sibling group)
const CFG = {
  home: { slots: ['header', 'mobile'], order: 0 },
  about: { slots: ['header', 'mobile'], order: 1, dropdown: true },
  services: { slots: ['header', 'mobile'], order: 2, dropdown: true },
  'social-investment': { slots: ['header', 'mobile'], order: 3 },
  career: { slots: ['header', 'mobile'], order: 4 },
  contact: { slots: ['header', 'mobile'], order: 5 },
  about__profile: { order: 0 }, about__management: { order: 1 }, about__inauguration: { order: 2 },
  services__agri_industrial: { order: 0 },
};
// services children in original order
const SVC = ['agri-industrial', 'logistics-transportation', 'hydro-business', 'health-pharmaceutical', 'energy', 'mining', 'urban-development', 'building-engineering', 'fuel-gas', 'special-projects'];
SVC.forEach((s, i) => { CFG['services__' + s] = { order: i }; });

for (const [id, c] of Object.entries(CFG)) {
  const page = await get(id);
  if (!page) { console.log('  skip (missing):', id); continue; }
  let body;
  if (c.slots) {
    // a header/mobile nav item: keep a valid (non-empty) nav object
    const nav = { ...(page.nav || {}), slots: c.slots, order: c.order };
    if (c.dropdown !== undefined) nav.dropdown = c.dropdown;
    body = { ...page, order: c.order, nav };
  } else {
    // a dropdown CHILD: it nests via `parent`; it must NOT carry an (empty-slots) nav object.
    const { nav: _drop, ...rest } = page;
    body = { ...rest, order: c.order };
  }
  const ok = await put(id, body);
  if (ok) console.log('  set', id.padEnd(28), c.slots ? 'slots:' + JSON.stringify(c.slots) : '(child)', 'order:' + c.order, c.dropdown ? 'dropdown' : '');
}
console.log('nav config done');
