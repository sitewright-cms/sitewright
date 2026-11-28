// Pushes the Sitewright website sources to the `sitewright` project on :2003 over the REST API, signed in as the
// claude@ admin (the session cookie lives in ../sw2003.cookie, mode 600, and is never printed).
//
//   node push.mjs settings            merge settings.json + chrome/* into the project settings
//   node push.mjs page <id> [...]     PUT pages/<id>.hbs (its first line is a {{!-- META {...} --}} header)
//   node push.mjs pages               every pages/*.hbs
//   node push.mjs snippets            every snippets/<name>.hbs as a project snippet ({{> name}})
//   node push.mjs datasets            every datasets/*.json ({ dataset: {...}, entries: [...] })
//   node push.mjs dataset <file>      one datasets/<file>.json (avoids re-sending everyone's entries)
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = 'http://dind.local:2003';
const PROJECT = 'eEb21YIuV4qF';
const cookie = readFileSync(process.env.SW2003_COOKIE ?? '/tmp/claude-1000/-workspace-sitewright/ec7958e0-e951-4975-95e7-a51a6bdd4286/scratchpad/sw2003.cookie', 'utf8').trim();

async function api(method, path, body) {
  let res;
  // The content routes are rate-limited; a burst of entry writes waits out a 429 rather than failing half-way.
  for (let attempt = 0; ; attempt++) {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { cookie, origin: BASE, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status !== 429 || attempt >= 6) break;
    await new Promise((r) => setTimeout(r, Math.min(Number(res.headers.get('retry-after')) || 5, 65) * 1000));
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : {};
}

const read = (p) => readFileSync(join(here, p), 'utf8');

async function pushSettings() {
  const current = (await api('GET', `/projects/${PROJECT}/content/settings/settings`)).item;
  const patch = JSON.parse(read('settings.json'));
  const next = {
    ...current,
    identity: { ...current.identity, ...patch.identity },
    website: {
      ...current.website,
      ...patch.website,
      mainNav: read('chrome/mainNav.hbs'),
      footer: read('chrome/footer.hbs'),
      criticalCss: read('chrome/critical.css'),
    },
  };
  await api('PUT', `/projects/${PROJECT}/content/settings/settings`, next);
  console.log('settings: saved');
}

async function pushPage(id) {
  const raw = read(`pages/${id}.hbs`);
  const m = raw.match(/^\{\{!-- META (\{[\s\S]*?\}) --\}\}\n/);
  if (!m) throw new Error(`pages/${id}.hbs: no META header`);
  const meta = JSON.parse(m[1]);
  const page = { id, status: 'published', data: {}, ...meta, source: raw.slice(m[0].length) };
  await api('PUT', `/projects/${PROJECT}/content/page/${id}`, page);
  console.log(`page ${id}: saved (${page.source.length} chars)`);
}

async function pushSnippets() {
  for (const f of readdirSync(join(here, 'snippets')).filter((f) => f.endsWith('.hbs')).sort()) {
    const name = f.slice(0, -4);
    await api('PUT', `/projects/${PROJECT}/content/snippet/${name}`, { id: name, name, source: read(`snippets/${f}`) });
    console.log(`snippet ${name}: saved`);
  }
}

async function pushDatasets(only) {
  for (const f of readdirSync(join(here, 'datasets')).filter((f) => f.endsWith('.json') && (!only || f === only || f === `${only}.json`)).sort()) {
    const { dataset, entries } = JSON.parse(read(`datasets/${f}`));
    await api('PUT', `/projects/${PROJECT}/content/dataset/${dataset.id}`, dataset);
    for (const [i, e] of entries.entries()) {
      await api('PUT', `/projects/${PROJECT}/content/entry/${e.id}?dataset=${dataset.slug}`, { status: 'published', order: i, ...e, dataset: dataset.slug });
    }
    console.log(`dataset ${dataset.slug}: ${entries.length} entries`);
  }
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'settings') await pushSettings();
else if (cmd === 'page') for (const id of args) await pushPage(id);
else if (cmd === 'pages') for (const f of readdirSync(join(here, 'pages')).filter((f) => f.endsWith('.hbs')).sort()) await pushPage(f.slice(0, -4));
else if (cmd === 'snippets') await pushSnippets();
else if (cmd === 'datasets') await pushDatasets();
else if (cmd === 'dataset') await pushDatasets(args[0]);
else throw new Error('usage: node push.mjs settings | page <id>… | pages | snippets | datasets');
