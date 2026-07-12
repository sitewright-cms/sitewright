// Generic page-authoring tool for the Burmeister-native spike.
// Usage: node _author.mjs <SP> <planFile.json>
// plan = { pageId, source?, template?, data?, datasets?:[{dataset, entries:[...]}] }
// Guarantees: datasets+entries upserted first, page PUT with swImport.rewritten=true (exits rawFidelity),
// existing page path/title/nav preserved.
import { readFileSync } from 'node:fs';
const [SP, planFile] = process.argv.slice(2);
const BASE = 'http://dind.local:2003';
const NID = readFileSync(SP + '/nid.txt', 'utf8').trim();
const jar = readFileSync(SP + '/../sw-cookies.txt', 'utf8').split(/\n/).filter((l) => l.trim() && (!l.startsWith('#') || l.startsWith('#HttpOnly_')));
const cookie = jar.map((l) => l.replace(/^#HttpOnly_/, '').split(/\t/)).filter((a) => a.length >= 7).map((a) => `${a[5]}=${a[6]}`).join('; ');
const H = { 'content-type': 'application/json', cookie };
const plan = JSON.parse(readFileSync(planFile, 'utf8'));

const put = async (kind, id, body) => {
  const r = await fetch(`${BASE}/projects/${NID}/content/${kind}/${encodeURIComponent(id)}`, { method: 'PUT', headers: H, body: JSON.stringify(body) });
  const txt = r.ok ? '' : (await r.text()).slice(0, 400);
  if (!r.ok) console.log(`  !! PUT ${kind}/${id} ${r.status} ${txt}`);
  return r.ok;
};
const get = async (kind, id) => {
  const r = await fetch(`${BASE}/projects/${NID}/content/${kind}/${encodeURIComponent(id)}`, { headers: H });
  return r.ok ? (await r.json()).item : null;
};

let ok = true;
for (const ds of plan.datasets || []) {
  ok = (await put('dataset', ds.dataset.id, ds.dataset)) && ok;
  let order = 0;
  for (const e of ds.entries || []) ok = (await put('entry', e.id, { status: 'published', order: order++, ...e, dataset: ds.dataset.id })) && ok;
  console.log(`  dataset ${ds.dataset.id}: ${ds.entries?.length || 0} entries`);
}

const page = await get('page', plan.pageId);
if (!page) { console.log(`  !! page ${plan.pageId} not found`); process.exit(1); }
const body = {
  ...page,
  source: plan.source ?? '',
  data: { ...(page.data || {}), ...(plan.data || {}), swImport: { ...((page.data || {}).swImport || {}), rewritten: true } },
};
if (plan.template) body.template = plan.template; else delete body.template;
ok = (await put('page', plan.pageId, body)) && ok;
console.log(ok ? `AUTHORED ${plan.pageId} (source ${(plan.source || '').length}b${plan.template ? ', template ' + plan.template : ''})` : `FAILED ${plan.pageId}`);
process.exit(ok ? 0 : 1);
