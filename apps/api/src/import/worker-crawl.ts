/**
 * Runs the crawler in a separate process with an ALLOWLISTED environment (issue #831).
 *
 * The security property is entirely in `workerEnv()` below: the child inherits nothing it was not
 * explicitly given, so `SW_ENCRYPTION_KEY`, `DATABASE_URL`, `COOKIE_SECRET`, `SW_ADMIN_PASSWORD`,
 * AI keys and everything else simply are not present in its `process.env`. It also has no database
 * handle and no shared memory with the API — its entire authority is "make HTTP requests, print
 * JSON".
 *
 * A DENY-list was the obvious alternative and is the wrong shape: it fails open. Every new secret
 * anyone adds to the API is automatically visible to the crawler until someone remembers to add it
 * to the list, and nothing fails when they forget. An allowlist fails the other way — a genuinely
 * needed variable is missing, the crawl breaks loudly, and someone adds it deliberately.
 */
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { CrawlOptions, CrawlResult, CrawlDeps } from './crawl.js';
import type { FetchWorkerJob } from './fetch-worker.js';

type Spawn = (cmd: string, args: string[], opts: SpawnOptions) => ChildProcess;

/**
 * The ONLY variables the child receives.
 *
 * `PLAYWRIGHT_BROWSERS_PATH` is the one non-obvious entry: the headless render needs to find the
 * browser, and it is the sole `process.env` read anywhere under `src/import` or `src/render`.
 * The rest is what any Node process needs to run and to resolve TLS/proxies.
 */
const ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'TMPDIR',
  'TEMP',
  'TMP',
  'LANG',
  'LC_ALL',
  'TZ',
  'NODE_ENV',
  'PLAYWRIGHT_BROWSERS_PATH',
  // TLS + proxy, so an operator behind a corporate proxy or a custom CA still gets a working crawl.
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
] as const;

/** Build the child's environment: allowlist only. Exported so a test can assert what leaks. */
export function workerEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ENV_ALLOWLIST) {
    const v = source[key];
    if (v !== undefined) env[key] = v;
  }
  return env;
}

/** Undo the worker's base64 encoding of binary bodies (see fetch-worker.ts). Exported for the
 *  round-trip test. */
export function decodeBinary(value: unknown): unknown {
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    if (typeof rec.__b64 === 'string') return new Uint8Array(Buffer.from(rec.__b64, 'base64'));
    if (Array.isArray(rec.__map)) {
      return new Map((rec.__map as [unknown, unknown][]).map(([k, v]) => [k, decodeBinary(v)]));
    }
    if (Array.isArray(value)) return value.map(decodeBinary);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) out[k] = decodeBinary(v);
    return out;
  }
  return value;
}

export interface WorkerCrawlOptions {
  /** Kill the worker after this long. */
  timeoutMs?: number;
  /** Cap the worker's buffered stdout, so a hostile or runaway crawl cannot exhaust the API's memory. */
  maxOutputBytes?: number;
  /** Per-resource fetch bounds, passed through to the worker's pinned fetcher. */
  fetchTimeoutMs: number;
  maxResourceBytes: number;
  /** Injectable spawner for tests. */
  spawn?: Spawn;
  /** Override the worker entry (tests). */
  workerPath?: string;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_MAX_OUTPUT = 512 * 1024 * 1024;

/**
 * Drop-in replacement for `crawlSite` that runs it out-of-process.
 *
 * Signature-compatible on purpose: `import-routes.ts` injects it through the existing `deps.crawl`
 * seam, so nothing downstream knows the difference. `deps.fetchResource` / `isAllowed` / `render`
 * are deliberately IGNORED — the whole point is that the child builds its own, so no closure from
 * the API process (and nothing it captured) can cross the boundary.
 */
export function makeWorkerCrawl(opts: WorkerCrawlOptions) {
  const spawn = opts.spawn ?? (nodeSpawn as Spawn);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
  const workerPath = opts.workerPath ?? fileURLToPath(new URL('./fetch-worker.js', import.meta.url));

  return function workerCrawl(seedUrl: string, options: CrawlOptions, deps: CrawlDeps): Promise<CrawlResult> {
    const job: FetchWorkerJob = {
      seedUrl,
      options,
      maxBytes: opts.maxResourceBytes,
      timeoutMs: opts.fetchTimeoutMs,
      // The parent decides whether rendering is allowed; `render` being absent from deps is how the
      // route says "no browser for this import".
      allowRender: typeof deps.render === 'function',
    };

    return new Promise<CrawlResult>((resolve, reject) => {
      const child = spawn(process.execPath, [workerPath], {
        env: workerEnv(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let out = '';
      let err = '';
      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        finish(() => reject(new Error('the import worker timed out')));
      }, timeoutMs);

      const onAbort = (): void => {
        child.kill('SIGKILL');
        finish(() => reject(new Error('import aborted')));
      };
      deps.signal?.addEventListener('abort', onAbort, { once: true });

      child.stdout?.on('data', (chunk: Buffer) => {
        out += chunk.toString('utf8');
        if (out.length > maxOutputBytes) {
          child.kill('SIGKILL');
          finish(() => reject(new Error('the import worker produced too much output')));
          return;
        }
        // Progress lines stream; the final line is the result. Emit progress as it arrives so the
        // authoring UI keeps moving instead of sitting silent for the whole crawl.
        const lines = out.split('\n');
        out = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line) as { progress?: { fetched: number; queued: number; url: string } };
            if (msg.progress) deps.onProgress?.(msg.progress);
            else pending.push(msg);
          } catch {
            // A non-JSON line means the worker wrote something unexpected; keep it for the error path.
            err += `${line}\n`;
          }
        }
      });
      const pending: unknown[] = [];

      child.stderr?.on('data', (c: Buffer) => {
        err += c.toString('utf8');
        if (err.length > 64 * 1024) err = err.slice(-64 * 1024);
      });

      child.on('error', (e) => finish(() => reject(e)));

      child.on('close', (code) => {
        deps.signal?.removeEventListener('abort', onAbort);
        finish(() => {
          const last = pending.at(-1) as { ok?: boolean; result?: unknown; error?: string } | undefined;
          if (last?.ok === true && last.result) {
            resolve(decodeBinary(last.result) as CrawlResult);
            return;
          }
          // `?? ` is not enough here: an empty stderr yields '' from split(), which is falsy-but-
          // defined, so the exit-code fallback never fired and the message was literally
          // "import worker failed: ". That is the LEAST helpful message on the most confusing
          // failure — a worker that died saying nothing.
          const stderrTail = err.trim().split('\n').at(-1)?.trim();
          const why = last?.error || stderrTail || `exited with code ${code}`;
          reject(new Error(`import worker failed: ${why}`));
        });
      });

      child.stdin?.end(JSON.stringify(job));
    });
  };
}
