import { createClient, LibsqlError, type Client, type InArgs, type InStatement, type Replicated, type ResultSet, type Transaction, type TransactionMode } from '@libsql/client';

/**
 * OPENING A SQLITE FILE — the platform database and the statistics file both open here.
 *
 * libsql's local client is a POOL of connections, not one: every call borrows one, a transaction holds one until it
 * settles, and a busy pool opens another. Two things follow, both measured on @libsql/client 0.18:
 *
 * 1. **A pragma run once reaches one connection.** `busy_timeout` and `synchronous` are per connection, so the
 *    others ran with no wait at all (`busy_timeout` 0) and `synchronous = FULL`. The wait now comes from the client's
 *    `timeout` option, which libsql applies to every connection it opens; `synchronous` is set on every pooled
 *    connection at open (see `openSqlite`).
 *
 * 2. **Waiting inside SQLite cannot settle contention inside this process.** libsql runs each statement
 *    synchronously, so a write that meets another connection's open transaction sleeps on the event loop — and the
 *    transaction holding the lock can only finish ON that loop. The write froze the whole server for the full
 *    timeout and then failed with SQLITE_BUSY anyway (measured with a 3 s wait and a holder needing 40 ms more:
 *    frozen 3 s, then refused). So
 *    writers in this process queue HERE, asynchronously (`WriteGate`): a write transaction holds the gate until it
 *    commits or rolls back, and every other write waits its turn while the loop keeps running. SQLite's own wait is
 *    left for what it can help with: another process or thread on the same file.
 *
 * Plain SELECTs are not queued: in WAL a reader never blocks on the writer, and a SELECT inside a transaction's
 * callback on the outer client would otherwise wait for its own transaction. Everything else queues — a write on the
 * outer client inside a transaction's callback that the callback then AWAITS waits for its own transaction, and
 * fails after `BUSY_WAIT_MS` (it failed at once before): inside a callback, use the transaction. (A `:memory:` test
 * database is one connection, so there a SELECT during an open transaction still fails with TRANSACTION_ACTIVE.)
 */

/** How long a write waits for the database: for another process inside SQLite, for this one in the gate. */
export const BUSY_WAIT_MS = 5_000;

/**
 * Connections per file. Statements run one at a time on the event loop, so more connections add no throughput:
 * they only serve calls started together (a `Promise.all` of queries) and the reads made while a transaction holds
 * one. The gate lets at most one write transaction hold a connection.
 */
export const POOL_SIZE = 4;

/** Pragmas every connection gets (on top of the client's `timeout`). */
const PER_CONNECTION = 'PRAGMA synchronous = NORMAL';

/** A statement that only reads, which never queues. Anything else (a CTE, a pragma) queues, so no write slips past. */
const READ_ONLY = /^\s*select\b/i;

const sqlOf = (stmt: InStatement | [string, InArgs?]): string => (typeof stmt === 'string' ? stmt : Array.isArray(stmt) ? stmt[0] : stmt.sql);

interface Waiter {
  grant: () => void;
  close: (err: Error) => void;
}

/** One writer at a time in this process, in arrival order; a wait longer than `waitMs` fails like SQLite's own. */
export class WriteGate {
  #held = false;
  readonly #waiting: Waiter[] = [];

  constructor(private readonly waitMs: number = BUSY_WAIT_MS) {}

  /** Resolves with the gate's release once it is this caller's turn. Releasing more than once is harmless. */
  acquire(): Promise<() => void> {
    if (!this.#held) {
      this.#held = true;
      return Promise.resolve(this.#release());
    }
    return new Promise((resolve, reject) => {
      const grant = (): void => {
        clearTimeout(timer);
        resolve(this.#release());
      };
      const leave = (): void => {
        const at = this.#waiting.indexOf(waiter);
        if (at >= 0) this.#waiting.splice(at, 1);
      };
      const timer = setTimeout(() => {
        leave();
        reject(new LibsqlError(`database is locked: a write waited ${this.waitMs} ms for another one in this process`, 'SQLITE_BUSY'));
      }, this.waitMs);
      timer.unref();
      const waiter: Waiter = {
        grant,
        close: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      };
      this.#waiting.push(waiter);
    });
  }

  /** The database closed: every write still waiting fails now, as libsql fails its own. */
  close(): void {
    const waiting = this.#waiting.splice(0);
    for (const w of waiting) w.close(new LibsqlError('The client is closed', 'CLIENT_CLOSED'));
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await work();
    } finally {
      release();
    }
  }

  #release(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.#waiting.shift();
      if (next) next.grant();
      else this.#held = false;
    };
  }
}

/** A write transaction that gives the gate back however it ends. */
class GatedTransaction implements Transaction {
  readonly #tx: Transaction;
  readonly #release: () => void;

  constructor(tx: Transaction, release: () => void) {
    this.#tx = tx;
    this.#release = release;
  }

  get closed(): boolean {
    return this.#tx.closed;
  }

  execute(stmt: InStatement): Promise<ResultSet> {
    return this.#tx.execute(stmt);
  }

  batch(stmts: Array<InStatement>): Promise<Array<ResultSet>> {
    return this.#tx.batch(stmts);
  }

  executeMultiple(sql: string): Promise<void> {
    return this.#tx.executeMultiple(sql);
  }

  // libsql hands the connection back however a commit ends (a failed one is rolled back on its way to the pool).
  async commit(): Promise<void> {
    try {
      await this.#tx.commit();
    } finally {
      this.#release();
    }
  }

  async rollback(): Promise<void> {
    try {
      await this.#tx.rollback();
    } finally {
      this.#release();
    }
  }

  close(): void {
    try {
      this.#tx.close();
    } finally {
      this.#release();
    }
  }
}

/** The libsql client with this process's writes queued through one gate. */
class GatedClient implements Client {
  readonly #client: Client;
  readonly #gate: WriteGate;

  constructor(client: Client, gate: WriteGate) {
    this.#client = client;
    this.#gate = gate;
  }

  get closed(): boolean {
    return this.#client.closed;
  }

  get protocol(): string {
    return this.#client.protocol;
  }

  execute(stmt: InStatement): Promise<ResultSet>;
  execute(sql: string, args?: InArgs): Promise<ResultSet>;
  execute(stmt: InStatement, args?: InArgs): Promise<ResultSet> {
    const run = (): Promise<ResultSet> => (typeof stmt === 'string' ? this.#client.execute(stmt, args) : this.#client.execute(stmt));
    return READ_ONLY.test(sqlOf(stmt)) ? run() : this.#queued(run);
  }

  batch(stmts: Array<InStatement | [string, InArgs?]>, mode?: TransactionMode): Promise<Array<ResultSet>> {
    const run = (): Promise<Array<ResultSet>> => this.#client.batch(stmts, mode);
    return mode === 'read' ? run() : this.#queued(run);
  }

  migrate(stmts: Array<InStatement>): Promise<Array<ResultSet>> {
    return this.#queued(() => this.#client.migrate(stmts));
  }

  async transaction(mode: TransactionMode = 'write'): Promise<Transaction> {
    if (mode === 'read' || this.#client.closed) return this.#client.transaction(mode);
    const release = await this.#gate.acquire();
    try {
      return new GatedTransaction(await this.#client.transaction(mode), release);
    } catch (err) {
      release();
      throw err;
    }
  }

  executeMultiple(sql: string): Promise<void> {
    return this.#queued(() => this.#client.executeMultiple(sql));
  }

  sync(): Promise<Replicated> {
    return this.#client.sync();
  }

  close(): void {
    this.#gate.close();
    this.#client.close();
  }

  reconnect(): void {
    this.#client.reconnect();
  }

  /** A write in its turn; on a closed client, straight to libsql, which fails it at once. */
  #queued<T>(work: () => Promise<T>): Promise<T> {
    return this.#client.closed ? work() : this.#gate.run(work);
  }
}

export interface OpenSqliteOptions {
  /** Statements that must reach a new file before anything else does (the statistics file's `auto_vacuum`). */
  first?: string;
  /** How long a write waits for another one in this process (default `BUSY_WAIT_MS`). */
  waitMs?: number;
}

/**
 * Opens a libsql database (`:memory:` for tests, a `file:` URL in production) in WAL, with every connection waiting
 * `BUSY_WAIT_MS` on another process's lock and set to `synchronous = NORMAL`, and this process's writes queued.
 *
 * - **WAL**: readers no longer block the writer, and commits append to the `-wal` file. Kept in the file header, so
 *   once is enough (a no-op for `:memory:`).
 * - **synchronous = NORMAL**: the WAL pairing — an fsync per checkpoint, not per commit. The file stays consistent
 *   through any crash; only a power cut or kernel panic can lose the last commits not yet checkpointed. Back up the
 *   `-wal` sidecar too (see the Dockerfile note).
 *
 * Every pooled connection gets the pragma because the calls below start together: each borrows its own, and the
 * pool opens all `POOL_SIZE` of them now. One the pool opens again later (after a failed rollback, or every one after
 * a `reconnect()`, which nothing calls) still waits on locks, through `timeout`, but syncs fully.
 */
export async function openSqlite(url: string, opts: OpenSqliteOptions = {}): Promise<Client> {
  const client = createClient({ url, timeout: BUSY_WAIT_MS, concurrency: POOL_SIZE });
  try {
    if (opts.first) await client.executeMultiple(opts.first);
    await client.execute('PRAGMA journal_mode = WAL');
    await Promise.all(Array.from({ length: POOL_SIZE }, () => client.execute(PER_CONNECTION)));
  } catch (err) {
    client.close();
    throw err;
  }
  return new GatedClient(client, new WriteGate(opts.waitMs));
}
