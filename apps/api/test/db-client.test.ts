import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb } from '../src/db/client.js';

describe('createDb connection pragmas', () => {
  let dir: string | undefined;
  let close: (() => void) | undefined;
  afterEach(async () => {
    close?.();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('opens a file DB in WAL with a 5s busy timeout and synchronous=NORMAL', async () => {
    dir = await mkdtemp(join(tmpdir(), 'sw-db-pragma-'));
    const { client } = await createDb(`file:${join(dir, 'p.db')}`);
    close = () => client.close();
    const val = async (pragma: string, col: string) =>
      ((await client.execute(`PRAGMA ${pragma}`)).rows[0] as Record<string, unknown>)[col];

    expect(await val('journal_mode', 'journal_mode')).toBe('wal'); // readers don't block the writer
    expect(await val('busy_timeout', 'timeout')).toBe(5000); // wait on contention, not SQLITE_BUSY
    expect(await val('synchronous', 'synchronous')).toBe(1); // NORMAL — the durable WAL pairing
  });
});
