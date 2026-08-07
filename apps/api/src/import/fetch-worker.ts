#!/usr/bin/env node
/**
 * The crawl/import worker: runs {@link crawlSite} in a SEPARATE PROCESS that holds no secrets.
 *
 * Why this exists (issue #831). Everything else in this repo's supply-chain hardening reduces the
 * PROBABILITY of a compromised dependency getting in — a release cooldown, install scripts denied by
 * default, signature verification, a fail-closed audit gate. None of it reduces the IMPACT once one
 * is in. And the importer is the worst place for that: it exists to fetch arbitrary URLs, so it has
 * open egress by design, and in-process it sat alongside the database handle, `SW_ENCRYPTION_KEY`,
 * and every decrypted deploy-target and SMTP secret. A dependency compromised anywhere in that
 * process could read them and post them out through the very capability the feature provides.
 *
 * Splitting it out does not stop the fetching — that IS the feature — it removes what is worth
 * stealing. This process gets an ALLOWLISTED environment (see `worker-crawl.ts`), no database
 * connection, and no shared memory with the API. Its whole authority is "make HTTP requests and
 * print the result".
 *
 * Protocol: one JSON job on stdin; NDJSON on stdout — `{"progress":…}` lines while crawling, then a
 * final `{"ok":true,"result":…}` or `{"ok":false,"error":…}`. Binary asset bodies are base64 on the
 * way out, because the boundary is a pipe.
 */
import { crawlSite, type CrawlOptions, type CrawlResult } from './crawl.js';
import { pinnedFetch } from './pinned-fetch.js';
import { renderViaBrowser } from './render.js';
import { targetsPrivateHost } from '@sitewright/schema';

/** The job the parent sends. Deliberately small and inert — no callbacks, no handles, no secrets. */
export interface FetchWorkerJob {
  seedUrl: string;
  options: CrawlOptions;
  /** Per-request cap, passed through to the pinned fetcher. */
  maxBytes: number;
  /** Per-request timeout, likewise. */
  timeoutMs: number;
  /** Whether the headless render is permitted (the parent decides; the worker never assumes). */
  allowRender: boolean;
}

/** What comes back. `bytes` fields are base64 — see the module comment. */
export interface FetchWorkerResult {
  result: CrawlResult;
}

/** Recursively base64 every Uint8Array so the result survives a pipe. Exported for the
 *  round-trip test — `assets` is a Map of binary bodies, so a bug here loses every imported asset. */
export function encodeBinary(value: unknown): unknown {
  if (value instanceof Uint8Array) return { __b64: Buffer.from(value).toString('base64') };
  if (Array.isArray(value)) return value.map(encodeBinary);
  if (value instanceof Map) return { __map: [...value].map(([k, v]) => [k, encodeBinary(v)]) };
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = encodeBinary(v);
    return out;
  }
  return value;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

/* v8 ignore start */ // Process entry: only runs when SPAWNED, so no unit test can reach it. Verified
// end-to-end instead — piping a real job in and crawling a live URL out-of-process — and the parent
// half (worker-crawl.ts), which owns every failure mode, is unit-tested against a fake child.
async function main(): Promise<void> {
  const job = JSON.parse(await readStdin()) as FetchWorkerJob;

  // The worker builds its OWN deps. Nothing callable is sent across the boundary, so the parent
  // cannot accidentally hand the child a closure that captures a secret.
  const result = await crawlSite(job.seedUrl, job.options, {
    // Mirrors `makeFetcher` in import-routes.ts: pinnedFetch is the binding SSRF guard, and `url` is
    // the REQUESTED url (links resolve against it — see FetchedResource).
    fetchResource: async (url) => {
      const r = await pinnedFetch(url, { timeoutMs: job.timeoutMs, maxBytes: job.maxBytes });
      return r ? { url, status: r.status, contentType: r.contentType, bytes: r.bytes } : null;
    },
    isAllowed: async (url) => !targetsPrivateHost(url),
    ...(job.allowRender ? { render: renderViaBrowser } : {}),
    onProgress: (e) => process.stdout.write(`${JSON.stringify({ progress: e })}\n`),
  });

  process.stdout.write(`${JSON.stringify({ ok: true, result: encodeBinary(result) })}\n`);
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    // Only the message crosses back. A stack could name paths the parent has no reason to surface,
    // and this string can reach an authoring UI.
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) })}\n`,
    );
    process.exit(1);
  },
);
/* v8 ignore stop */
