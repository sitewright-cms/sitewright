import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const roots: string[] = [];
afterAll(async () => {
  for (const r of roots) await rm(r, { recursive: true, force: true });
});

describe('PageWriter — page files written while the next pages render', () => {
  it('★ a second write to the same path lands LAST (a page that failed after writing ends as its error document)', async () => {
    const { PageWriter } = await import('../src/publish/page-writer.js');
    const dir = await mkdtemp(join(tmpdir(), 'sw-pw-'));
    roots.push(dir);
    const w = new PageWriter(4);
    const file = join(dir, 'index.html');
    await w.write(file, 'x'.repeat(2_000_000)); // a slow, big page…
    await w.write(file, 'ERROR DOCUMENT'); // …then its replacement
    await w.drain();
    expect(await readFile(file, 'utf8')).toBe('ERROR DOCUMENT');
  });

  it('never has more than `limit` writes in flight, and drain waits for all of them', async () => {
    vi.resetModules();
    let inFlight = 0;
    let peak = 0;
    let finished = 0;
    vi.doMock('node:fs/promises', async (orig) => ({
      ...(await orig<typeof import('node:fs/promises')>()),
      writeFile: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        finished += 1;
      },
    }));
    const { PageWriter } = await import('../src/publish/page-writer.js');
    const w = new PageWriter(3);
    for (let i = 0; i < 20; i++) await w.write(`/tmp/page-${i}.html`, 'x');
    await w.drain();
    expect(peak).toBe(3);
    expect(finished).toBe(20);
    vi.doUnmock('node:fs/promises');
    vi.resetModules();
  });

  it('drain throws the first failure, so a full disk still fails the build', async () => {
    const { PageWriter } = await import('../src/publish/page-writer.js');
    const w = new PageWriter(2);
    await w.write(join(tmpdir(), 'no-such-dir-sw-pw', 'a', 'index.html'), 'x');
    await expect(w.drain()).rejects.toMatchObject({ code: 'ENOENT' });
    // …and the next page's write says so at once, as an awaited write always did.
    await expect(w.write(join(tmpdir(), 'sw-pw-next.html'), 'y')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
