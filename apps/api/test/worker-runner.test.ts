import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectBundle } from '@sitewright/core';
import { WorkerBuildRunner } from '../src/publish/worker-runner.js';
import { PublishError } from '../src/publish/build.js';
import type { WorkerResult } from '../src/publish/build-worker.js';

let outDir: string;
beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'sw-wr-'));
});
afterEach(async () => {
  await rm(outDir, { recursive: true, force: true });
});

const bundle = {
  project: { formatVersion: 2 as const, id: 'p', name: 'P', slug: 'p', identity: { name: 'P', colors: {} }, settings: { defaultLocale: 'en', locales: ['en'] } },
  pages: [],
  datasets: [],
  entries: [],
} as unknown as ProjectBundle;

interface FakeOpts {
  result?: WorkerResult;
  rawStdout?: string;
  bigStdout?: number;
  exitCode?: number;
  stderr?: string;
  hang?: boolean;
}

/** A fake `spawn` capturing args/stdin and emitting a canned worker result. */
function fakeSpawn(opts: FakeOpts, capture: { args?: string[]; stdin?: string }) {
  return (_cmd: string, args: string[]) => {
    capture.args = args;
    const child = new EventEmitter() as unknown as {
      stdout: EventEmitter;
      stderr: EventEmitter;
      stdin: { end: (s: string) => void; on: () => void };
      kill: () => void;
      on: EventEmitter['on'];
      emit: EventEmitter['emit'];
    };
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    child.stdout = stdout;
    child.stderr = stderr;
    child.kill = () => {};
    child.stdin = {
      on: () => {},
      end: (s: string) => {
        capture.stdin = s;
        if (opts.hang) return;
        queueMicrotask(() => {
          if (opts.stderr) stderr.emit('data', Buffer.from(opts.stderr));
          if (opts.bigStdout) stdout.emit('data', Buffer.alloc(opts.bigStdout));
          else if (opts.rawStdout !== undefined) stdout.emit('data', Buffer.from(opts.rawStdout));
          else if (opts.result) stdout.emit('data', Buffer.from(JSON.stringify(opts.result)));
          (child as unknown as EventEmitter).emit('close', opts.exitCode ?? 0);
        });
      },
    };
    return child as never;
  };
}

describe('WorkerBuildRunner', () => {
  it('spawns an isolated container, inlines media, and writes the returned artifact', async () => {
    const capture: { args?: string[]; stdin?: string } = {};
    const result: WorkerResult = {
      manifest: { publishedAt: '2026-05-30T00:00:00.000Z', routes: 1, bytes: 42 },
      files: { 'index.html': Buffer.from('<h1>Hi</h1>').toString('base64'), 'media/a1/a1.jpg': Buffer.from('img').toString('base64') },
    };
    const runner = new WorkerBuildRunner({ image: 'sitewright-api', spawnImpl: fakeSpawn({ result }, capture) });

    const asset = { kind: 'image' as const, folder: '', id: 'a1', filename: 'h.png', format: 'image/png', bytes: 1, width: 10, height: 10, variants: [], fallback: 'a1.jpg', url: '/media/p/a1/a1.jpg' };
    const manifest = await runner.run({
      outDir,
      bundle,
      publishedAt: '2026-05-30T00:00:00.000Z',
      media: [asset],
      readMedia: async () => Buffer.from('img'),
    });

    expect(manifest.routes).toBe(1);
    // Isolation flags + worker command.
    expect(capture.args).toEqual(expect.arrayContaining(['run', '--rm', '-i', '--network', 'none', '--security-opt', 'no-new-privileges', 'sitewright-api']));
    expect(capture.args?.slice(-2)).toEqual(['node', 'dist/publish/build-worker.js']);
    // Media inlined into the job stdin.
    const job = JSON.parse(capture.stdin ?? '{}') as { media: Array<{ files: Record<string, string> }> };
    expect(job.media[0]?.files['a1.jpg']).toBe(Buffer.from('img').toString('base64'));
    // Artifact written to outDir.
    expect(await readFile(join(outDir, 'index.html'), 'utf8')).toBe('<h1>Hi</h1>');
    expect(await readFile(join(outDir, 'media', 'a1', 'a1.jpg'), 'utf8')).toBe('img');
  });

  it('rejects when the worker exits non-zero', async () => {
    const runner = new WorkerBuildRunner({ image: 'x', spawnImpl: fakeSpawn({ exitCode: 1, stderr: 'boom' }, {}) });
    await expect(runner.run({ outDir, bundle, publishedAt: 't', media: [] })).rejects.toThrow(/exited 1/);
  });

  it('kills and rejects on timeout', async () => {
    const runner = new WorkerBuildRunner({ image: 'x', timeoutMs: 30, spawnImpl: fakeSpawn({ hang: true }, {}) });
    await expect(runner.run({ outDir, bundle, publishedAt: 't', media: [] })).rejects.toThrow(/timed out/);
  });

  it('rejects malformed worker output', async () => {
    const capture: { args?: string[]; stdin?: string } = {};
    // result undefined → no stdout data → empty string → JSON.parse throws.
    const runner = new WorkerBuildRunner({ image: 'x', spawnImpl: fakeSpawn({}, capture) });
    await expect(runner.run({ outDir, bundle, publishedAt: 't', media: [] })).rejects.toThrow(/malformed/);
  });

  it('tolerates a missing variant and skips media inlining when no reader is given', async () => {
    const capture: { args?: string[]; stdin?: string } = {};
    const result: WorkerResult = { manifest: { publishedAt: 't', routes: 0, bytes: 0 }, files: {} };
    const asset = { kind: 'image' as const, folder: '', id: 'a1', filename: 'h.png', format: 'image/png', bytes: 1, width: 10, height: 10, variants: [{ format: 'webp' as const, width: 10, height: 10, path: 'a1.webp' }], fallback: 'a1.jpg', url: '/media/p/a1/a1.jpg' };

    // No readMedia → files object is empty (break path).
    const noReader = new WorkerBuildRunner({ image: 'x', spawnImpl: fakeSpawn({ result }, capture) });
    await noReader.run({ outDir, bundle, publishedAt: 't', media: [asset] });
    expect((JSON.parse(capture.stdin ?? '{}') as { media: Array<{ files: Record<string, string> }> }).media[0]?.files).toEqual({});

    // readMedia throws for one file → that file skipped, the other inlined.
    const partial = new WorkerBuildRunner({
      image: 'x',
      spawnImpl: fakeSpawn({ result }, capture),
    });
    await partial.run({
      outDir,
      bundle,
      publishedAt: 't',
      media: [asset],
      readMedia: async (_id, file) => {
        if (file === 'a1.webp') throw new Error('missing');
        return Buffer.from('jpg');
      },
    });
    const files = (JSON.parse(capture.stdin ?? '{}') as { media: Array<{ files: Record<string, string> }> }).media[0]?.files;
    expect(files?.['a1.jpg']).toBe(Buffer.from('jpg').toString('base64'));
    expect(files?.['a1.webp']).toBeUndefined();
  });

  it('rejects artifact paths that escape the output directory', async () => {
    for (const bad of ['../escape.html', '/etc/passwd', 'a/../../escape.html']) {
      const result: WorkerResult = { manifest: { publishedAt: 't', routes: 0, bytes: 0 }, files: { [bad]: Buffer.from('x').toString('base64') } };
      const runner = new WorkerBuildRunner({ image: 'x', spawnImpl: fakeSpawn({ result }, {}) });
      await expect(runner.run({ outDir, bundle, publishedAt: 't', media: [] })).rejects.toThrow(/escapes/);
    }
  });

  it('maps the worker’s publish-error exit code to a PublishError (→ 409)', async () => {
    const runner = new WorkerBuildRunner({ image: 'x', spawnImpl: fakeSpawn({ exitCode: 3, stderr: 'Duplicate route "/dup"' }, {}) });
    await expect(runner.run({ outDir, bundle, publishedAt: 't', media: [] })).rejects.toBeInstanceOf(PublishError);
  });

  it('kills and rejects when the worker output exceeds the size cap', async () => {
    const runner = new WorkerBuildRunner({ image: 'x', maxOutputBytes: 1024, spawnImpl: fakeSpawn({ bigStdout: 4096 }, {}) });
    await expect(runner.run({ outDir, bundle, publishedAt: 't', media: [] })).rejects.toThrow(/output exceeded/);
  });

  it('rejects well-formed JSON that is not a valid WorkerResult', async () => {
    const runner = new WorkerBuildRunner({ image: 'x', spawnImpl: fakeSpawn({ rawStdout: '{"manifest":{},"files":{}}' }, {}) });
    await expect(runner.run({ outDir, bundle, publishedAt: 't', media: [] })).rejects.toThrow(/malformed/);
  });
});
