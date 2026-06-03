import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCredentials, saveCredentials, clearCredentials } from '../src/credentials.js';

const URL_A = 'http://dind.local:2003';
const creds = (t: string) => ({ accessToken: `acc-${t}`, refreshToken: `ref-${t}`, scope: 'content:read', obtainedAt: '2026-06-03T00:00:00.000Z' });

describe('credentials store', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sw-creds-'));
    process.env.SITEWRIGHT_CREDENTIALS = join(dir, 'nested', 'credentials.json');
  });
  afterEach(async () => {
    delete process.env.SITEWRIGHT_CREDENTIALS;
    await rm(dir, { recursive: true, force: true });
  });

  it('returns null when nothing is stored (missing file)', async () => {
    expect(await loadCredentials(URL_A)).toBeNull();
  });

  it('round-trips credentials per URL and writes the file 0600', async () => {
    await saveCredentials(URL_A, creds('1'));
    expect(await loadCredentials(URL_A)).toEqual(creds('1'));
    const mode = (await stat(process.env.SITEWRIGHT_CREDENTIALS!)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('keys by URL (trailing slash insensitive) and keeps other instances', async () => {
    await saveCredentials(URL_A, creds('a'));
    await saveCredentials('https://other.test', creds('b'));
    expect(await loadCredentials(`${URL_A}/`)).toEqual(creds('a')); // trailing slash matches
    expect(await loadCredentials('https://other.test')).toEqual(creds('b'));
  });

  it('overwrites on re-save and clears on logout (keeping the file 0600)', async () => {
    await saveCredentials(URL_A, creds('old'));
    await saveCredentials(URL_A, creds('new'));
    expect((await loadCredentials(URL_A))?.accessToken).toBe('acc-new');
    await saveCredentials('https://other.test', creds('keep')); // a second entry survives the clear
    await clearCredentials(URL_A);
    expect(await loadCredentials(URL_A)).toBeNull();
    expect((await loadCredentials('https://other.test'))?.accessToken).toBe('acc-keep');
    expect((await stat(process.env.SITEWRIGHT_CREDENTIALS!)).mode & 0o777).toBe(0o600); // still owner-only after logout
  });

  it('treats a corrupt/partial entry (missing refreshToken) as not logged in', async () => {
    await saveCredentials(URL_A, { accessToken: 'acc', refreshToken: '', scope: '', obtainedAt: 'x' });
    expect(await loadCredentials(URL_A)).toBeNull();
  });

  it('never writes tokens world-readable even when the file pre-exists', async () => {
    await saveCredentials(URL_A, creds('1'));
    await saveCredentials('https://other.test', creds('2')); // second write into an existing file
    const mode = (await stat(process.env.SITEWRIGHT_CREDENTIALS!)).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(await readFile(process.env.SITEWRIGHT_CREDENTIALS!, 'utf8')).toContain('acc-1');
  });
});
