// Uploads the captures to the Sitewright website project on :2003 (media folder `docs`) and writes their addresses
// into the media_slots dataset files, which `node ../push.mjs datasets` then sends.
//
// `uploaded.json` remembers what went up: a capture that changed REPLACES its asset's bytes in place (same id, same
// address), an unchanged one is skipped.
//
//   node upload.mjs [slot…]
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { here, OUT } from './lib.mjs';

const BASE = 'http://dind.local:2003';
const PROJECT = 'eEb21YIuV4qF';
const FOLDER = 'docs';
// The session cookie of the account that edits the website on :2003 (kept outside the repo).
const cookie = readFileSync(process.env.SW2003_COOKIE ?? '/tmp/claude-1000/-workspace-sitewright/ec7958e0-e951-4975-95e7-a51a6bdd4286/scratchpad/sw2003.cookie', 'utf8').trim();
const MANIFEST = join(here, 'uploaded.json');
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
// Slots that show another slot's capture.
const ALIAS = { doc_inline_editing: 'doc_client_editing' };

async function send(path, method, file) {
  const form = new FormData();
  const type = file.endsWith('.png') ? 'image/png' : file.endsWith('.jpg') ? 'image/jpeg' : 'video/webm';
  form.append('file', new Blob([readFileSync(file)], { type }), basename(file));
  const res = await fetch(`${BASE}${path}`, { method, headers: { cookie, origin: BASE }, body: form });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} ${basename(file)} → ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text).item;
}

/** The asset address for a capture file, uploading or replacing it as needed. */
async function put(file) {
  const name = basename(file);
  const sha = createHash('sha256').update(readFileSync(file)).digest('hex');
  const known = manifest[name];
  if (known?.sha === sha) return known.url;
  const item = known
    ? await send(`/projects/${PROJECT}/media/${encodeURIComponent(known.id)}/content`, 'PUT', file)
    : await send(`/projects/${PROJECT}/media?folder=${FOLDER}`, 'POST', file);
  manifest[name] = { id: item.id, url: item.url ?? item.path, sha };
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`  ${known ? 'replaced' : 'uploaded'} ${name} → ${manifest[name].url}`);
  return manifest[name].url;
}

const only = new Set(process.argv.slice(2));
const files = ['media_slots.json', 'media_slots-features.json', 'media_slots-docs-a.json', 'media_slots-docs-b.json'].map((f) => join(here, '..', 'datasets', f));
let filled = 0;
for (const file of files) {
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  for (const entry of doc.entries) {
    if (only.size && !only.has(entry.id)) continue;
    const src = ALIAS[entry.id] ?? entry.id;
    const v = entry.values;
    if (v.kind === 'video' && existsSync(join(OUT, `${src}.webm`))) {
      v.video = await put(join(OUT, `${src}.webm`));
      if (existsSync(join(OUT, `${src}-poster.jpg`))) v.poster = await put(join(OUT, `${src}-poster.jpg`));
      filled++;
    } else if (v.kind === 'image' && existsSync(join(OUT, `${src}.png`))) {
      v.image = await put(join(OUT, `${src}.png`));
      filled++;
    }
  }
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
}
console.log(`${filled} slots filled`);
