import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, stat, chmod, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import JSZip from 'jszip';
import { open as openZip, type Entry } from 'yauzl';
import { writeZipFile } from '../src/export/zip-writer.js';

/**
 * The archive writer behind the project export and the site zip. It replaced JSZip's JavaScript deflate
 * (on the event loop) with Node's zlib (on the thread pool), so it must stay readable by everything the
 * JSZip archives were: our own importer (yauzl), JSZip, and streaming readers that refuse a STORED entry
 * with a data descriptor (Java's ZipInputStream) — hence every entry is DEFLATE.
 */

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});
async function tempDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'sw-zipw-'));
  dirs.push(d);
  return d;
}

interface ReadEntry {
  name: string;
  data: Buffer;
  method: number;
  mode: number;
}
function readAll(path: string): Promise<ReadEntry[]> {
  return new Promise((resolve, reject) => {
    openZip(path, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err);
      const out: ReadEntry[] = [];
      zip.on('entry', (entry: Entry) => {
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return reject(e);
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('end', () => {
            out.push({ name: entry.fileName, data: Buffer.concat(chunks), method: entry.compressionMethod, mode: (entry.externalFileAttributes >>> 16) & 0o777 });
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => resolve(out));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

describe('writeZipFile', () => {
  it('★ round-trips files and in-memory entries, every one DEFLATE and world-readable', async () => {
    const dir = await tempDir();
    const photo = join(dir, 'photo.jpg');
    const text = join(dir, 'page.html');
    const photoBytes = randomBytes(300_000);
    await writeFile(photo, photoBytes);
    await writeFile(text, '<p>hello</p>'.repeat(1000));
    // A stored media file is private on disk; the archive must not carry that mode onto a web server.
    await chmod(photo, 0o600);

    const out = join(dir, 'out.zip');
    const bytes = await writeZipFile(
      [
        { name: 'manifest.json', data: '{"a":1}' },
        { name: 'media/x/photo.jpg', path: photo },
        { name: 'index.html', path: text },
      ],
      out,
      10_000_000,
      () => new Error('too large'),
    );
    expect(bytes).toBe((await stat(out)).size);

    const entries = await readAll(out);
    expect(entries.map((e) => e.name)).toEqual(['manifest.json', 'media/x/photo.jpg', 'index.html']);
    expect(entries[0]!.data.toString()).toBe('{"a":1}');
    expect(entries[1]!.data.equals(photoBytes)).toBe(true);
    expect(entries[2]!.data.toString()).toBe('<p>hello</p>'.repeat(1000));
    expect(entries.every((e) => e.method === 8)).toBe(true); // DEFLATE — never STORED
    expect(entries.every((e) => e.mode === 0o644)).toBe(true);
  });

  it('is readable by JSZip, as the archives it replaced were', async () => {
    const dir = await tempDir();
    const file = join(dir, 'a.css');
    await writeFile(file, 'body{margin:0}');
    const out = join(dir, 'out.zip');
    await writeZipFile([{ name: 'styles/a.css', path: file }, { name: 'b.txt', data: Buffer.from('bee') }], out, 1_000_000, () => new Error('x'));
    const zip = await JSZip.loadAsync(await (await import('node:fs/promises')).readFile(out));
    expect(await zip.file('styles/a.css')!.async('string')).toBe('body{margin:0}');
    expect(await zip.file('b.txt')!.async('string')).toBe('bee');
  });

  it('★ aborts with the caller’s error the moment the archive would pass the cap', async () => {
    const dir = await tempDir();
    const big = join(dir, 'big.bin');
    await writeFile(big, randomBytes(2_000_000)); // incompressible
    class TooBig extends Error {}
    await expect(writeZipFile([{ name: 'big.bin', path: big }], join(dir, 'out.zip'), 500_000, () => new TooBig('cap'))).rejects.toBeInstanceOf(TooBig);
  });

  it('★ leaks no file descriptor when the cap aborts mid-archive, or an entry name is refused', async () => {
    // yazl has no abort: torn down mid-entry, it left that entry's file open for good — one descriptor
    // per over-size export, measured, until the process ran out.
    const fds = async (): Promise<number> => (await readdir('/proc/self/fd')).length;
    const dir = await tempDir();
    const big = join(dir, 'big.bin');
    await writeFile(big, randomBytes(8_000_000));
    const before = await fds();
    for (let i = 0; i < 5; i++) {
      await expect(writeZipFile([{ name: 'a.bin', path: big }, { name: 'b.bin', path: big }], join(dir, `cap${i}.zip`), 200_000, () => new Error('cap'))).rejects.toThrow('cap');
      await expect(writeZipFile([{ name: '../escape.txt', path: big }], join(dir, `bad${i}.zip`), 1e9, () => new Error('cap'))).rejects.toThrow();
    }
    await new Promise((r) => setTimeout(r, 100)); // let destroyed streams close
    expect(await fds()).toBe(before);
  });

  it('rejects when an input file is missing — and nothing escapes as an unhandled rejection', async () => {
    const dir = await tempDir();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => void unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      await expect(writeZipFile([{ name: 'gone.jpg', path: join(dir, 'nope.jpg') }], join(dir, 'out.zip'), 1_000_000, () => new Error('x'))).rejects.toThrow(/ENOENT/);
      await new Promise((r) => setTimeout(r, 50));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
