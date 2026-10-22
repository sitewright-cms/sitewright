import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StatsEngine, type StatsHit, type StatsLimits } from '../src/analytics/engine.js';
import type { GeoLookup } from '../src/analytics/geo.js';
import { StatsStore } from '../src/analytics/store.js';
import { statsProjectKey } from '../src/analytics/token.js';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const GPTBOT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)';

/** A country per address prefix — the real database is tested on its own. */
const geo: GeoLookup = { country: (ip) => (ip.startsWith('1.') ? 'DE' : ip.startsWith('2.') ? 'US' : null) };

const P = 'proj1';
const hit = (over: Partial<StatsHit> = {}): StatsHit => ({ projectId: P, route: '/', ua: CHROME, ip: '1.1.1.1', ...over });

describe('the statistics engine', () => {
  let now: Date;
  let store: StatsStore;
  let engine: StatsEngine;
  const open = async (s: StatsStore = store, limits?: Partial<StatsLimits>) => StatsEngine.open({ store: s, geo, now: () => now, limits });
  const today = () => now.toISOString().slice(0, 10);
  const q = (over: Record<string, string> = {}) => ({ from: today(), to: today(), ...over });

  beforeEach(async () => {
    now = new Date('2026-10-19T10:00:00Z');
    store = await StatsStore.open(':memory:');
    engine = await open();
  });
  afterEach(async () => {
    await engine.close().catch(() => {});
  });

  it('counts a human pageview with its device and country', async () => {
    engine.record(hit());
    const s = await engine.query(P, q(), true);
    expect(s.human).toEqual({ views: 1, visitors: 1 });
    expect(s.botViews).toBe(0);
    expect(s.devices).toEqual([
      { device: 'desktop', views: 1, visitors: 1 },
      { device: 'mobile', views: 0, visitors: 0 },
      { device: 'tablet', views: 0, visitors: 0 },
    ]);
    expect(s.countries).toEqual([{ country: 'DE', views: 1, visitors: 1 }]);
    expect(s.pages).toEqual([{ path: '/', views: 1, botViews: 0 }]);
    expect(s.enabled).toBe(true);
  });

  it('★ counts a visitor ONCE a day, however many pages they view', async () => {
    engine.record(hit());
    engine.record(hit({ route: '/about/' }));
    engine.record(hit({ route: '/about/' }));
    const s = await engine.query(P, q(), true);
    expect(s.human).toEqual({ views: 3, visitors: 1 });
    expect(s.pages).toEqual([
      { path: '/about/', views: 2, botViews: 0 },
      { path: '/', views: 1, botViews: 0 },
    ]);
  });

  it('tells visitors apart by address and by browser', async () => {
    engine.record(hit());
    engine.record(hit({ ip: '1.1.1.2' }));
    engine.record(hit({ ua: FIREFOX }));
    expect((await engine.query(P, q(), true)).human).toEqual({ views: 3, visitors: 3 });
  });

  it('keeps visitors of different sites apart', async () => {
    engine.record(hit());
    engine.record(hit({ projectId: 'proj2' }));
    expect((await engine.query(P, q(), true)).human.visitors).toBe(1);
    expect((await engine.query('proj2', q(), true)).human.visitors).toBe(1);
  });

  it('★ counts the same visitor again the next day (the daily salt rotates)', async () => {
    engine.record(hit());
    now = new Date('2026-10-20T09:00:00Z');
    engine.record(hit());
    const s = await engine.query(P, { from: '2026-10-19', to: '2026-10-20' }, true);
    expect(s.human).toEqual({ views: 2, visitors: 2 });
    expect(s.daily).toEqual([
      { day: '2026-10-19', views: 1, visitors: 1, botViews: 0 },
      { day: '2026-10-20', views: 1, visitors: 1, botViews: 0 },
    ]);
  });

  it('counts bots as views by kind, with no visitors, device or source', async () => {
    engine.record(hit({ ua: GOOGLEBOT, referrerHost: 'google.com' }));
    engine.record(hit({ ua: GPTBOT, route: '/about/' }));
    engine.record(hit({ ua: CHROME, webdriver: true }));
    const s = await engine.query(P, q(), true);
    expect(s.human).toEqual({ views: 0, visitors: 0 });
    expect(s.botViews).toBe(3);
    expect(s.bots.map((b) => [b.class, b.views]).sort()).toEqual([['ai', 1], ['bot', 1], ['search', 1]]);
    expect(s.pages).toEqual(expect.arrayContaining([{ path: '/about/', views: 0, botViews: 1 }]));
    expect(s.sources).toEqual([]);
    expect(s.devices.every((d) => d.views === 0)).toBe(true);
  });

  it('★ counts a SERVED page only for a bot — humans are the tracker’s to count', async () => {
    engine.recordServedPage(P, '/', CHROME, '1.1.1.1');
    engine.recordServedPage(P, '/', GOOGLEBOT, '2.2.2.2');
    const s = await engine.query(P, q(), true);
    expect(s.human.views).toBe(0);
    expect(s.botViews).toBe(1);
    expect(s.bots).toEqual([{ class: 'search', views: 1 }]);
  });

  it('★ attributes the source on the FIRST pageview of the day only', async () => {
    engine.record(hit({ referrerHost: 'www.google.com' }));
    engine.record(hit({ referrerHost: 'news.ycombinator.com', route: '/about/' }));
    engine.record(hit({ ip: '2.2.2.2', campaign: 'spring-sale' }));
    engine.record(hit({ ip: '2.2.2.3' }));
    const s = await engine.query(P, q(), true);
    expect(s.sources.map((x) => [x.source, x.host, x.visitors]).sort()).toEqual([
      ['campaign', 'spring-sale', 1],
      ['direct', '', 1],
      ['search', 'google.com', 1],
    ]);
  });

  it('★ caps the named referrers per site and day, still counting the rest', async () => {
    await engine.close();
    store = await StatsStore.open(':memory:');
    engine = await open(store, { sourceHosts: 200 });
    for (let i = 0; i < 205; i++) engine.record(hit({ ip: `1.0.${i >> 8}.${i & 255}`, referrerHost: `site${i}.example.org` }));
    // Every source row (the query's list is itself capped at 100 for display).
    const [, ...rows] = await engine.rows(P, 'sources', today(), today());
    expect(rows).toHaveLength(201);
    expect(rows.reduce((n, r) => n + Number(r[3]), 0)).toBe(205);
    expect(rows.find((r) => r[1] === 'referral' && r[2] === '')?.[3]).toBe('5');
  });

  it('★ caps the named referrers across ALL sites too, and a forgotten site gives its share back', async () => {
    await engine.close();
    store = await StatsStore.open(':memory:');
    engine = await open(store, { sourceHosts: 200, sourceHostsTotal: 3 });
    const refer = (projectId: string, n: number) => {
      for (let i = 0; i < n; i++) engine.record(hit({ projectId, ip: `1.0.0.${i}`, referrerHost: `${projectId}-ref${i}.example.org` }));
    };
    const named = async (projectId: string) =>
      (await engine.rows(projectId, 'sources', today(), today())).slice(1).filter((r) => r[1] === 'referral' && r[2] !== '').length;
    refer('first', 3);
    refer('second', 2);
    expect(await named('first')).toBe(3);
    // Presence: the second site's visits are counted — under their kind alone.
    expect((await engine.query('second', q(), true)).human.visitors).toBe(2);
    expect(await named('second')).toBe(0);
    await engine.forget('first');
    refer('third', 2);
    expect(await named('third')).toBe(2);
  });

  it('filters the human breakdowns by device and country, each list keeping its own dimension', async () => {
    engine.record(hit());
    engine.record(hit({ ua: IPHONE, ip: '1.1.1.9' }));
    engine.record(hit({ ip: '2.2.2.2' }));
    const mobile = await engine.query(P, q({ device: 'mobile' }), true);
    expect(mobile.human).toEqual({ views: 1, visitors: 1 });
    expect(mobile.countries).toEqual([{ country: 'DE', views: 1, visitors: 1 }]);
    // The device list ignores the device filter, so the other devices stay selectable.
    expect(mobile.devices.find((d) => d.device === 'desktop')?.views).toBe(2);
    const us = await engine.query(P, q({ country: 'US' }), true);
    expect(us.human).toEqual({ views: 1, visitors: 1 });
    expect(us.countries.map((c) => c.country).sort()).toEqual(['DE', 'US']);
    expect(us.daily[0]).toMatchObject({ views: 1, visitors: 1 });
  });

  it('counts an unknown country as ZZ', async () => {
    engine.record(hit({ ip: '9.9.9.9' }));
    expect((await engine.query(P, q(), true)).countries).toEqual([{ country: 'ZZ', views: 1, visitors: 1 }]);
  });

  it('zero-fills the days of a range', async () => {
    engine.record(hit());
    const s = await engine.query(P, { from: '2026-10-17', to: '2026-10-19' }, true);
    expect(s.daily.map((d) => [d.day, d.views])).toEqual([['2026-10-17', 0], ['2026-10-18', 0], ['2026-10-19', 1]]);
  });

  it('counts goals', async () => {
    engine.recordGoal(P, 'form:contact');
    engine.recordGoal(P, 'form:contact');
    expect((await engine.query(P, q(), true)).goals).toEqual([{ goal: 'form:contact', label: 'form:contact', count: 2 }]);
  });

  it('★ writes NOTHING until a flush, then one transaction of totals', async () => {
    engine.record(hit());
    expect((await store.query(P, q())).human.views).toBe(0);
    await engine.flush();
    expect((await store.query(P, q())).human.views).toBe(1);
    // A second flush with nothing new changes nothing.
    await engine.flush();
    expect((await store.query(P, q())).human.views).toBe(1);
  });

  it('★ a failed write keeps the counts for the next flush', async () => {
    engine.record(hit());
    const real = store.apply.bind(store);
    let fail = true;
    store.apply = async (d) => {
      if (fail) {
        fail = false;
        throw new Error('disk full');
      }
      return real(d);
    };
    await engine.flush();
    engine.record(hit({ route: '/about/' }));
    await engine.flush();
    expect((await store.query(P, q())).human).toEqual({ views: 2, visitors: 1 });
  });

  it('★ remembers today’s visitors across a clean restart, so nobody is counted twice', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sw-stats-'));
    try {
      const url = `file:${join(dir, 'analytics.db')}`;
      let s = await StatsStore.open(url);
      let e = await open(s);
      e.record(hit());
      await e.close();
      s = await StatsStore.open(url);
      e = await open(s);
      e.record(hit({ route: '/about/' }));
      const res = await e.query(P, q(), true);
      expect(res.human).toEqual({ views: 2, visitors: 1 });
      // The route-signing key survives the restart too, or every deployed page's signature would break.
      const key = e.projectKey(P);
      await e.close();
      e = await open(await StatsStore.open(url));
      expect(e.projectKey(P)).toBe(key);
      await e.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('drops totals older than the 25-month retention window', async () => {
    now = new Date('2024-01-10T10:00:00Z');
    const old = await open();
    old.record(hit());
    await old.flush();
    now = new Date('2026-10-19T10:00:00Z');
    engine.record(hit());
    await engine.flush();
    const s = await store.query(P, { from: '2024-01-01', to: '2026-12-31' });
    expect(s.human.views).toBe(1);
    await old.close();
  });

  it('forgets a deleted project entirely', async () => {
    engine.record(hit());
    engine.record(hit({ projectId: 'proj2' }));
    await engine.forget(P);
    expect((await engine.query(P, q(), true)).human.views).toBe(0);
    expect((await engine.query('proj2', q(), true)).human.views).toBe(1);
  });

  it('★ reaps the statistics of projects that no longer exist — and ONLY those (soft-deleted ones stay)', async () => {
    engine.record(hit({ projectId: 'live' }));
    engine.record(hit({ projectId: 'soft-deleted' }));
    engine.record(hit({ projectId: 'gone' }));
    engine.recordGoal('gone', 'form:x');
    const asked: string[][] = [];
    const gone = await engine.reapOrphans(async (ids) => {
      asked.push([...ids].sort());
      return new Set(['live', 'soft-deleted']);
    });
    expect(gone).toEqual(['gone']);
    // It saw the in-memory counts too (they are flushed first), so a pending row cannot slip through.
    expect(asked).toEqual([['gone', 'live', 'soft-deleted']]);
    expect(await store.projectIds()).toEqual(expect.arrayContaining(['live', 'soft-deleted']));
    expect(await store.projectIds()).not.toContain('gone');
    // Nothing left to reap.
    expect(await engine.reapOrphans(async () => new Set(['live', 'soft-deleted']))).toEqual([]);
  });

  it('★ deletes nothing when the existence check fails', async () => {
    engine.record(hit());
    await expect(engine.reapOrphans(async () => Promise.reject(new Error('db down')))).rejects.toThrow('db down');
    expect(await store.projectIds()).toEqual([P]);
  });

  it('★ gives a reaped project’s disk space back (incremental vacuum)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sw-stats-'));
    try {
      const s = await StatsStore.open(`file:${join(dir, 'analytics.db')}`);
      const e = await open(s, { pendingRowsPerSite: 100_000, pendingRows: 100_000 });
      // A busy site: a few thousand page rows.
      for (let i = 0; i < 5000; i++) e.record(hit({ projectId: 'big', route: `/a-long-route-name-for-page-number-${i}/` }));
      e.record(hit({ projectId: 'small' }));
      await e.flush();
      const before = await s.pages();
      expect(before.total).toBeGreaterThan(50);
      await e.forget('big');
      const after = await s.pages();
      expect(after.free).toBe(0);
      expect(after.total).toBeLessThan(before.total / 2);
      expect(await s.projectIds()).toEqual(['small']);
      await e.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  /** A WAL-mode statistics file made WITHOUT incremental vacuum, holding data and free pages from a delete. */
  async function legacyFile(file: string): Promise<void> {
    const { createClient } = await import('@libsql/client');
    const legacy = createClient({ url: `file:${file}` });
    await legacy.executeMultiple('PRAGMA journal_mode = WAL;');
    await legacy.execute('CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID');
    await legacy.execute({ sql: 'INSERT INTO meta (k, v) VALUES (?, ?)', args: ['secret', 'kept'] });
    await legacy.execute('CREATE TABLE filler (x TEXT)');
    await legacy.batch(Array.from({ length: 200 }, () => ({ sql: 'INSERT INTO filler (x) VALUES (?)', args: ['x'.repeat(2000)] })), 'write');
    await legacy.execute('DELETE FROM filler');
    legacy.close();
  }
  async function vacuumMode(file: string): Promise<number> {
    const { createClient } = await import('@libsql/client');
    const c = createClient({ url: `file:${file}` });
    const rs = await c.execute('PRAGMA auto_vacuum');
    c.close();
    return Number(rs.rows[0]?.[0]);
  }

  it('★ converts a (WAL-mode) file made without incremental vacuum, keeping its data and shrinking it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sw-stats-'));
    try {
      const file = join(dir, 'analytics.db');
      await legacyFile(file);
      expect(await vacuumMode(file)).toBe(0);
      const s = await StatsStore.open(`file:${file}`);
      expect((await s.secret()).secret).toBe('kept');
      expect((await s.pages()).free).toBe(0); // the VACUUM dropped the delete's free pages
      s.close();
      expect(await vacuumMode(file)).toBe(2); // INCREMENTAL from now on
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('★ never blocks startup on the conversion: a file too large to rewrite opens unconverted, and says so', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sw-stats-'));
    try {
      const file = join(dir, 'analytics.db');
      await legacyFile(file);
      const logs: string[] = [];
      const s = await StatsStore.open(`file:${file}`, { convertMaxBytes: 0, log: (m) => logs.push(m) });
      expect((await s.secret()).secret).toBe('kept');
      await expect(s.compact()).resolves.toBeUndefined(); // harmless without incremental vacuum
      s.close();
      expect(await vacuumMode(file)).toBe(0);
      expect(logs.some((m) => m.includes('too large to convert'))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('★ refuses to wipe most sites at once (a main database restored from an old backup looks like that)', async () => {
    const logs: string[] = [];
    await engine.close();
    store = await StatsStore.open(':memory:');
    engine = await StatsEngine.open({ store, geo, now: () => now, log: (m) => logs.push(m) });
    for (const p of ['a', 'b', 'c', 'd', 'e', 'f']) engine.record(hit({ projectId: p }));
    expect(await engine.reapOrphans(async () => new Set(['a', 'b']))).toEqual([]);
    expect((await store.projectIds()).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(logs.some((m) => m.includes('NOT deleting'))).toBe(true);
    // One site gone among many is the ordinary case, and is reaped.
    expect(await engine.reapOrphans(async () => new Set(['a', 'b', 'c', 'd', 'e']))).toEqual(['f']);
  });

  /** Makes the store's forget fail while `failing()` says so. */
  function breakForget(s: StatsStore, failing: () => boolean): void {
    const real = s.forget.bind(s);
    s.forget = async (project) => {
      if (failing()) throw new Error('disk busy');
      return real(project);
    };
  }

  it('★ remembers a purge whose forget FAILED — across a restart — and the next sweep finishes it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sw-stats-'));
    try {
      const url = `file:${join(dir, 'analytics.db')}`;
      const s = await StatsStore.open(url);
      const first = await open(s);
      first.record(hit({ projectId: 'live' }));
      first.record(hit({ projectId: 'purged' }));
      breakForget(s, () => true);
      await expect(first.forget('purged')).rejects.toThrow('disk busy');
      await first.close();
      // A new process: the purge is on record in the statistics file itself.
      const again = await StatsStore.open(url);
      expect(await again.purgedIds()).toEqual(['purged']);
      expect((await again.projectIds()).sort()).toEqual(['live', 'purged']);
      const second = await open(again);
      expect(await second.reapOrphans(async () => new Set(['live']))).toEqual(['purged']);
      expect(await again.projectIds()).toEqual(['live']);
      // Done with: the record goes with the next pass that finds nothing left.
      expect(await second.reapOrphans(async () => new Set(['live']))).toEqual([]);
      expect(await again.purgedIds()).toEqual([]);
      await second.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('★ a bulk purge of MOST sites is forgotten in full — the brake is for sites nobody deleted', async () => {
    for (const p of ['a', 'b', 'c', 'd', 'e', 'f']) engine.record(hit({ projectId: p }));
    let failing = true;
    breakForget(store, () => failing);
    for (const p of ['c', 'd', 'e', 'f']) await expect(engine.forget(p)).rejects.toThrow('disk busy');
    // Presence first: the purged sites' statistics really are still there, and are more than the brake allows.
    expect((await store.projectIds()).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    // While the store keeps failing, the sweep fails too — and forgets nothing it was told about.
    await expect(engine.reapOrphans(async () => new Set(['a', 'b']))).rejects.toThrow('disk busy');
    expect((await store.purgedIds()).sort()).toEqual(['c', 'd', 'e', 'f']);
    failing = false;
    expect((await engine.reapOrphans(async () => new Set(['a', 'b']))).sort()).toEqual(['c', 'd', 'e', 'f']);
    expect((await store.projectIds()).sort()).toEqual(['a', 'b']);
    expect(await engine.reapOrphans(async () => new Set(['a', 'b']))).toEqual([]);
    expect(await store.purgedIds()).toEqual([]);
  });

  it('★ still holds back sites that vanished UNEXPLAINED, while finishing the purged ones', async () => {
    const logs: string[] = [];
    await engine.close();
    store = await StatsStore.open(':memory:');
    engine = await StatsEngine.open({ store, geo, now: () => now, log: (m) => logs.push(m) });
    for (const p of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) engine.record(hit({ projectId: p }));
    let failing = true;
    breakForget(store, () => failing);
    for (const p of ['g', 'h']) await expect(engine.forget(p)).rejects.toThrow('disk busy');
    failing = false;
    // Only a and b exist: g and h were purged on purpose, c–f vanished with no purge on record.
    expect((await engine.reapOrphans(async () => new Set(['a', 'b']))).sort()).toEqual(['g', 'h']);
    expect((await store.projectIds()).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(logs.some((m) => m.includes('4 of 6 sites with statistics are missing') && m.includes('NOT deleting'))).toBe(true);
  });

  it('★ a purged id whose project EXISTS again (a restored database) keeps its statistics', async () => {
    engine.record(hit({ projectId: 'back' }));
    breakForget(store, () => true);
    await expect(engine.forget('back')).rejects.toThrow('disk busy');
    expect(await store.purgedIds()).toEqual(['back']);
    expect(await engine.reapOrphans(async () => new Set(['back']))).toEqual([]);
    expect(await store.projectIds()).toEqual(['back']);
    expect(await store.purgedIds()).toEqual([]);
  });

  it('★ a purge the statistics file cannot even RECORD is still finished by the next sweep (held in memory)', async () => {
    const logs: string[] = [];
    await engine.close();
    store = await StatsStore.open(':memory:');
    engine = await StatsEngine.open({ store, geo, now: () => now, log: (m) => logs.push(m) });
    for (const p of ['a', 'b', 'c', 'd', 'e', 'f']) engine.record(hit({ projectId: p }));
    store.markPurged = async () => {
      throw new Error('read-only file');
    };
    let failing = true;
    breakForget(store, () => failing);
    for (const p of ['c', 'd', 'e', 'f']) await expect(engine.forget(p)).rejects.toThrow('disk busy');
    expect(logs.some((m) => m.includes('could not record'))).toBe(true);
    failing = false;
    expect((await engine.reapOrphans(async () => new Set(['a', 'b']))).sort()).toEqual(['c', 'd', 'e', 'f']);
    expect((await store.projectIds()).sort()).toEqual(['a', 'b']);
  });

  it('★ keeps a purge on record until a sweep finds nothing left, so a visit that lands LATE is deleted too', async () => {
    engine.record(hit({ projectId: 'live' }));
    engine.record(hit({ projectId: 'purged' }));
    await engine.forget('purged');
    expect(await store.projectIds()).toEqual(['live']);
    expect(await store.purgedIds()).toEqual(['purged']);
    // A visit that was already past its checks when the project went lands a row after the delete…
    engine.record(hit({ projectId: 'purged' }));
    expect(await engine.reapOrphans(async () => new Set(['live']))).toEqual(['purged']);
    // …and another one after that sweep: the record is still there for the next.
    engine.record(hit({ projectId: 'purged', route: '/about/' }));
    expect(await store.purgedIds()).toEqual(['purged']);
    expect(await engine.reapOrphans(async () => new Set(['live']))).toEqual(['purged']);
    expect(await store.projectIds()).toEqual(['live']);
    // A pass that finds nothing left drops the record.
    expect(await engine.reapOrphans(async () => new Set(['live']))).toEqual([]);
    expect(await store.purgedIds()).toEqual([]);
  });

  it('keeps the purge record bounded, dropping the oldest', async () => {
    const s = await StatsStore.open(':memory:', { purgedMax: 3 });
    for (let i = 0; i < 5; i++) await s.markPurged(`p${i}`, new Date(Date.UTC(2026, 9, 19, 10, 0, i)));
    expect((await s.purgedIds()).sort()).toEqual(['p2', 'p3', 'p4']);
    // Marking an id again does not make it younger: p2 is still the oldest, and goes next.
    await s.markPurged('p2', new Date(Date.UTC(2026, 9, 19, 11)));
    await s.markPurged('p5', new Date(Date.UTC(2026, 9, 19, 12)));
    expect((await s.purgedIds()).sort()).toEqual(['p3', 'p4', 'p5']);
    s.close();
  });

  it('a failure to give space back neither fails the flush nor repeats the prune', async () => {
    const logs: string[] = [];
    await engine.close();
    store = await StatsStore.open(':memory:');
    engine = await StatsEngine.open({ store, geo, now: () => now, log: (m) => logs.push(m) });
    let prunes = 0;
    const realPrune = store.prune.bind(store);
    store.prune = async (...args) => {
      prunes++;
      return realPrune(...args);
    };
    store.compact = async () => {
      throw new Error('disk busy');
    };
    engine.record(hit());
    expect(await engine.flush()).toBe(true);
    expect(await engine.flush()).toBe(true);
    expect(prunes).toBe(1);
    expect(logs.some((m) => m.includes('could not give freed space back'))).toBe(true);
    expect((await engine.query(P, q(), true)).human.views).toBe(1);
  });

  it('exports a table as rows with a header', async () => {
    engine.record(hit());
    const rows = await engine.rows(P, 'traffic', today(), today());
    expect(rows).toEqual([
      ['day', 'class', 'device', 'country', 'views', 'visitors'],
      [today(), 'human', 'desktop', 'DE', '1', '1'],
    ]);
  });

  it('★ one site reaching its visitor cap does not cost ANOTHER site its de-duplication', async () => {
    await engine.close();
    store = await StatsStore.open(':memory:');
    engine = await open(store, { seenIdsPerSite: 2 });
    for (const ip of ['1.0.0.1', '1.0.0.2', '1.0.0.3']) engine.record(hit({ ip }));
    // The third visitor of the full site is counted but not remembered: a second pageview counts them again.
    engine.record(hit({ ip: '1.0.0.3', route: '/about/' }));
    // The other site still de-duplicates.
    engine.record(hit({ projectId: 'proj2' }));
    engine.record(hit({ projectId: 'proj2', route: '/about/' }));
    expect((await engine.query(P, q(), true)).human).toEqual({ views: 4, visitors: 4 });
    expect((await engine.query('proj2', q(), true)).human).toEqual({ views: 2, visitors: 1 });
  });

  it('★ one site flooding distinct rows does not crowd out another site’s counts', async () => {
    await engine.close();
    store = await StatsStore.open(':memory:');
    const logs: string[] = [];
    engine = await StatsEngine.open({ store, geo, now: () => now, limits: { pendingRowsPerSite: 3 }, log: (m) => logs.push(m) });
    for (let i = 0; i < 10; i++) engine.record(hit({ route: `/p${i}/` }));
    engine.record(hit({ projectId: 'proj2', route: '/' }));
    const flooded = await engine.query(P, q(), true);
    expect(flooded.pages.length).toBeLessThanOrEqual(3);
    expect((await engine.query('proj2', q(), true)).human.views).toBe(1);
    expect(logs.some((m) => m.includes('counts dropped'))).toBe(true);
  });

  it('★ remembers today’s visitors across a CRASH too: ids are written with every flush, not only on close', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sw-stats-'));
    try {
      const url = `file:${join(dir, 'analytics.db')}`;
      const first = await open(await StatsStore.open(url));
      first.record(hit());
      await first.flush();
      // No close(): the process died. A new process opens the same file.
      const second = await open(await StatsStore.open(url));
      second.record(hit({ route: '/about/' }));
      expect((await second.query(P, q(), true)).human).toEqual({ views: 2, visitors: 1 });
      await second.close();
      await first.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('★ a midnight rollover DURING the salt write leaves the new day’s salt to be saved next time', async () => {
    const real = store.saveSalt.bind(store);
    let roll = true;
    store.saveSalt = async (day, salt) => {
      await real(day, salt);
      if (roll) {
        roll = false;
        now = new Date('2026-10-20T00:00:01Z');
        engine.record(hit()); // the first visit of the new day rolls the salt over
      }
    };
    await engine.flush();
    expect(await store.salt('2026-10-19')).not.toBeNull();
    expect(await store.salt('2026-10-20')).toBeNull();
    await engine.flush();
    expect(await store.salt('2026-10-20')).not.toBeNull();
  });

  it('★ stops counting BEFORE the final write, and says so when that write fails', async () => {
    const logs: string[] = [];
    await engine.close();
    store = await StatsStore.open(':memory:');
    engine = await StatsEngine.open({ store, geo, now: () => now, log: (m) => logs.push(m) });
    engine.record(hit());
    store.apply = async () => {
      throw new Error('disk full');
    };
    await engine.close();
    expect(logs.some((m) => m.includes('final write failed'))).toBe(true);
  });

  it('signs with the secret it is given, so signatures outlive the statistics file', async () => {
    const e = await StatsEngine.open({ store: await StatsStore.open(':memory:'), geo, secret: 'from-the-encryption-key' });
    expect(e.projectKey(P)).toBe(statsProjectKey('from-the-encryption-key', P));
    expect(e.createdSecret).toBe(false);
    await e.close();
  });

  it('says when it had to CREATE a secret (and keeps it on the next open)', async () => {
    expect(engine.createdSecret).toBe(true);
    const key = engine.projectKey(P);
    await engine.flush();
    const again = await StatsEngine.open({ store, geo, now: () => now });
    expect(again.createdSecret).toBe(false);
    expect(again.projectKey(P)).toBe(key);
  });

  it('ignores late visits after close instead of throwing (a request finishing during shutdown)', async () => {
    await engine.close();
    expect(() => {
      engine.record(hit());
      engine.recordGoal(P, 'form:x');
      engine.recordServedPage(P, '/', GOOGLEBOT, '1.1.1.1');
    }).not.toThrow();
    await expect(engine.close()).resolves.toBeUndefined();
  });
});
