import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import {
  DeployConfigSchema,
  archiveSite,
  collectSiteFiles,
  defaultTransport,
  deploySite,
  type DeployManifest,
  type DeployProgress,
  type DeployTransport,
  type SiteFile,
} from '../src/publish/adapters.js';
import { computeManifest } from '../src/publish/deploy/manifest.js';

let siteDir: string;

beforeEach(async () => {
  siteDir = await mkdtemp(join(tmpdir(), 'sw-adapters-'));
  await writeFile(join(siteDir, 'index.html'), '<!doctype html><h1>Home</h1>');
  await mkdir(join(siteDir, 'about'), { recursive: true });
  await writeFile(join(siteDir, 'about', 'index.html'), '<!doctype html><h1>About</h1>');
});
afterEach(async () => {
  await rm(siteDir, { recursive: true, force: true });
});

describe('collectSiteFiles', () => {
  it('lists files recursively, sorted, relative to the root', async () => {
    const files = await collectSiteFiles(siteDir);
    expect(files.map((f) => f.rel)).toEqual([join('about', 'index.html'), 'index.html']);
  });
});

describe('archiveSite', () => {
  it('produces a zip containing every built file', async () => {
    const archive = await archiveSite(siteDir);
    const zip = await JSZip.loadAsync(await readFile(archive.path));
    expect(Object.keys(zip.files).sort()).toContain('index.html');
    const home = await zip.file('index.html')!.async('string');
    expect(home).toContain('Home');
    const about = await zip.file('about/index.html')!.async('string');
    expect(about).toContain('About');
  });
});

describe('DeployConfigSchema', () => {
  it('parses a valid config and defaults remoteDir', () => {
    const cfg = DeployConfigSchema.parse({ protocol: 'sftp', host: 'h', user: 'u', password: 'p' });
    expect(cfg.remoteDir).toBe('/');
  });
  it('rejects an unknown protocol and a control-char remoteDir', () => {
    expect(() => DeployConfigSchema.parse({ protocol: 'scp', host: 'h', user: 'u', password: 'p' })).toThrow();
    expect(() =>
      DeployConfigSchema.parse({ protocol: 'ftp', host: 'h', user: 'u', password: 'p', remoteDir: '/x\n/y' }),
    ).toThrow();
  });

  it('accepts SFTP key auth (private key + optional passphrase, password optional)', () => {
    const cfg = DeployConfigSchema.parse({
      protocol: 'sftp',
      host: 'h',
      user: 'u',
      privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----',
      passphrase: 'pp',
    });
    expect(cfg.privateKey).toContain('BEGIN');
    expect(cfg.password).toBeUndefined();
  });
  it('rejects a private key on a non-SFTP protocol', () => {
    expect(() =>
      DeployConfigSchema.parse({ protocol: 'ftp', host: 'h', user: 'u', password: 'p', privateKey: 'k' }),
    ).toThrow(/private key requires.*SFTP/i);
  });
  it('requires at least a password or a private key', () => {
    expect(() => DeployConfigSchema.parse({ protocol: 'sftp', host: 'h', user: 'u' })).toThrow(/password or a private key/i);
  });
  it('accepts useRsync for sftp (with a non-root remoteDir) and rejects it for a non-SSH protocol', () => {
    expect(DeployConfigSchema.parse({ protocol: 'sftp', host: 'h', user: 'u', password: 'p', useRsync: true, remoteDir: '/web' }).useRsync).toBe(true);
    expect(() => DeployConfigSchema.parse({ protocol: 'ftp', host: 'h', user: 'u', password: 'p', useRsync: true, remoteDir: '/web' })).toThrow(/rsync.*SFTP/i);
  });

  it('hardens host + user against ssh argument injection (leading "-", metachars, whitespace)', () => {
    const ok = { protocol: 'sftp' as const, user: 'u', password: 'p' };
    expect(() => DeployConfigSchema.parse({ ...ok, host: '-oProxyCommand=touch /tmp/x' })).toThrow(/host/i);
    expect(() => DeployConfigSchema.parse({ ...ok, host: 'evil.com/../x' })).toThrow(/host/i);
    expect(() => DeployConfigSchema.parse({ ...ok, host: 'a b' })).toThrow(/host/i);
    expect(() => DeployConfigSchema.parse({ protocol: 'sftp', host: 'h', user: '-oProxyCommand=x', password: 'p' })).toThrow(/user/i);
    // Real hostnames / IPv4 / IPv6 still pass.
    for (const host of ['files.staging.phoenix-host.net', '10.0.0.5', '2001:db8::1', 'h']) {
      expect(DeployConfigSchema.parse({ ...ok, host }).host).toBe(host);
    }
  });

  it('rsync ALLOWS a root remoteDir — unless it would also PRUNE it', () => {
    const base = { protocol: 'sftp' as const, host: 'h', user: 'u', password: 'p', useRsync: true };
    // ★ Root used to be refused outright, which made rsync unusable for every account already chrooted
    // to its own web root — the common shared-hosting shape, where "/" IS the site and where the SFTP
    // transport has always been happy. The hazard was never the PATH, it was root + --delete.
    expect(() => DeployConfigSchema.parse(base)).toThrow(/deletes every remote file/i);
    expect(() => DeployConfigSchema.parse({ ...base, remoteDir: '/' })).toThrow(/deletes every remote file/i);
    // Either half defuses it: stop pruning…
    expect(DeployConfigSchema.parse({ ...base, remoteDir: '/', rsyncDelete: false }).remoteDir).toBe('/');
    // …or say plainly that mirroring the whole root is the intent.
    expect(DeployConfigSchema.parse({ ...base, remoteDir: '/', rsyncRootDeleteAck: true }).remoteDir).toBe('/');
    // A non-root directory prunes by default, as before.
    expect(DeployConfigSchema.parse({ ...base, remoteDir: '/var/www/site' }).useRsync).toBe(true);
    // A SHA-256 fingerprint can't be enforced by ssh → rejected (no silent TOFU downgrade).
    expect(() => DeployConfigSchema.parse({ ...base, remoteDir: '/web', hostFingerprint: 'aa:bb:cc:dd' })).toThrow(/known_hosts/i);
    // A real known_hosts line (has whitespace) is accepted.
    expect(DeployConfigSchema.parse({ ...base, remoteDir: '/web', hostFingerprint: 'h ssh-ed25519 AAAAC3Nza' }).useRsync).toBe(true);
  });
});

describe('defaultTransport', () => {
  it('selects the SFTP transport only for the sftp protocol', () => {
    const base = { host: 'h', user: 'u', password: 'p', remoteDir: '/' };
    expect(defaultTransport({ ...base, protocol: 'sftp' }).constructor.name).toBe('SftpTransport');
    expect(defaultTransport({ ...base, protocol: 'ftp' }).constructor.name).toBe('FtpTransport');
    expect(defaultTransport({ ...base, protocol: 'ftps' }).constructor.name).toBe('FtpTransport');
  });
});

/** A recording fake transport for the orchestration tests. */
function makeFake(opts: { prev?: DeployManifest | null } = {}) {
  const calls: string[] = [];
  const uploads: Array<{ rels: string[] }> = [];
  let removed: string[] = [];
  const written: DeployManifest[] = [];
  const transport: DeployTransport = {
    connect: async () => void calls.push('connect'),
    readManifest: async () => {
      calls.push('read');
      return opts.prev ?? null;
    },
    writeManifest: async (_remote, manifest) => {
      calls.push('write');
      written.push(manifest);
    },
    upload: async (_remote, files: ReadonlyArray<SiteFile>, onFile, onDir) => {
      calls.push('upload');
      const rels = files.map((f) => f.rel.split(/[\\/]/).join('/'));
      uploads.push({ rels });
      // Model the real transports: the remote directory tree is created BEFORE any file moves.
      const dirs = [...new Set(rels.map((r) => r.split('/').slice(0, -1).join('/')).filter(Boolean))];
      onDir?.(0, dirs.length);
      dirs.forEach((_d, i) => onDir?.(i + 1, dirs.length));
      rels.forEach((r) => onFile?.(r));
    },
    remove: async (_remote, rels) => {
      calls.push('remove');
      removed = [...rels];
    },
    close: async () => void calls.push('close'),
  };
  return { transport, calls, uploads, written, getRemoved: () => removed };
}

describe('deploySite (incremental orchestration via fake transport)', () => {
  const cfg = { protocol: 'sftp', host: 'h', user: 'u', password: 'p', remoteDir: '/var/www' } as const;

  it('first deploy (no prior manifest): uploads every file, writes the manifest, closes', async () => {
    const fake = makeFake({ prev: null });
    const result = await deploySite(siteDir, cfg, () => fake.transport);
    expect(fake.calls).toEqual(['connect', 'read', 'upload', 'write', 'close']);
    expect(fake.uploads[0]!.rels).toEqual(['about/index.html', 'index.html']);
    expect(result.uploaded).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.removed).toBe(0);
    expect(result.files).toBe(2);
    expect(fake.written[0]).toHaveProperty('index.html');
  });

  it('re-deploy with an identical manifest skips every file (no upload call)', async () => {
    const files = await collectSiteFiles(siteDir);
    const prev = await computeManifest(files);
    const fake = makeFake({ prev });
    const result = await deploySite(siteDir, cfg, () => fake.transport);
    expect(fake.calls).toEqual(['connect', 'read', 'write', 'close']); // no 'upload'
    expect(result.uploaded).toBe(0);
    expect(result.skipped).toBe(2);
  });

  it('uploads only the content-changed file', async () => {
    const files = await collectSiteFiles(siteDir);
    const prev = await computeManifest(files);
    prev['index.html'] = { size: 1, hash: 'a'.repeat(64) }; // stale hash → changed
    const fake = makeFake({ prev });
    const result = await deploySite(siteDir, cfg, () => fake.transport);
    expect(fake.uploads[0]!.rels).toEqual(['index.html']);
    expect(result.uploaded).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('prunes files present in the prior manifest but gone from the build', async () => {
    const files = await collectSiteFiles(siteDir);
    const prev = await computeManifest(files);
    prev['gone.html'] = { size: 3, hash: 'b'.repeat(64) };
    const fake = makeFake({ prev });
    const result = await deploySite(siteDir, cfg, () => fake.transport);
    expect(fake.getRemoved()).toEqual(['gone.html']);
    expect(result.removed).toBe(1);
    expect(fake.calls).toContain('remove');
  });

  it('opts.incremental=false forces a full re-upload even with a matching manifest', async () => {
    const files = await collectSiteFiles(siteDir);
    const prev = await computeManifest(files);
    const fake = makeFake({ prev });
    const result = await deploySite(siteDir, cfg, () => fake.transport, undefined, { incremental: false });
    expect(fake.calls).not.toContain('read'); // manifest not consulted
    expect(result.uploaded).toBe(2);
    expect(result.skipped).toBe(0);
  });

  it('streams connecting → checking → uploading (with strategy/skipped/bytes) → done progress', async () => {
    const events: DeployProgress[] = [];
    const fake = makeFake({ prev: null });
    await deploySite(siteDir, cfg, () => fake.transport, (e) => events.push(e));
    expect(events.map((e) => e.phase).filter((p) => p !== 'preparing')).toEqual([
      'connecting', 'checking', 'uploading', 'uploading', 'uploading', 'done',
    ]);
    const done = events.at(-1)!;
    expect(done.index).toBe(done.total);
    expect(done.strategy).toBe('files');
    expect(done.skipped).toBe(0);
    expect(done.bytes).toBeGreaterThan(0);
    // Per-file uploading events carry the filename + cumulative bytes.
    const fileEvents = events.filter((e) => e.phase === 'uploading' && e.file);
    expect(fileEvents.map((e) => e.file)).toEqual(['about/index.html', 'index.html']);
    expect(fileEvents.at(-1)!.bytes).toBe(done.bytes);
  });

  it('reports the DIRECTORY pass, which runs before any file moves', async () => {
    // ★ THE REPORTED BUG. Creating the remote tree used to emit nothing at all, so the UI sat on
    // "Uploading 0/N" for the whole pass. Measured against a real target where one round trip costs
    // ~1s, a 106-directory site was frozen for ~1m45s — long enough for a reverse proxy to reap the
    // idle SSE stream, after which the deploy finished server-side and the browser never found out.
    const events: DeployProgress[] = [];
    const fake = makeFake({ prev: null });
    await deploySite(siteDir, cfg, () => fake.transport, (e) => events.push(e));
    const preparing = events.filter((e) => e.phase === 'preparing');
    expect(preparing.length).toBeGreaterThan(0);
    // It carries its OWN denominator — the file total says nothing about how far the tree pass is.
    expect(preparing.at(-1)!.dirs).toBe(preparing.at(-1)!.dirTotal);
    // …and it lands BEFORE the first byte of any file.
    expect(events.findIndex((e) => e.phase === 'preparing')).toBeLessThan(events.findIndex((e) => e.file !== undefined));
  });

  it('the bar starts partly filled (index = skipped) on an incremental deploy', async () => {
    const files = await collectSiteFiles(siteDir);
    const prev = await computeManifest(files);
    prev['index.html'] = { size: 1, hash: 'c'.repeat(64) }; // 1 of 2 changed → 1 skipped
    const events: DeployProgress[] = [];
    const fake = makeFake({ prev });
    await deploySite(siteDir, cfg, () => fake.transport, (e) => events.push(e));
    const firstUploading = events.find((e) => e.phase === 'uploading')!;
    expect(firstUploading.index).toBe(1); // skipped=1 counted as done
    expect(firstUploading.skipped).toBe(1);
  });

  it('still closes the transport when the upload fails', async () => {
    let closed = false;
    const fake: DeployTransport = {
      connect: async () => {},
      readManifest: async () => null,
      writeManifest: async () => {},
      upload: async () => {
        throw new Error('network down');
      },
      remove: async () => {},
      close: async () => {
        closed = true;
      },
    };
    await expect(deploySite(siteDir, { ...cfg, protocol: 'ftp' }, () => fake)).rejects.toThrow('network down');
    expect(closed).toBe(true);
  });
});
