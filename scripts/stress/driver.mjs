// Mixed heavy-load stress driver for ONE Sitewright instance (see scripts/README.md, `stress/run.sh`).
//
// Runs the plan's PHASES — each a set of concurrent, agent-like workload loops — while a /health probe
// (every 500 ms) measures how long the server takes to answer at all and records the memory ledger.
// A phase with no workloads is a quiet window: it shows whether the instance SETTLES after load.
//
// Workloads (counts per phase in the plan):
//   edit       an agent editing pages while the author's preview shell watches (reload + failures)
//   upload     big photo uploads put on a gallery page, then the preview of that page
//   cold       thumbnails pruned + a content change → a whole-site build that re-encodes every variant
//   shot       single-page preview WITH screenshots (Chromium)
//   pagespeed  a Lighthouse audit (mobile + desktop)
//   publish    a minified publish build
//   exportZip  the whole-project export zip
//   list       unpaginated page + media list reads
//
// env: BASE, EMAIL, PWFILE (admin password file), PLAN (json), OUT (results json), IMGDIR (fixtures)
// plan: { projects, sessions, recoverySeconds, phases: [{ name, seconds, <workload>: <loops>… }] }
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE;
const plan = JSON.parse(readFileSync(process.env.PLAN, 'utf8'));
const IMGDIR = process.env.IMGDIR;
const images = readdirSync(IMGDIR).filter((f) => f.endsWith('.jpg')).sort();
const REQ_TIMEOUT_MS = Number(process.env.REQ_TIMEOUT_MS ?? 240_000);

const t0 = Date.now();
const samples = []; // { phase, kind, ms, status, t }
let phase = 'setup';
const rec = (kind, r) => samples.push({ phase, kind, ms: Math.round(r.ms), status: r.status, t: +((Date.now() - t0) / 1000).toFixed(1), ...(r.note ? { note: r.note } : {}) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

async function call(session, method, path, { body, form, headers = {}, timeout = REQ_TIMEOUT_MS, drain = true } = {}) {
  const t = performance.now();
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: { cookie: session, origin: BASE, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
      redirect: 'manual',
      signal: AbortSignal.timeout(timeout),
    });
    let text = '';
    if (drain) {
      const buf = Buffer.from(await res.arrayBuffer());
      text = buf.length < 4_000_000 ? buf.toString('utf8') : '';
    }
    return { status: res.status, ms: performance.now() - t, text };
  } catch (err) {
    return { status: 0, ms: performance.now() - t, text: '', note: err?.name === 'TimeoutError' ? 'timeout' : String(err?.cause?.code ?? err?.message ?? err) };
  }
}
const json = (r) => { try { return JSON.parse(r.text); } catch { return undefined; } };

async function login() {
  const pw = readFileSync(process.env.PWFILE, 'utf8').trim();
  for (let attempt = 0; attempt < 20; attempt++) {
    const res = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ email: process.env.EMAIL, password: pw }) });
    if (res.status === 200) return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    await sleep(3000);
  }
  throw new Error('login failed');
}

// ── setup: sessions (one per "agent"), projects (duplicates of the seeded example) ──
const sessions = [];
for (let i = 0; i < (plan.sessions ?? 8); i++) sessions.push(await login());
const S = (i) => sessions[i % sessions.length];
let projects = json(await call(S(0), 'GET', '/projects'));
projects = Array.isArray(projects) ? projects : projects.projects;
const example = projects.find((p) => p.slug === 'example') ?? projects[0];
while (projects.length < (plan.projects ?? 8)) {
  const r = await call(S(projects.length), 'POST', `/projects/${example.id}/duplicate`, { body: {} });
  if (r.status === 201) projects.push(json(r).project);
  else await sleep(2000);
}
const pagesByProject = new Map();
for (const p of projects) {
  const list = json(await call(S(0), 'GET', `/projects/${p.id}/content/page`));
  const items = Array.isArray(list) ? list : list?.items ?? [];
  pagesByProject.set(p.id, items.filter((x) => x.status !== 'draft' && x.kind !== 'link' && !x.locale));
}
console.error(`setup: ${sessions.length} sessions, ${projects.length} projects`);

// ── workloads: each is one agent-like loop; `stop()` says the phase is over ──
const W = {
  // An agent editing pages while the author's preview shell watches (reload + failures refresh).
  async edit(i, stop) {
    const s = S(i), p = projects[i % projects.length], pages = pagesByProject.get(p.id);
    for (let step = 0; !stop(); step++) {
      const page = pages[(i * 7 + step) % pages.length];
      const got = await call(s, 'GET', `/projects/${p.id}/content/page/${encodeURIComponent(page.id)}`);
      rec('edit:get', got);
      const g = json(got);
      if (!g?.item) { await sleep(2000); continue; }
      const title = String(g.item.title ?? '').replace(/ ·\d+$/, '') + ` ·${step}`;
      const put = await call(s, 'PUT', `/projects/${p.id}/content/page/${encodeURIComponent(page.id)}?receipt=1`, { body: { ...g.item, title }, headers: { 'if-match': `"${g.version}"` } });
      rec('edit:write', put);
      await sleep(250);
      await Promise.all([
        call(s, 'GET', `/projects/${p.id}/preview-url`).then((r) => rec('edit:preview-url', r)),
        g.previewUrl ? call(s, 'GET', new URL(g.previewUrl, BASE).pathname + `?r=${Date.now()}`).then((r) => rec('edit:shell-reload', r)) : null,
      ]);
      if (step % 3 === 2) rec('edit:preview_page', await call(s, 'POST', `/projects/${p.id}/preview`, { body: { id: page.id } }));
      await sleep(rand(3000, 8000));
    }
  },
  // An agent importing big photos and putting them on a page, then looking at the preview.
  async upload(i, stop) {
    const s = S(i + 3), p = projects[(i + 1) % projects.length];
    for (let step = 0; !stop(); step++) {
      const ids = [];
      for (let k = 0; k < 3 && !stop(); k++) {
        const file = images[(i * 11 + step * 3 + k) % images.length];
        const form = new FormData();
        form.append('file', new Blob([readFileSync(join(IMGDIR, file))], { type: 'image/jpeg' }), `${i}-${step}-${file}`);
        const r = await call(s, 'POST', `/projects/${p.id}/media?folder=stress`, { form });
        rec('upload:image', r);
        const item = json(r)?.item;
        if (item?.url) ids.push(item.url);
      }
      if (ids.length) {
        const source = `<section class="grid grid-cols-3 gap-4 p-8">${ids.map((src) => `<img src="${src}" alt="" class="w-full" loading="lazy">`).join('')}</section>`;
        const id = `gallery-${i}-${step % 4}`;
        const put = await call(s, 'PUT', `/projects/${p.id}/content/page/${id}?receipt=1`, { body: { id, path: id, title: `Gallery ${i} ${step}`, source, data: {} } });
        rec('upload:page', put);
        const t = performance.now();
        const pu = await call(s, 'GET', `/projects/${p.id}/preview-url`);
        rec('upload:preview-url', pu);
        const base = json(pu)?.base;
        if (base) rec('upload:page-html', await call(s, 'GET', `${base}${id}/?r=${Date.now()}`));
        void t;
      }
      await sleep(rand(2000, 5000));
    }
  },
  // A cold whole-site preview: thumbnails pruned + a content change → the build re-encodes every variant.
  async cold(i, stop) {
    const s = S(i + 5);
    for (let step = 0; !stop(); step++) {
      const p = projects[(i + step) % projects.length];
      rec('cold:prune', await call(s, 'POST', `/projects/${p.id}/media/prune-thumbnails`, { body: {} }));
      const page = pagesByProject.get(p.id)[0];
      const got = json(await call(s, 'GET', `/projects/${p.id}/content/page/${encodeURIComponent(page.id)}`));
      if (got?.item) await call(s, 'PUT', `/projects/${p.id}/content/page/${encodeURIComponent(page.id)}?receipt=1`, { body: { ...got.item, title: String(got.item.title).replace(/ ·c\d+$/, '') + ` ·c${step}` } });
      rec('cold:preview-url', await call(s, 'GET', `/projects/${p.id}/preview-url`));
      await sleep(rand(3000, 6000));
    }
  },
  // preview_page with screenshots (Chromium).
  async shot(i, stop) {
    const s = S(i + 2), p = projects[(i + 2) % projects.length], pages = pagesByProject.get(p.id);
    while (!stop()) {
      rec('shot:preview_page', await call(s, 'POST', `/projects/${p.id}/preview?screenshot=1`, { body: { id: pick(pages).id } }));
      await sleep(rand(2000, 5000));
    }
  },
  // Lighthouse (mobile + desktop in one run). 3/min per session, so a slow cadence.
  async pagespeed(i, stop) {
    const s = S(i + 4), p = projects[(i + 3) % projects.length], pages = pagesByProject.get(p.id);
    while (!stop()) {
      rec('pagespeed:audit', await call(s, 'GET', `/projects/${p.id}/pagespeed-audit/${encodeURIComponent(pick(pages).id)}`));
      await sleep(rand(20000, 25000));
    }
  },
  // A minified publish build.
  async publish(i, stop) {
    const s = S(i + 6), p = projects[(i + 4) % projects.length];
    while (!stop()) {
      rec('publish:build', await call(s, 'POST', `/projects/${p.id}/publish`, { body: {} }));
      await sleep(rand(8000, 12000));
    }
  },
  async exportZip(i, stop) {
    const s = S(i + 7), p = projects[(i + 1) % projects.length];
    while (!stop()) {
      rec('export:zip', await call(s, 'GET', `/projects/${p.id}/export.zip`));
      await sleep(rand(8000, 12000));
    }
  },
  // Unpaginated list reads (the File Manager / agents' list_pages + list_media).
  async list(i, stop) {
    const s = S(i), p = projects[i % projects.length];
    while (!stop()) {
      rec('list:pages', await call(s, 'GET', `/projects/${p.id}/content/page`));
      rec('list:media', await call(s, 'GET', `/projects/${p.id}/media`));
      await sleep(rand(1000, 3000));
    }
  },
};

// ── the probe: is the server answering at all? ──
let probing = true;
const probe = (async () => {
  while (probing) {
    const r = await call('', 'GET', '/health', { timeout: 15_000 });
    const m = json(r)?.memory;
    rec('health', m ? { ...r, note: `u${m.usedMB}/r${m.reservedMB}/a${m.availableMB}` } : r);
    await sleep(500);
  }
})();

const marks = [];
for (const ph of plan.phases) {
  phase = ph.name;
  marks.push({ phase, start: (Date.now() - t0) / 1000 });
  console.error(`phase ${ph.name} (${ph.seconds}s)`);
  const end = Date.now() + ph.seconds * 1000;
  const stop = () => Date.now() >= end;
  const loops = [];
  for (const [kind, n] of Object.entries(ph)) {
    if (!(kind in W)) continue;
    for (let i = 0; i < n; i++) loops.push(W[kind](i, stop).catch((e) => console.error(kind, e)));
  }
  if (!loops.length) await sleep(ph.seconds * 1000); // a quiet phase: watch the instance settle
  else await Promise.race([Promise.all(loops), sleep(ph.seconds * 1000 + (ph.drainSeconds ?? 240) * 1000)]);
  marks.at(-1).end = (Date.now() - t0) / 1000;
}
phase = 'recovery';
marks.push({ phase, start: (Date.now() - t0) / 1000 });
console.error(`recovery (${plan.recoverySeconds}s)`);
await sleep(plan.recoverySeconds * 1000);
marks.at(-1).end = (Date.now() - t0) / 1000;
probing = false;
await probe;

const summary = {};
for (const s of samples) {
  const k = `${s.phase} | ${s.kind}`;
  (summary[k] ??= { ms: [], codes: {} }).ms.push(s.ms);
  const code = s.status === 0 ? (s.note ?? 'error') : String(s.status);
  summary[k].codes[code] = (summary[k].codes[code] ?? 0) + 1;
}
const pct = (a, p) => a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];
const rows = Object.entries(summary).map(([k, v]) => {
  const ms = v.ms.sort((a, b) => a - b);
  return { k, n: ms.length, p50: pct(ms, 50), p90: pct(ms, 90), max: ms.at(-1), codes: v.codes };
});
for (const r of rows) console.log(`${r.k.padEnd(40)} n=${String(r.n).padStart(4)} p50=${String(r.p50).padStart(7)} p90=${String(r.p90).padStart(7)} max=${String(r.max).padStart(7)} ${JSON.stringify(r.codes)}`);
writeFileSync(process.env.OUT, JSON.stringify({ t0: t0 / 1000, marks, rows, samples }));
