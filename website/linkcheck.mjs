// Fetches every page of the draft preview and checks that each internal link resolves to a page of the site.
import { readFileSync } from 'node:fs';
const BASE = 'http://dind.local:2003';
const cookie = readFileSync(new URL('../sw2003.cookie', import.meta.url), 'utf8').trim();
const { items } = await (await fetch(`${BASE}/projects/eEb21YIuV4qF/content/page`, { headers: { cookie } })).json();
const byId = new Map(items.map((p) => [p.id, p]));
const route = (p) => { const segs = []; for (let q = p; q; q = q.parent ? byId.get(q.parent) : undefined) if (q.path) segs.unshift(q.path); return segs.join('/'); };
const preview = items.find((p) => p.previewUrl).previewUrl;
const routes = new Set(items.map(route));
let bad = 0, checked = 0;
for (const p of items) {
  const r = route(p);
  const pageUrl = `${BASE}${preview}${r ? `${r}/` : ''}`;
  const res = await fetch(pageUrl);
  if (res.status !== 200) { console.log(`PAGE ${res.status} /${r}`); bad++; continue; }
  const html = await res.text();
  const markup = html.replace(/<code[\s\S]*?<\/code>/g, '').replace(/<pre[\s\S]*?<\/pre>/g, '');
  for (const [, raw] of markup.matchAll(/href="([^"#?]*)[^"]*"/g)) {
    if (!raw || /^(https?:|mailto:|tel:)/.test(raw) && !raw.startsWith(BASE)) continue;
    const abs = new URL(raw, pageUrl);
    if (!abs.pathname.startsWith(preview)) continue;
    const t = decodeURIComponent(abs.pathname.slice(preview.length)).replace(/\/$/, '');
    if (/^(_assets|_sw|media|sitemap|robots|favicon)/.test(t) || /\.[a-z0-9]{2,12}$/i.test(t)) continue;
    checked++;
    if (!routes.has(t)) { console.log(`BROKEN on /${r}: /${t}`); bad++; }
  }
  if (/\{\{[^}]*\}\}/.test(html.replace(/<code[\s\S]*?<\/code>/g, '').replace(/<pre[\s\S]*?<\/pre>/g, ''))) console.log(`MUSTACHE left on /${r}`);
}
console.log(`${items.length} pages, ${checked} internal links checked, ${bad} problems`);
