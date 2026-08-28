import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PreviewStore } from '../src/http/preview-store.js';

const scope = { projectId: 'p', userId: 'u' };

// Every store here starts a sweep timer unless told otherwise; close them so no test leaves one behind.
const open: PreviewStore[] = [];
const make = (opts: ConstructorParameters<typeof PreviewStore>[0] = {}): PreviewStore => {
  const s = new PreviewStore({ sweepIntervalMs: 0, ...opts });
  open.push(s);
  return s;
};
afterEach(() => {
  for (const s of open.splice(0)) s.close();
});

describe('PreviewStore', () => {
  it('round-trips html for a valid, scope-matching token', async () => {
    const store = make();
    const token = await store.put('<h1>hi</h1>', scope);
    expect(await store.get(token, scope)).toBe('<h1>hi</h1>');
  });

  it('returns null for an unknown token', async () => {
    expect(await make().get('nope', scope)).toBeNull();
  });

  it('rejects a token used from a different project/user', async () => {
    const store = make();
    const token = await store.put('x', scope);
    expect(await store.get(token, { ...scope, projectId: 'other' })).toBeNull();
    expect(await store.get(token, { ...scope, userId: 'other' })).toBeNull();
  });

  it('expires tokens after the TTL', async () => {
    let t = 1000;
    const store = make({ ttlMs: 100, now: () => t });
    const token = await store.put('x', scope);
    t = 1099;
    expect(await store.get(token, scope)).toBe('x'); // still valid
    t = 1101;
    expect(await store.get(token, scope)).toBeNull(); // expired
  });

  it('evicts the oldest tokens beyond the cap', async () => {
    const store = make({ maxEntries: 2 });
    const a = await store.put('a', scope);
    const b = await store.put('b', scope);
    const c = await store.put('c', scope); // pushes out `a`
    expect(await store.get(a, scope)).toBeNull();
    expect(await store.get(b, scope)).toBe('b');
    expect(await store.get(c, scope)).toBe('c');
  });

  it('issues distinct, opaque tokens', async () => {
    const store = make();
    expect(await store.put('x', scope)).not.toBe(await store.put('x', scope));
  });
});

describe('PreviewStore — byte budget', () => {
  it('evicts on BYTES, not just entry count', async () => {
    // Well under maxEntries, so only the byte cap can be what evicts. This is the guard that
    // matters: a document is anywhere from a few KB to several MB, so a count bounds nothing.
    const doc = 'x'.repeat(1000);
    const store = make({ maxEntries: 100, maxBytes: 2500 });
    const a = await store.put(doc, scope);
    const b = await store.put(doc, scope);
    const c = await store.put(doc, scope); // 3000 > 2500 → oldest goes
    expect(store.size).toBe(2);
    expect(await store.get(a, scope)).toBeNull(); // the oldest, not the newest
    expect(await store.get(b, scope)).toBe(doc);
    expect(await store.get(c, scope)).toBe(doc);
  });

  it('keeps the byte ledger exact across eviction and expiry', async () => {
    let t = 0;
    const store = make({ maxEntries: 2, ttlMs: 100, now: () => t });
    await store.put('a'.repeat(10), scope);
    await store.put('b'.repeat(10), scope);
    expect(store.retainedBytes).toBe(20);
    await store.put('c'.repeat(10), scope); // evicts one
    expect(store.retainedBytes).toBe(20);
    t = 500;
    await store.sweep(); // everything expired
    expect(store.size).toBe(0);
    expect(store.retainedBytes).toBe(0);
  });

  it('counts UTF-8 bytes, not characters', async () => {
    const store = make();
    await store.put('€', scope); // 3 bytes, 1 char
    expect(store.retainedBytes).toBe(3);
  });

  it('holds a single oversized document rather than evicting it to nothing', async () => {
    // Eviction stops when the map is empty: a document larger than the whole budget still has to be
    // served, and dropping it would make the preview 404 immediately after minting the token.
    const store = make({ maxBytes: 10 });
    const token = await store.put('x'.repeat(50), scope);
    expect(await store.get(token, scope)).toBe('x'.repeat(50));
  });
});

describe('PreviewStore — concurrent writers', () => {
  it('never hands back a token that eviction already removed', async () => {
    // put() awaits (the spill write), so concurrent calls interleave their entries.set(). The old
    // "newest is last in insertion order" assumption held only while put() was synchronous; this
    // pins the guarantee that actually matters — a returned token is always live.
    const doc = 'x'.repeat(1000);
    const store = make({ maxBytes: 1500, maxEntries: 100 });
    const tokens = await Promise.all(Array.from({ length: 8 }, () => store.put(doc, scope)));
    // The last writer to finish must still be readable; over budget, everything older may be gone.
    const last = tokens[tokens.length - 1]!;
    expect(await store.get(last, scope)).toBe(doc);
    expect(store.size).toBeGreaterThanOrEqual(1);
  });

  it('keeps the byte ledger exact under concurrent puts', async () => {
    const store = make({ maxEntries: 100, maxBytes: 10 * 1024 * 1024 });
    await Promise.all(Array.from({ length: 20 }, () => store.put('y'.repeat(500), scope)));
    expect(store.size).toBe(20);
    expect(store.retainedBytes).toBe(20 * 500); // no double-count, no lost subtraction
  });
});

describe('PreviewStore — timed sweep', () => {
  it('releases expired entries with no write to trigger it', async () => {
    // The bug this closes: sweep ran ONLY from put(), so an instance that stopped rendering held
    // every document until something else happened to render.
    let t = 0;
    const store = new PreviewStore({ ttlMs: 50, sweepIntervalMs: 10, now: () => t });
    open.push(store);
    await store.put('x'.repeat(100), scope);
    expect(store.size).toBe(1);
    t = 1000; // past the TTL, and NOTHING is written from here on
    await new Promise((r) => setTimeout(r, 40));
    expect(store.size).toBe(0);
    expect(store.retainedBytes).toBe(0);
  });

  it('does not keep the process alive (timer is unref\'d) and stops on close()', async () => {
    const store = new PreviewStore({ sweepIntervalMs: 10 });
    // @ts-expect-error -- reaching into the private handle is the only way to assert unref
    expect(store.sweepTimer?.hasRef?.()).toBe(false);
    store.close();
  });
});

describe('PreviewStore — spill to disk', () => {
  let dir: string;
  const spilled = async (): Promise<string[]> => (await readdir(dir)).filter((f) => f.endsWith('.html'));

  it('keeps documents on disk and still round-trips them', async () => {
    dir = await mkdtemp(join(tmpdir(), 'sw-spill-'));
    try {
      const store = make({ spillDir: dir });
      const token = await store.put('<h1>on disk</h1>', scope);
      expect(await spilled()).toHaveLength(1);
      expect(await store.get(token, scope)).toBe('<h1>on disk</h1>');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('deletes the file when the entry is evicted or expires', async () => {
    dir = await mkdtemp(join(tmpdir(), 'sw-spill-'));
    try {
      let t = 0;
      const store = make({ spillDir: dir, maxEntries: 1, ttlMs: 100, now: () => t });
      await store.put('first', scope);
      await store.put('second', scope); // evicts `first`
      expect(await spilled()).toHaveLength(1);
      t = 500;
      await store.sweep();
      expect(await spilled()).toHaveLength(0); // no orphaned files left behind
      expect(store.size).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('treats a vanished file as expired instead of erroring', async () => {
    dir = await mkdtemp(join(tmpdir(), 'sw-spill-'));
    try {
      const store = make({ spillDir: dir });
      const token = await store.put('gone soon', scope);
      await rm(dir, { recursive: true, force: true }); // data dir wiped underneath us
      expect(await store.get(token, scope)).toBeNull();
      expect(store.size).toBe(0); // and the dead entry is dropped, not left to leak
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('clears documents left by a previous process on first use', async () => {
    dir = await mkdtemp(join(tmpdir(), 'sw-spill-'));
    try {
      // Stand in for a restart: a file on disk whose token died with the old process's map.
      await writeFile(join(dir, 'stale-from-last-run.html'), '<p>orphan</p>', 'utf8');
      const store = make({ spillDir: dir });
      await store.put('fresh', scope);
      expect(await spilled()).toHaveLength(1); // only the new one — the orphan is gone
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reaps a file whose unlink failed and was forgotten', async () => {
    dir = await mkdtemp(join(tmpdir(), 'sw-spill-'));
    try {
      const store = make({ spillDir: dir });
      await store.put('doomed', scope);
      // Stand in for `drop` swallowing a failed unlink: the entry goes, the file stays. Nothing in
      // the store would ever retry that token, so only a reconcile can reclaim it.
      // @ts-expect-error -- reaching into the private map is the point of this test
      store.entries.clear();
      expect(await spilled()).toHaveLength(1);
      await store.maintain();
      expect(await spilled()).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reaps documents left by a previous process WITHOUT waiting for a put', async () => {
    dir = await mkdtemp(join(tmpdir(), 'sw-spill-'));
    try {
      // The gap this closes: clearing on first `put` meant an instance that restarted and was never
      // previewed again held the old generation of files forever.
      await writeFile(join(dir, 'from-the-last-run.html'), '<p>orphan</p>', 'utf8');
      const store = make({ spillDir: dir });
      await store.maintain(); // no put() anywhere
      expect(await spilled()).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('never reaps a live entry, and leaves foreign files alone', async () => {
    dir = await mkdtemp(join(tmpdir(), 'sw-spill-'));
    try {
      const store = make({ spillDir: dir });
      const token = await store.put('keep me', scope);
      await writeFile(join(dir, 'notes.txt'), 'not ours', 'utf8'); // only *.html is ours to delete
      await store.maintain();
      expect(await store.get(token, scope)).toBe('keep me');
      expect((await readdir(dir)).sort()).toEqual([`${token}.html`, 'notes.txt'].sort());
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('falls back to memory when the spill directory cannot be written', async () => {
    // A read-only mount must not break previews — the byte cap still bounds what memory can cost.
    // `/dev/null/...` gives a fast, deterministic ENOTDIR; a path under /proc HANGS in mkdir rather
    // than erroring, which is a property of that filesystem, not of this store.
    const store = make({ spillDir: '/dev/null/nope' });
    const token = await store.put('<p>fallback</p>', scope);
    expect(await store.get(token, scope)).toBe('<p>fallback</p>');
  });
});
