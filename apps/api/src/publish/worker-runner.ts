import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { MediaAsset } from '@sitewright/schema';
import type { BuildRunner, BuildJob } from './runner.js';
import { PublishError, type ReleaseManifest } from './build.js';
import type { WorkerJob, WorkerResult } from './build-worker.js';

type Spawn = (cmd: string, args: string[], opts: SpawnOptions) => ChildProcess;

// Exit code the worker uses for an author-correctable build error (→ HTTP 409).
const PUBLISH_ERROR_EXIT = 3;

/** Runtime shape check on the worker's output (the cast alone is not enough). */
function assertWorkerResult(r: WorkerResult): void {
  const m = r?.manifest as { routes?: unknown; bytes?: unknown } | undefined;
  const filesOk =
    r?.files !== null &&
    typeof r?.files === 'object' &&
    Object.values(r.files).every((v) => typeof v === 'string');
  if (!m || typeof m.routes !== 'number' || typeof m.bytes !== 'number' || !filesOk) {
    throw new Error('build worker returned malformed output');
  }
}

export interface WorkerRunnerOptions {
  /** Docker image to run the worker from (the API image — it has the build code). */
  image: string;
  dockerPath?: string;
  /** Container memory cap (docker `--memory`). */
  memory?: string;
  /** Container CPU cap (docker `--cpus`). */
  cpus?: string;
  /** Kill the worker after this long. */
  timeoutMs?: number;
  /** Reject jobs whose serialized payload exceeds this (bounds media inlining). */
  maxJobBytes?: number;
  /** Cap on the worker's buffered stdout (defaults to 2x job size + headroom). */
  maxOutputBytes?: number;
  /** Injectable spawner for tests. */
  spawnImpl?: Spawn;
}

/**
 * Runs each build inside a throwaway, isolated container (the API image):
 * `--network none`, memory/CPU caps, `no-new-privileges`, **no mounts and no
 * secrets in its env** (the parent's COOKIE_SECRET/SW_ENCRYPTION_KEY are passed
 * to the API at runtime, not baked into the image, so the worker never sees
 * them). The job (incl. media inlined as base64) goes in via stdin and the
 * artifact comes back via stdout — so even an RCE in a future untrusted build
 * step is contained: no network, no secrets, no shared filesystem.
 */
export class WorkerBuildRunner implements BuildRunner {
  constructor(private readonly opts: WorkerRunnerOptions) {}

  async run(job: BuildJob): Promise<ReleaseManifest> {
    const workerJob = await this.buildWorkerJob(job);
    const payload = JSON.stringify(workerJob);
    const maxBytes = this.opts.maxJobBytes ?? 64 * 1024 * 1024; // 64 MiB
    if (Buffer.byteLength(payload) > maxBytes) {
      throw new Error('build job exceeds the worker size limit');
    }

    // Hardened, throwaway worker: no network, capped CPU/memory/PIDs, all caps
    // dropped, read-only root with only a sized tmpfs for the build's scratch dir.
    const args = [
      'run',
      '--rm',
      '-i',
      '--network',
      'none',
      '--memory',
      this.opts.memory ?? '768m',
      '--cpus',
      this.opts.cpus ?? '1',
      '--pids-limit',
      '256',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--read-only',
      '--tmpfs',
      '/tmp:size=512m,mode=1777',
      this.opts.image,
      'node',
      'dist/publish/build-worker.js',
    ];

    const stdout = await this.spawnWorker(args, payload);
    let parsed: WorkerResult;
    try {
      parsed = JSON.parse(stdout) as WorkerResult;
    } catch {
      throw new Error('build worker returned malformed output');
    }
    assertWorkerResult(parsed);
    await this.writeArtifact(job.outDir, parsed.files);
    return parsed.manifest;
  }

  /** Inlines media binaries (base64) so the worker needs no filesystem access. */
  private async buildWorkerJob(job: BuildJob): Promise<WorkerJob> {
    const media = job.media ?? [];
    const out: Array<{ asset: MediaAsset; files: Record<string, string> }> = [];
    for (const asset of media) {
      const entries = new Map<string, string>();
      const names =
        asset.kind === 'image' ? [asset.fallback, ...asset.variants.map((v) => v.path)] : [asset.storedName];
      for (const name of names) {
        if (!job.readMedia) break;
        try {
          entries.set(name, (await job.readMedia(asset.id, name)).toString('base64'));
        } catch {
          // A missing variant is tolerable (the renderer/worker degrades gracefully).
        }
      }
      out.push({ asset, files: Object.fromEntries(entries) });
    }
    return { bundle: job.bundle, publishedAt: job.publishedAt, media: out, jsonData: job.jsonData, snippets: job.snippets };
  }

  private spawnWorker(args: string[], stdin: string): Promise<string> {
    const spawn: Spawn = this.opts.spawnImpl ?? nodeSpawn;
    const timeoutMs = this.opts.timeoutMs ?? 120_000;
    // Bound the buffered artifact so a rogue/buggy worker can't OOM the API.
    const maxOut = this.opts.maxOutputBytes ?? (this.opts.maxJobBytes ?? 64 * 1024 * 1024) * 2 + 16 * 1024 * 1024;
    return new Promise<string>((resolveP, rejectP) => {
      const child = spawn(this.opts.dockerPath ?? 'docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      let outBytes = 0;
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const timer = setTimeout(() => {
        finish(() => {
          child.kill('SIGKILL');
          rejectP(new Error('build worker timed out'));
        });
      }, timeoutMs);

      child.stdout?.on('data', (d: Buffer) => {
        outBytes += d.length;
        if (outBytes > maxOut) {
          finish(() => {
            child.kill('SIGKILL');
            rejectP(new Error('build worker output exceeded the size limit'));
          });
          return;
        }
        out.push(d);
      });
      child.stderr?.on('data', (d: Buffer) => err.push(d));
      child.on('error', (e: Error) => finish(() => rejectP(e)));
      // The timeout path SIGKILLs the child; this guard drops the resulting close.
      child.on('close', (code: number | null) =>
        finish(() => {
          const stderr = Buffer.concat(err).toString('utf8').slice(0, 300);
          if (code === 0) resolveP(Buffer.concat(out).toString('utf8'));
          else if (code === PUBLISH_ERROR_EXIT) rejectP(new PublishError(stderr || 'invalid project'));
          else rejectP(new Error(`build worker exited ${code}: ${stderr}`));
        }),
      );
      child.stdin?.on('error', () => {
        /* worker may exit before consuming stdin — ignore EPIPE */
      });
      child.stdin?.end(stdin);
    });
  }

  /** Writes the returned files into outDir via a temp dir + atomic rename (path-safe). */
  private async writeArtifact(outDir: string, files: Record<string, string>): Promise<void> {
    const base = resolve(outDir);
    const tmp = `${base}.tmp`;
    await rm(tmp, { recursive: true, force: true });
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- tmp derives from a validated dir
    await mkdir(tmp, { recursive: true });
    try {
      for (const [rel, b64] of Object.entries(files)) {
        const full = resolve(tmp, rel);
        if (full !== tmp && !full.startsWith(tmp + sep)) {
          throw new Error('artifact path escapes the output directory');
        }
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined to tmp (checked above)
        await mkdir(dirname(full), { recursive: true });
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined to tmp (checked above)
        await writeFile(full, Buffer.from(b64, 'base64'));
      }
      await rm(base, { recursive: true, force: true });
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- both are resolved, validated dirs
      await rename(tmp, base);
    } catch (err) {
      await rm(tmp, { recursive: true, force: true });
      throw err;
    }
  }
}
