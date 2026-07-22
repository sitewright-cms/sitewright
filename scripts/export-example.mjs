#!/usr/bin/env node
// Export showcase project(s) as UNPACKED seed bundles committed under apps/api/example_projects/
// (<slug>/manifest.json + bundle.json + media/<assetId>/<file>). First boot imports every bundle in
// that folder — so THIS script is how a showcase gets refreshed after editing it in the app.
//
// Modes:
//   node scripts/export-example.mjs --from-instance <baseUrl> <apiToken> <projectId>
//       Export a LIVE project (the normal maintenance loop: edit the showcase in the editor or via
//       an MCP agent on any instance, then re-export). The token needs content:read on the project.
//       The bundle lands under example_projects/<project slug>/.
//   node scripts/export-example.mjs --from-seed
//       Bootstrap a throwaway in-process instance (temp DB + temp media root) and re-export EVERY
//       project its seed produces — i.e. round-trip the committed bundles through import→export
//       (useful to normalize formatting or after an import-shape change).
//
// Requires apps/api to be BUILT (imports from dist). Output is deterministic per source project —
// re-exporting an unchanged project yields an identical bundle (asset ids live in the project).
import { mkdir, rm, writeFile, copyFile, readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = join(ROOT, 'apps/api');
const OUT_ROOT = join(API, 'example_projects');

// The fetched zip is REMOTE data: its entry paths and the bundle's slug feed a recursive rm + file
// writes on the DEV MACHINE, so confine them exactly like the server's MediaStorage.importAssetFile
// does — charset-checked segments (no dot-segments/dotfiles) and a resolved-path prefix check.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function confinedDest(outDir, assetId, rel) {
  const segments = [assetId, ...rel.split('/')];
  for (const seg of segments) {
    if (!SEGMENT_RE.test(seg) || seg === '.' || seg === '..') throw new Error(`unsafe media path segment "${seg}" in export`);
  }
  const dest = join(outDir, 'media', ...segments);
  if (!resolve(dest).startsWith(resolve(outDir) + sep)) throw new Error(`media path escapes the bundle dir: ${assetId}/${rel}`);
  return dest;
}

const mode = process.argv[2];
if (mode !== '--from-instance' && mode !== '--from-seed') {
  console.error('usage: export-example.mjs --from-instance <baseUrl> <apiToken> <projectId> | --from-seed');
  process.exit(2);
}

/** Write one project's manifest + bundle + media files into example_projects/<slug> (replacing it). */
async function writeBundleDir({ manifest, bundle, mediaFiles }) {
  const slug = bundle.project.slug;
  if (!SLUG_RE.test(slug)) throw new Error(`refusing to write bundle for unsafe project slug "${slug}"`);
  const out = join(OUT_ROOT, slug);
  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, 'media'), { recursive: true });
  // Pretty-printed so PR diffs to a showcase stay reviewable (import parses either form).
  await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(join(out, 'bundle.json'), JSON.stringify(bundle, null, 2) + '\n');
  let files = 0;
  for (const { assetId, rel, read } of mediaFiles) {
    const dest = confinedDest(out, assetId, rel);
    await mkdir(dirname(dest), { recursive: true });
    await read(dest);
    files++;
  }
  console.log(`wrote ${out}: ${Object.entries(manifest.counts).map(([k, v]) => `${k}=${v}`).join(' ')}, ${files} media files`);
}

if (mode === '--from-instance') {
  // Token via argv OR the SW_EXPORT_TOKEN env var (pass "-" as the token arg) — env keeps the
  // bearer out of `ps`/shell history.
  const [baseUrl, tokenArg, projectId] = process.argv.slice(3);
  const token = tokenArg === '-' ? process.env.SW_EXPORT_TOKEN : tokenArg;
  if (!baseUrl || !token || !projectId) {
    console.error('usage: export-example.mjs --from-instance <baseUrl> <apiToken|- (SW_EXPORT_TOKEN)> <projectId>');
    process.exit(2);
  }
  // Use the real export route (zip), then unpack — exercises the exact production export path.
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/projects/${encodeURIComponent(projectId)}/export.zip`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.error(`export failed: HTTP ${res.status} ${await res.text().catch(() => '')}`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const { default: JSZip } = await import(join(API, 'node_modules/jszip/lib/index.js'));
  const zip = await JSZip.loadAsync(buf);
  // Schema-validate the remote documents (same schemas the first-boot loader applies) — a tampered
  // export must fail here, before anything touches the filesystem.
  const { ExportManifestSchema, ProjectExportBundleSchema } = await import(join(ROOT, 'packages/schema/dist/index.js'));
  const manifest = ExportManifestSchema.parse(JSON.parse(await zip.file('manifest.json').async('string')));
  const bundle = ProjectExportBundleSchema.parse(JSON.parse(await zip.file('bundle.json').async('string')));
  const mediaFiles = [];
  zip.forEach((path, entry) => {
    const m = /^media\/([^/]+)\/(.+)$/.exec(path);
    if (!m || entry.dir) return;
    mediaFiles.push({ assetId: m[1], rel: m[2], read: async (dest) => writeFile(dest, await entry.async('nodebuffer')) });
  });
  await writeBundleDir({ manifest, bundle, mediaFiles });
} else {
  // --from-seed: throwaway in-process instance via seedInstance — which itself imports the
  // currently-committed bundles — re-exported with the same helpers the export route composes
  // (a genuine import→export round-trip; useful to normalize formatting or after a shape change).
  const { createDb, runMigrations } = await import(join(API, 'dist/db/client.js'));
  const { seedInstance } = await import(join(API, 'dist/seed.js'));
  const { ContentRepository } = await import(join(API, 'dist/repo/content.js'));
  const { buildExportManifest } = await import(join(API, 'dist/export/manifest.js'));
  const { collectExportMedia } = await import(join(API, 'dist/export/build-zip.js'));
  const { buildThumbSkipMap } = await import(join(API, 'dist/export/thumb-skip.js'));
  const { MediaStorage } = await import(join(API, 'dist/media/storage.js'));

  const work = await mkdtemp(join(tmpdir(), 'example-export-'));
  const mediaRoot = join(work, 'media');
  await mkdir(mediaRoot, { recursive: true });
  const { db, client } = await createDb(`file:${join(work, 'seed.db')}`);
  await runMigrations(db);
  await seedInstance({
    db,
    adminEmail: 'bundle-export@sitewright.example',
    adminPassword: 'bundle-export-only',
    mediaRoot,
    log: (m) => process.stderr.write(m + '\n'),
  });
  const projRows = await client.execute('SELECT id, name, slug FROM projects ORDER BY slug');
  if (!projRows.rows.length) { console.error('seed produced no projects'); process.exit(1); }
  const admin = await client.execute('SELECT id FROM users LIMIT 1');
  const version = JSON.parse(await readFile(join(API, 'package.json'), 'utf8')).version;
  const contentRepo = new ContentRepository(db);
  const storage = new MediaStorage(mediaRoot);
  for (const row of projRows.rows) {
    const project = { id: row.id, name: row.name, slug: row.slug };
    const ctx = { userId: admin.rows[0].id, projectId: project.id, role: 'owner' };
    const bundle = await contentRepo.assembleExportBundle(ctx, project);
    const manifest = buildExportManifest(project, bundle, version);
    const thumbSkip = buildThumbSkipMap(bundle.media);
    const media = await collectExportMedia(
      (assetId) => storage.assetFilePaths(project.slug, assetId, thumbSkip.get(assetId)),
      bundle.media.map((a) => a.id),
    );
    const mediaFiles = media.flatMap(({ assetId, files }) =>
      files.map(({ rel, abs }) => ({ assetId, rel, read: (dest) => copyFile(abs, dest) })),
    );
    await writeBundleDir({ manifest, bundle, mediaFiles });
  }
  await rm(work, { recursive: true, force: true });
}
