import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import {
  DeployConfigSchema,
  archiveSite,
  collectSiteFiles,
  defaultTransport,
  deploySite,
  type DeployTransport,
  type DeployProgress,
} from '../src/publish/adapters.js';

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
    const buf = await archiveSite(siteDir);
    const zip = await JSZip.loadAsync(buf);
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
});

describe('defaultTransport', () => {
  it('selects the SFTP transport only for the sftp protocol', () => {
    const base = { host: 'h', user: 'u', password: 'p', remoteDir: '/' };
    expect(defaultTransport({ ...base, protocol: 'sftp' }).constructor.name).toBe('SftpTransport');
    expect(defaultTransport({ ...base, protocol: 'ftp' }).constructor.name).toBe('FtpTransport');
    expect(defaultTransport({ ...base, protocol: 'ftps' }).constructor.name).toBe('FtpTransport');
  });
});

describe('deploySite (orchestration via fake transport)', () => {
  it('connects, uploads the dir, and always closes', async () => {
    const calls: string[] = [];
    const fake: DeployTransport = {
      connect: async () => void calls.push('connect'),
      uploadDir: async (local, remote) => void calls.push(`upload:${remote}`),
      close: async () => void calls.push('close'),
    };
    const result = await deploySite(
      siteDir,
      { protocol: 'sftp', host: 'h', user: 'u', password: 'p', remoteDir: '/var/www' },
      () => fake,
    );
    expect(calls).toEqual(['connect', 'upload:/var/www', 'close']);
    expect(result).toEqual({ protocol: 'sftp', files: 2 });
  });

  it('streams connecting → per-file uploading → done progress', async () => {
    const events: DeployProgress[] = [];
    const fake: DeployTransport = {
      connect: async () => {},
      uploadDir: async (_local, _remote, onFile) => {
        onFile?.('index.html');
        onFile?.('about/index.html');
      },
      close: async () => {},
    };
    await deploySite(
      siteDir,
      { protocol: 'sftp', host: 'h', user: 'u', password: 'p', remoteDir: '/' },
      () => fake,
      (e) => events.push(e),
    );
    expect(events.map((e) => `${e.phase}:${e.index}/${e.total}`)).toEqual([
      'connecting:0/2',
      'uploading:0/2',
      'uploading:1/2',
      'uploading:2/2',
      'done:2/2',
    ]);
    expect(events.find((e) => e.index === 1)?.file).toBe('index.html');
  });

  it('still closes the transport when the upload fails', async () => {
    let closed = false;
    const fake: DeployTransport = {
      connect: async () => {},
      uploadDir: async () => {
        throw new Error('network down');
      },
      close: async () => {
        closed = true;
      },
    };
    await expect(
      deploySite(siteDir, { protocol: 'ftp', host: 'h', user: 'u', password: 'p', remoteDir: '/' }, () => fake),
    ).rejects.toThrow('network down');
    expect(closed).toBe(true);
  });
});
