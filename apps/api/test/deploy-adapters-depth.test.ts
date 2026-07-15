import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import {
  DeployConfigSchema,
  archiveSite,
  collectSiteFiles,
  deploySite,
  type DeployConfig,
  type DeployManifest,
  type DeployStrategy,
  type DeployTransport,
  type SiteFile,
} from '../src/publish/adapters.js';
import { remoteJoin } from '../src/publish/deploy/plan.js';

/**
 * Depth coverage for the publish ADAPTERS (zip archive + transport orchestration
 * + deploy config). EXTENDS apps/api/test/publish-adapters.test.ts — mirrors its
 * setup (a temp built-site dir + an injected fake transport) but does NOT repeat
 * its assertions. Focus here is on the gaps: nested/binary archive fidelity,
 * empty-dir archives, exact per-file remote upload paths, connect-error cleanliness,
 * and the DeployConfigSchema edge cases the original test omits.
 */

// A richer built site than the original test: a binary-ish nested media asset,
// a nested page, and a root file. Lets us assert relative-path + content fidelity.
let siteDir: string;
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
const ROOT_HTML = '<!doctype html><h1>Home</h1>';
const ABOUT_HTML = '<!doctype html><h1>About</h1>';
const CSS_TEXT = 'body{margin:0}';

beforeEach(async () => {
  siteDir = await mkdtemp(join(tmpdir(), 'sw-adapters-depth-'));
  await writeFile(join(siteDir, 'index.html'), ROOT_HTML);
  await mkdir(join(siteDir, 'about'), { recursive: true });
  await writeFile(join(siteDir, 'about', 'index.html'), ABOUT_HTML);
  await mkdir(join(siteDir, 'assets'), { recursive: true });
  await writeFile(join(siteDir, 'assets', 'style.css'), CSS_TEXT);
  await mkdir(join(siteDir, 'media', 'abc123'), { recursive: true });
  await writeFile(join(siteDir, 'media', 'abc123', 'x.jpg'), JPEG_BYTES);
});
afterEach(async () => {
  await rm(siteDir, { recursive: true, force: true });
});

/** Builds a minimal valid DeployConfig, overridable per-test. */
function makeConfig(overrides: Partial<DeployConfig> = {}): DeployConfig {
  return DeployConfigSchema.parse({
    protocol: 'sftp',
    host: 'example.test',
    user: 'u',
    password: 'p',
    remoteDir: '/var/www',
    ...overrides,
  });
}

describe('archiveSite — zip fidelity (depth)', () => {
  it('packs every file at its correct nested relative path (forward-slash, no leading slash)', async () => {
    const buf = await archiveSite(siteDir);
    const zip = await JSZip.loadAsync(buf);

    // Compare against the canonical file list the archiver itself walks.
    const collected = await collectSiteFiles(siteDir);
    const expectedEntries = collected.map((f) => f.rel.split(/[\\/]/).join('/')).sort();

    // jszip stores only file entries here (no synthetic dir entries from zip.file()).
    const actualEntries = Object.values(zip.files)
      .filter((e) => !e.dir)
      .map((e) => e.name)
      .sort();

    expect(actualEntries).toEqual(expectedEntries);
    // Nested media + page paths must be present, with POSIX separators and no leading '/'.
    expect(actualEntries).toContain('media/abc123/x.jpg');
    expect(actualEntries).toContain('about/index.html');
    expect(actualEntries).toContain('assets/style.css');
    for (const name of actualEntries) {
      expect(name.startsWith('/')).toBe(false);
      expect(name.includes('\\')).toBe(false);
    }
  });

  it('preserves exact text and binary contents through the zip round-trip', async () => {
    const buf = await archiveSite(siteDir);
    const zip = await JSZip.loadAsync(buf);

    expect(await zip.file('index.html')!.async('string')).toBe(ROOT_HTML);
    expect(await zip.file('about/index.html')!.async('string')).toBe(ABOUT_HTML);
    expect(await zip.file('assets/style.css')!.async('string')).toBe(CSS_TEXT);

    // Binary fidelity: bytes must be identical, not re-encoded as text.
    const jpg = await zip.file('media/abc123/x.jpg')!.async('uint8array');
    expect(Buffer.from(jpg).equals(JPEG_BYTES)).toBe(true);
  });

  it('produces a valid, empty zip for an empty site dir', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'sw-adapters-empty-'));
    try {
      const buf = await archiveSite(empty);
      expect(buf.length).toBeGreaterThan(0); // a valid (empty) zip still has an EOCD record
      const zip = await JSZip.loadAsync(buf);
      const fileEntries = Object.values(zip.files).filter((e) => !e.dir);
      expect(fileEntries).toHaveLength(0);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});

describe('deploySite — per-file upload paths via a recording transport', () => {
  /**
   * The DeployTransport model hands the orchestrator a single upload() call carrying the CHANGED
   * files; the transport maps each to `remoteDir + relativePath` internally. This recording fake
   * derives the same remote paths via the pure remoteJoin helper, so we can assert every file —
   * nested dirs preserved — lands where it should on a first (full) deploy.
   */
  function makeRecordingTransport(prev: DeployManifest | null = null) {
    const lifecycle: string[] = [];
    const uploads: Array<{ remotePath: string; strategy: DeployStrategy }> = [];
    let connects = 0;
    const transport: DeployTransport = {
      connect: async () => {
        connects += 1;
        lifecycle.push('connect');
      },
      capabilities: () => ({ tar: false }),
      readManifest: async () => prev,
      writeManifest: async () => void lifecycle.push('write'),
      upload: async (remoteDir, files: ReadonlyArray<SiteFile>, strategy) => {
        lifecycle.push('upload');
        for (const f of files) {
          uploads.push({ remotePath: remoteJoin(remoteDir, f.rel.split(/[\\/]/).join('/')), strategy });
        }
      },
      remove: async () => {},
      close: async () => void lifecycle.push('close'),
    };
    return { transport, lifecycle, uploads, connectCount: () => connects };
  }

  it('connects once, uploads every file to remoteDir + relativePath (nested preserved), then disconnects', async () => {
    const rec = makeRecordingTransport();
    const result = await deploySite(siteDir, makeConfig({ remoteDir: '/var/www' }), () => rec.transport);

    expect(rec.connectCount()).toBe(1);
    // connect → upload the changed set → write the manifest → close (best-effort, last).
    expect(rec.lifecycle).toEqual(['connect', 'upload', 'write', 'close']);

    const collected = await collectSiteFiles(siteDir);
    const expectedRemotePaths = collected.map((f) => `/var/www/${f.rel.split(/[\\/]/).join('/')}`).sort();
    expect(rec.uploads.map((u) => u.remotePath).sort()).toEqual(expectedRemotePaths);

    // Nested dirs preserved explicitly.
    expect(rec.uploads.map((u) => u.remotePath)).toContain('/var/www/media/abc123/x.jpg');
    expect(rec.uploads.map((u) => u.remotePath)).toContain('/var/www/about/index.html');

    expect(result.protocol).toBe('sftp');
    expect(result.files).toBe(collected.length);
    expect(result.uploaded).toBe(collected.length);
    expect(result.skipped).toBe(0);
  });

  it('reports the same file count via the returned summary as on disk', async () => {
    const rec = makeRecordingTransport();
    const result = await deploySite(siteDir, makeConfig(), () => rec.transport);
    const collected = await collectSiteFiles(siteDir);
    expect(result.files).toBe(collected.length);
    // 4 built files: index.html, about/index.html, assets/style.css, media/abc123/x.jpg
    expect(result.files).toBe(4);
  });

  it('rejects cleanly on a transport CONNECT error — never uploads, no partial-state leak, still closes', async () => {
    const lifecycle: string[] = [];
    let uploadCalled = false;
    const fake: DeployTransport = {
      connect: async () => {
        lifecycle.push('connect');
        throw new Error('connection refused');
      },
      capabilities: () => ({ tar: false }),
      readManifest: async () => null,
      writeManifest: async () => {},
      upload: async () => {
        uploadCalled = true;
        lifecycle.push('upload');
      },
      remove: async () => {},
      close: async () => {
        lifecycle.push('close');
      },
    };

    await expect(deploySite(siteDir, makeConfig(), () => fake)).rejects.toThrow('connection refused');
    // Upload must never run after a failed connect; close still runs (finally).
    expect(uploadCalled).toBe(false);
    expect(lifecycle).toEqual(['connect', 'close']);
  });

  it('does not let a close() failure mask a successful upload (best-effort close is swallowed)', async () => {
    const fake: DeployTransport = {
      connect: async () => {},
      capabilities: () => ({ tar: false }),
      readManifest: async () => null,
      writeManifest: async () => {},
      upload: async () => {},
      remove: async () => {},
      close: async () => {
        throw new Error('close blew up');
      },
    };
    // deploySite swallows close() errors via .catch(); upload succeeded so it resolves.
    const result = await deploySite(siteDir, makeConfig({ protocol: 'ftp' }), () => fake);
    expect(result.protocol).toBe('ftp');
  });
});

describe('DeployConfigSchema — edge cases (depth)', () => {
  const base = { host: 'h', user: 'u', password: 'p' };

  it('accepts exactly the three allowed protocols and rejects close look-alikes', () => {
    for (const protocol of ['ftp', 'ftps', 'sftp'] as const) {
      expect(DeployConfigSchema.parse({ ...base, protocol }).protocol).toBe(protocol);
    }
    for (const bad of ['scp', 'http', 'https', 'FTP', 'ssh', '']) {
      expect(() => DeployConfigSchema.parse({ ...base, protocol: bad })).toThrow();
    }
  });

  it('requires host and bounds its length (1..255)', () => {
    expect(() => DeployConfigSchema.parse({ ...base, protocol: 'ftp', host: '' })).toThrow();
    // 255 chars is the max allowed.
    expect(
      DeployConfigSchema.parse({ ...base, protocol: 'ftp', host: 'a'.repeat(255) }).host,
    ).toHaveLength(255);
    expect(() => DeployConfigSchema.parse({ ...base, protocol: 'ftp', host: 'a'.repeat(256) })).toThrow();
  });

  it('enforces the integer port range 1..65535 and treats port as optional', () => {
    // optional — absent is fine.
    expect(DeployConfigSchema.parse({ ...base, protocol: 'sftp' }).port).toBeUndefined();
    expect(DeployConfigSchema.parse({ ...base, protocol: 'sftp', port: 1 }).port).toBe(1);
    expect(DeployConfigSchema.parse({ ...base, protocol: 'sftp', port: 65535 }).port).toBe(65535);
    expect(() => DeployConfigSchema.parse({ ...base, protocol: 'sftp', port: 0 })).toThrow();
    expect(() => DeployConfigSchema.parse({ ...base, protocol: 'sftp', port: 65536 })).toThrow();
    expect(() => DeployConfigSchema.parse({ ...base, protocol: 'sftp', port: 22.5 })).toThrow();
    expect(() => DeployConfigSchema.parse({ ...base, protocol: 'sftp', port: -1 })).toThrow();
  });

  it('rejects remoteDir containing a ".." traversal segment (in any position)', () => {
    for (const dir of ['..', '../etc', '/var/../etc', '/a/b/..', 'foo/../bar']) {
      expect(() => DeployConfigSchema.parse({ ...base, protocol: 'sftp', remoteDir: dir })).toThrow(
        /\.\./,
      );
    }
    // ".." only as a substring of a segment (e.g. "..foo") is allowed — not a traversal.
    expect(DeployConfigSchema.parse({ ...base, protocol: 'sftp', remoteDir: '/a/..foo' }).remoteDir).toBe(
      '/a/..foo',
    );
  });

  it('rejects remoteDir containing control characters (NUL, tab, CR, DEL)', () => {
    for (const ch of [' ', '\t', '\r', '', '']) {
      expect(() =>
        DeployConfigSchema.parse({ ...base, protocol: 'sftp', remoteDir: `/var/www${ch}/x` }),
      ).toThrow(/control characters/);
    }
  });

  it('bounds remoteDir length (1..1024) and defaults to "/" when omitted', () => {
    expect(DeployConfigSchema.parse({ ...base, protocol: 'sftp' }).remoteDir).toBe('/');
    expect(() => DeployConfigSchema.parse({ ...base, protocol: 'sftp', remoteDir: '' })).toThrow();
    expect(
      DeployConfigSchema.parse({ ...base, protocol: 'sftp', remoteDir: '/'.concat('a'.repeat(1023)) })
        .remoteDir,
    ).toHaveLength(1024);
    expect(() =>
      DeployConfigSchema.parse({ ...base, protocol: 'sftp', remoteDir: 'a'.repeat(1025) }),
    ).toThrow();
  });

  it('treats hostFingerprint as optional and bounds it (1..256) when present', () => {
    expect(DeployConfigSchema.parse({ ...base, protocol: 'sftp' }).hostFingerprint).toBeUndefined();
    const fp = 'aa:bb:cc:dd';
    expect(DeployConfigSchema.parse({ ...base, protocol: 'sftp', hostFingerprint: fp }).hostFingerprint).toBe(
      fp,
    );
    expect(() => DeployConfigSchema.parse({ ...base, protocol: 'sftp', hostFingerprint: '' })).toThrow();
    expect(() =>
      DeployConfigSchema.parse({ ...base, protocol: 'sftp', hostFingerprint: 'a'.repeat(257) }),
    ).toThrow();
  });

  it('requires user and password and bounds password length (1..1024)', () => {
    expect(() => DeployConfigSchema.parse({ host: 'h', protocol: 'ftp', user: '', password: 'p' })).toThrow();
    expect(() => DeployConfigSchema.parse({ host: 'h', protocol: 'ftp', user: 'u', password: '' })).toThrow();
    expect(
      DeployConfigSchema.parse({ host: 'h', protocol: 'ftp', user: 'u', password: 'a'.repeat(1024) }).password,
    ).toHaveLength(1024);
    expect(() =>
      DeployConfigSchema.parse({ host: 'h', protocol: 'ftp', user: 'u', password: 'a'.repeat(1025) }),
    ).toThrow();
  });
});

describe('SFTP hostFingerprint pinning (verify-on-mismatch)', () => {
  it('flows the hostFingerprint from config into the transport factory', async () => {
    // We CAN assert the pinned fingerprint reaches the transport factory through
    // deploySite, even though the verify-on-mismatch decision itself is internal.
    const seen: Array<string | undefined> = [];
    const fake: DeployTransport = {
      connect: async () => {},
      capabilities: () => ({ tar: false }),
      readManifest: async () => null,
      writeManifest: async () => {},
      upload: async () => {},
      remove: async () => {},
      close: async () => {},
    };
    await deploySite(siteDir, makeConfig({ hostFingerprint: 'AB:cd:EF' }), (cfg) => {
      seen.push(cfg.hostFingerprint);
      return fake;
    });
    expect(seen).toEqual(['AB:cd:EF']);
  });

  it.skip('verifies the SFTP host key against the pinned fingerprint and rejects on mismatch', () => {
    // INFEASIBLE through the public API with a fake transport.
    //
    // The pinning logic lives in the private `makeHostVerifier(fingerprint)` closure
    // (adapters.ts), which is wired into ssh2-sftp-client's `hostVerifier` option ONLY
    // inside `SftpTransport.connect()` (the real, /* v8 ignore */-marked I/O shim).
    //
    // `deploySite` injects the transport via `makeTransport`, so a fake transport
    // REPLACES SftpTransport entirely and never constructs an ssh2 client — the
    // hostVerifier is never invoked. `makeHostVerifier` is not exported, and the task's
    // HARD CONSTRAINTS forbid modifying src to export it or to inject a key-comparison
    // hook. Verifying real verify-on-mismatch behavior would require either:
    //   (a) exporting `makeHostVerifier` (a src change — forbidden), or
    //   (b) a live SFTP server presenting a known/mismatched host key (no infra).
    // The adjacent test above asserts the fingerprint at least reaches the factory.
  });
});
