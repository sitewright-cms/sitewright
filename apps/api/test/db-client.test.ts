import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import type { Client } from '@libsql/client';
import { createDb } from '../src/db/client.js';
import { openSqlite, POOL_SIZE, WriteGate } from '../src/db/sqlite.js';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('createDb connection pragmas', () => {
  let dir: string | undefined;
  let close: (() => void) | undefined;
  afterEach(async () => {
    close?.();
    close = undefined;
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  const fileDb = async () => {
    dir = await mkdtemp(join(tmpdir(), 'sw-db-pragma-'));
    const handle = await createDb(`file:${join(dir, 'p.db')}`);
    close = () => handle.client.close();
    return handle;
  };

  it('opens a file DB in WAL with a 5s busy timeout and synchronous=NORMAL', async () => {
    const { client } = await fileDb();
    const val = async (pragma: string, col: string) =>
      ((await client.execute(`PRAGMA ${pragma}`)).rows[0] as Record<string, unknown>)[col];

    expect(await val('journal_mode', 'journal_mode')).toBe('wal'); // readers don't block the writer
    expect(await val('busy_timeout', 'timeout')).toBe(5000); // wait on contention, not SQLITE_BUSY
    expect(await val('synchronous', 'synchronous')).toBe(1); // NORMAL — the durable WAL pairing
  });

  // ★ libsql's client is a pool: a pragma run once reached ONE connection, and the others ran with no lock wait and a
  // full fsync per commit. Holding every connection at once (each transaction borrows its own) shows them all.
  it('gives EVERY pooled connection the lock wait and synchronous=NORMAL', async () => {
    const { client } = await fileDb();
    const held = await Promise.all(Array.from({ length: POOL_SIZE }, () => client.transaction('read')));
    try {
      const seen = await Promise.all(
        held.map(async (tx) => [
          Number((await tx.execute('PRAGMA busy_timeout')).rows[0]?.[0]),
          Number((await tx.execute('PRAGMA synchronous')).rows[0]?.[0]),
        ]),
      );
      expect(seen).toEqual(Array.from({ length: POOL_SIZE }, () => [5000, 1]));
    } finally {
      for (const tx of held) tx.close();
    }
  });
});

describe('writes in one process queue instead of failing', () => {
  let dir: string | undefined;
  let close: (() => void) | undefined;
  afterEach(async () => {
    close?.();
    close = undefined;
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  const fileDb = async () => {
    dir = await mkdtemp(join(tmpdir(), 'sw-db-gate-'));
    const handle = await createDb(`file:${join(dir, 'g.db')}`);
    close = () => handle.client.close();
    await handle.client.execute('CREATE TABLE t (x INTEGER)');
    return handle;
  };

  /** A transaction that holds the write lock until `finish()`; `locked` settles once it does. */
  function hold(db: Awaited<ReturnType<typeof fileDb>>['db']) {
    let locked!: () => void;
    let finish!: () => void;
    const lockedP = new Promise<void>((resolve) => (locked = resolve));
    const finishing = new Promise<void>((resolve) => (finish = resolve));
    const order: string[] = [];
    const done = db.transaction(async (tx) => {
      await tx.run(sql`INSERT INTO t VALUES (1)`);
      locked();
      await finishing;
      order.push('holder commits');
    });
    return { locked: lockedP, finish, done, order };
  }

  // ★ The failure this fixes: a transaction held across a real await (a timer, a file, a request) and a write meanwhile
  // on another connection. That write failed at once with SQLITE_BUSY — or, with a lock wait, froze the event loop for
  // the whole wait (so the holder could never finish) and THEN failed.
  it('a write meeting an open transaction waits for it, with the event loop running', async () => {
    const { db } = await fileDb();
    const holder = hold(db);
    await holder.locked;

    const started = Date.now();
    const write = db.run(sql`INSERT INTO t VALUES (2)`).then(() => holder.order.push('write done'));
    await sleep(20); // timers still fire while the write waits…
    expect(holder.order).toEqual([]); // …and it is still waiting
    holder.finish();
    await Promise.all([holder.done, write]);

    expect(holder.order).toEqual(['holder commits', 'write done']);
    expect(Date.now() - started).toBeLessThan(4000); // a frozen loop would have sat out the 5 s lock wait
    expect((await db.all(sql`SELECT x FROM t ORDER BY x`)).map((r) => (r as { x: number }).x)).toEqual([1, 2]);
  });

  it('batches and multi-statement writes wait their turn too', async () => {
    const { db, client } = await fileDb();
    const holder = hold(db);
    await holder.locked;
    const batch = client.batch(['INSERT INTO t VALUES (3)']);
    const multiple = client.executeMultiple('INSERT INTO t VALUES (4);');
    holder.finish();
    await Promise.all([holder.done, batch, multiple]);
    expect((await db.all(sql`SELECT x FROM t ORDER BY x`)).map((r) => (r as { x: number }).x)).toEqual([1, 3, 4]);
  });

  it('two transactions take turns instead of the second failing to begin', async () => {
    const { db } = await fileDb();
    const holder = hold(db);
    await holder.locked;
    const second = db.transaction(async (tx) => {
      await tx.run(sql`INSERT INTO t VALUES (2)`);
    });
    holder.finish();
    await expect(Promise.all([holder.done, second])).resolves.toBeDefined();
    expect((await db.all(sql`SELECT count(*) AS n FROM t`))[0]).toEqual({ n: 2 });
  });

  it('a read during an open transaction does not wait for it', async () => {
    const { db } = await fileDb();
    await db.run(sql`INSERT INTO t VALUES (7)`);
    const holder = hold(db);
    await holder.locked;
    // The last committed state, straight away: the reader never queued behind the writer.
    expect(await db.all(sql`SELECT x FROM t`)).toEqual([{ x: 7 }]);
    holder.finish();
    await holder.done;
  });

  it('closing the database fails the writes still waiting, at once', async () => {
    const { db, client } = await fileDb();
    const holder = hold(db);
    await holder.locked;
    const waiting = client.execute('INSERT INTO t VALUES (2)');
    close = undefined;
    client.close();
    await expect(waiting).rejects.toMatchObject({ code: 'CLIENT_CLOSED' });
    await expect(client.execute('INSERT INTO t VALUES (3)')).rejects.toMatchObject({ code: 'CLIENT_CLOSED' }); // and any after it
    holder.finish();
    await holder.done.catch(() => {}); // its connection went with the client
  });

  it('a transaction that throws rolls back and lets the next write through', async () => {
    const { db } = await fileDb();
    await expect(
      db.transaction(async (tx) => {
        await tx.run(sql`INSERT INTO t VALUES (1)`);
        throw new Error('no');
      }),
    ).rejects.toThrow('no');
    await db.run(sql`INSERT INTO t VALUES (2)`);
    expect(await db.all(sql`SELECT x FROM t`)).toEqual([{ x: 2 }]);
  });
});

describe('WriteGate', () => {
  it('serves waiters in arrival order', async () => {
    const gate = new WriteGate(1000);
    const order: number[] = [];
    const release = await gate.acquire();
    const runs = [1, 2, 3].map((n) => gate.run(async () => void order.push(n)));
    release();
    await Promise.all(runs);
    expect(order).toEqual([1, 2, 3]);
  });

  it('gives up after its wait like SQLite does, and the gate still works after', async () => {
    const gate = new WriteGate(20);
    const release = await gate.acquire();
    await expect(gate.acquire()).rejects.toMatchObject({ code: 'SQLITE_BUSY' });
    release();
    const next = await gate.acquire(); // the timed-out waiter left no place in the queue behind
    next();
  });

  it('releasing one hold twice hands the gate to ONE waiter', async () => {
    const gate = new WriteGate(1000);
    const release = await gate.acquire();
    const holders: string[] = [];
    const a = gate.acquire().then((done) => (holders.push('a'), done));
    const b = gate.acquire().then((done) => (holders.push('b'), done));
    release();
    release();
    await sleep(5);
    expect(holders).toEqual(['a']);
    (await a)();
    (await b)();
    expect(holders).toEqual(['a', 'b']);
  });
});

describe('openSqlite', () => {
  let client: Client | undefined;
  afterEach(() => client?.close());

  it('runs `first` before anything else touches the file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sw-db-first-'));
    try {
      client = await openSqlite(`file:${join(dir, 'f.db')}`, { first: 'PRAGMA auto_vacuum = INCREMENTAL' });
      await client.execute('CREATE TABLE t (x)');
      expect(Number((await client.execute('PRAGMA auto_vacuum')).rows[0]?.[0])).toBe(2);
    } finally {
      client?.close();
      client = undefined;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
