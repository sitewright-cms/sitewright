import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectBundle } from '@sitewright/core';
import type { MediaAsset } from '@sitewright/schema';
import { buildSite, PublishError, type ReleaseManifest } from './build.js';
import { collectSiteFiles } from './adapters.js';

/**
 * A self-contained build job for an isolated worker. Media binaries are inlined
 * as base64 so the worker needs no filesystem/secret/DB access — only stdin.
 */
export interface WorkerJob {
  bundle: ProjectBundle;
  publishedAt: string;
  /** Media metadata (incl. `kind:'font'`), each with its stored files inlined as base64. */
  media: ReadonlyArray<{ asset: MediaAsset; files: Record<string, string> }>;
  /** Publish-time JSON snapshot (`website.jsonDataUrl`), fetched in the main process. */
  jsonData?: unknown;
  /** Reusable Handlebars partials (name → source) a source page can `{{> compose}}`. */
  snippets?: Record<string, string>;
}

/** The worker's result: the release manifest + every built file as base64. */
export interface WorkerResult {
  manifest: ReleaseManifest;
  files: Record<string, string>;
}

/** Own-enumerable read avoiding dynamic indexing. */
function readBase64(files: Record<string, string>, key: string): string | undefined {
  const found = Object.entries(files).find(([k]) => k === key);
  return found ? found[1] : undefined;
}

/**
 * Runs a build from an in-memory job (no disk/secret access beyond a private temp
 * dir) and returns the artifact as base64-encoded files. Pure with respect to the
 * host: everything it needs arrives in `job`.
 */
export async function runWorker(job: WorkerJob): Promise<WorkerResult> {
  const out = await mkdtemp(join(tmpdir(), 'sw-worker-'));
  try {
    const media = job.media.map((m) => m.asset);
    const filesByAsset = new Map(job.media.map((m) => [m.asset.id, m.files]));
    const manifest = await buildSite({
      outDir: out,
      bundle: job.bundle,
      publishedAt: job.publishedAt,
      media, // includes `kind:'font'` assets — copyMedia bundles their faces
      jsonData: job.jsonData,
      snippets: job.snippets,
      readMedia: async (assetId, file) => {
        const b64 = readBase64(filesByAsset.get(assetId) ?? {}, file);
        if (b64 === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        return Buffer.from(b64, 'base64');
      },
    });

    const files = new Map<string, string>();
    for (const f of await collectSiteFiles(out)) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- abs confined to the worker temp dir
      files.set(f.rel, (await readFile(f.abs)).toString('base64'));
    }
    return { manifest, files: Object.fromEntries(files) };
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}

/* v8 ignore start -- process glue (stdin/stdout); the build logic is runWorker, tested above */
// CLI entrypoint: read a job JSON from stdin, write the result JSON to stdout.
// Invoked inside the isolated worker container.
async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const job = JSON.parse(Buffer.concat(chunks).toString('utf8')) as WorkerJob;
  const result = await runWorker(job);
  process.stdout.write(JSON.stringify(result));
}

// Run only when executed directly (not when imported by tests).
if (process.argv[1] && process.argv[1].endsWith('build-worker.js')) {
  main().catch((err) => {
    process.stderr.write(err instanceof Error ? err.message : String(err));
    // Exit 3 marks an author-correctable build error so the API returns 409.
    process.exit(err instanceof PublishError ? 3 : 1);
  });
}
/* v8 ignore stop */
