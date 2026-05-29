import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FtpSrv } from 'ftp-srv';
import { deploySite } from '../src/publish/adapters.js';

// A real in-process FTP server (ftp-srv) + the real basic-ftp transport, so the
// FTP deploy path is exercised end to end on loopback (no external infra).
const CONTROL_PORT = 50021;

let server: FtpSrv;
let serverRoot: string;
let siteDir: string;

beforeEach(async () => {
  serverRoot = await mkdtemp(join(tmpdir(), 'sw-ftp-root-'));
  siteDir = await mkdtemp(join(tmpdir(), 'sw-ftp-site-'));
  await writeFile(join(siteDir, 'index.html'), '<!doctype html><h1>FTP Home</h1>');
  await mkdir(join(siteDir, 'about'), { recursive: true });
  await writeFile(join(siteDir, 'about', 'index.html'), '<!doctype html><h1>FTP About</h1>');

  server = new FtpSrv({
    url: `ftp://127.0.0.1:${CONTROL_PORT}`,
    pasv_url: '127.0.0.1',
    pasv_min: 50100,
    pasv_max: 50120,
    anonymous: false,
  });
  server.on('login', ({ username, password }, resolve, reject) => {
    if (username === 'deployer' && password === 'secret') resolve({ root: serverRoot });
    else reject(new Error('bad credentials'));
  });
  await server.listen();
});

afterEach(async () => {
  await server.close();
  await rm(serverRoot, { recursive: true, force: true });
  await rm(siteDir, { recursive: true, force: true });
});

describe('FTP deploy (real ftp-srv + basic-ftp)', () => {
  it('uploads the built site to the server root', async () => {
    const result = await deploySite(siteDir, {
      protocol: 'ftp',
      host: '127.0.0.1',
      port: CONTROL_PORT,
      user: 'deployer',
      password: 'secret',
      remoteDir: '/',
    });
    expect(result).toEqual({ protocol: 'ftp', files: 2 });

    // The files actually landed on the server's filesystem.
    await expect(access(join(serverRoot, 'index.html'))).resolves.toBeUndefined();
    await expect(access(join(serverRoot, 'about', 'index.html'))).resolves.toBeUndefined();
  }, 20_000);

  it('rejects bad credentials', async () => {
    await expect(
      deploySite(siteDir, {
        protocol: 'ftp',
        host: '127.0.0.1',
        port: CONTROL_PORT,
        user: 'deployer',
        password: 'wrong',
        remoteDir: '/',
      }),
    ).rejects.toBeTruthy();
  }, 20_000);
});
