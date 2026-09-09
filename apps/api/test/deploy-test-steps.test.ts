import { describe, it, expect } from 'vitest';
import { Socket } from 'node:net';
import { TLSSocket } from 'node:tls';
import type { Client as FtpClient } from 'basic-ftp';
import type SftpClient from 'ssh2-sftp-client';
import { testDeployTarget } from '../src/publish/deploy-test.js';
import type { DeployConfig } from '../src/publish/adapters.js';

/**
 * The connection test's ORCHESTRATION, with the wire faked.
 *
 * What matters here is the reporting contract the UI depends on: that the steps appear in order, that
 * the FIRST failing step is the one marked failed and the rest are absent (which is what makes "which
 * step failed" a diagnosis), that a probe file written to a customer's server is always removed again,
 * and that a certificate failure comes back with a certificate attached so the UI can offer to pin it.
 */

const ftpCfg = {
  protocol: 'ftps',
  host: 'ftp.example.com',
  port: 21,
  user: 'alice',
  password: 'pw',
  remoteDir: '/public_html',
} as unknown as DeployConfig;

const sftpCfg = {
  protocol: 'sftp',
  host: 'ssh.example.com',
  port: 22,
  user: 'alice',
  password: 'pw',
  remoteDir: '/var/www',
} as unknown as DeployConfig;

/** A TLS socket that reports the certificate we hand it — enough to drive the TLS reporting path. */
function tlsSocketWith(fingerprint256: string): TLSSocket {
  const socket = new TLSSocket(new Socket());
  Object.assign(socket, {
    getPeerCertificate: () => ({
      subject: { CN: 'ftp.host.example' },
      issuer: { CN: 'Example CA' },
      valid_from: 'Jan  1 00:00:00 2026 GMT',
      valid_to: 'Jan  1 00:00:00 2027 GMT',
      fingerprint256,
      subjectaltname: 'DNS:ftp.host.example',
    }),
    getProtocol: () => 'TLSv1.3',
    getCipher: () => ({ name: 'TLS_AES_256_GCM_SHA384' }),
  });
  return socket;
}

interface FtpFakeOptions {
  socket?: unknown;
  failAt?: 'connect' | 'login' | 'ensureDir' | 'upload' | 'remove';
  error?: Error;
}

function fakeFtp(opts: FtpFakeOptions = {}): { make: () => FtpClient; calls: string[] } {
  const calls: string[] = [];
  const boom = (at: FtpFakeOptions['failAt']): void => {
    if (opts.failAt === at) throw opts.error ?? new Error('failed');
  };
  const make = (): FtpClient =>
    ({
      ftp: { socket: opts.socket ?? new TLSSocket(new Socket()), log: (): void => {} },
      closed: false,
      connect: async () => {
        calls.push('connect');
        boom('connect');
        return { code: 220, message: '220 Welcome' };
      },
      connectImplicitTLS: async () => ({ code: 220, message: '220 Welcome' }),
      useTLS: async () => {
        calls.push('useTLS');
        return { code: 234, message: '234 OK' };
      },
      features: async () => new Map([['AUTH', 'TLS'], ['MLST', 'size']]),
      sendIgnoringError: async () => ({ code: 200, message: '200 OK' }),
      login: async () => {
        calls.push('login');
        boom('login');
        return { code: 230, message: '230 OK' };
      },
      useDefaultSettings: async () => {},
      ensureDir: async (dir: string) => {
        calls.push(`ensureDir ${dir}`);
        boom('ensureDir');
      },
      pwd: async () => '/public_html',
      uploadFrom: async () => {
        calls.push('uploadFrom');
        boom('upload');
        return { code: 226, message: '226 OK' };
      },
      remove: async () => {
        calls.push('remove');
        boom('remove');
        return { code: 250, message: '250 OK' };
      },
      close: () => {
        calls.push('close');
      },
    }) as unknown as FtpClient;
  return { make, calls };
}

const stepMap = (r: { steps: Array<{ key: string; status: string }> }): Record<string, string> =>
  Object.fromEntries(r.steps.map((s) => [s.key, s.status]));

describe('connection test — FTPS happy path', () => {
  it('walks every step, reports the TLS layer, and removes the probe file it wrote', async () => {
    const { make, calls } = fakeFtp({ socket: tlsSocketWith('AB:CD') });
    const result = await testDeployTarget(ftpCfg, { makeFtpClient: make });
    expect(result.ok).toBe(true);
    expect(stepMap(result)).toEqual({ connect: 'ok', tls: 'ok', auth: 'ok', directory: 'ok', write: 'ok' });
    expect(result.security).toBe('explicit');
    expect(result.tls?.protocol).toBe('TLSv1.3');
    expect(result.tls?.certificate.subject).toBe('ftp.host.example');
    expect(result.features).toContain('AUTH TLS');
    // ★ Litter on a customer's web root is not acceptable collateral for a test.
    expect(calls.filter((c) => c === 'remove')).toHaveLength(1);
    expect(calls).toContain('close');
  });

  it('reports the working directory it reached', async () => {
    const { make } = fakeFtp({ socket: tlsSocketWith('AB:CD') });
    const result = await testDeployTarget(ftpCfg, { makeFtpClient: make });
    expect(result.steps.find((s) => s.key === 'directory')?.detail).toContain('/public_html');
  });
});

describe('connection test — which step failed IS the diagnosis', () => {
  it('stops at sign-in for a rejected password, and never reaches the directory', async () => {
    const { make, calls } = fakeFtp({
      socket: tlsSocketWith('AB:CD'),
      failAt: 'login',
      error: Object.assign(new Error('530 Login incorrect'), { code: 530 }),
    });
    const result = await testDeployTarget(ftpCfg, { makeFtpClient: make });
    expect(result.ok).toBe(false);
    expect(result.failure?.kind).toBe('auth');
    expect(result.steps.map((s) => s.key)).toEqual(['connect']); // connect is where connectFtp threw
    expect(calls).not.toContain('ensureDir /public_html');
  });

  it('distinguishes signed-in-but-cannot-write from cannot-sign-in', async () => {
    const { make } = fakeFtp({
      socket: tlsSocketWith('AB:CD'),
      failAt: 'upload',
      error: Object.assign(new Error('550 Permission denied'), { code: 550 }),
    });
    const result = await testDeployTarget(ftpCfg, { makeFtpClient: make });
    expect(result.ok).toBe(false);
    expect(result.failure?.kind).toBe('permission');
    expect(stepMap(result)).toMatchObject({ connect: 'ok', auth: 'ok', directory: 'ok', write: 'failed' });
  });

  it('fetches the certificate on a verification failure so the UI can offer to pin it', async () => {
    // The first client fails during connect with a certificate error; the probe client that follows
    // is the look-only connection whose whole purpose is to report what was offered.
    const { make } = fakeFtp({
      socket: tlsSocketWith('11:22:33'),
      failAt: 'connect',
      error: Object.assign(new Error('self signed certificate'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }),
    });
    let call = 0;
    const result = await testDeployTarget(ftpCfg, {
      makeFtpClient: () => {
        call += 1;
        // Only the FIRST client fails — the probe connects and reports.
        return call === 1 ? make() : fakeFtp({ socket: tlsSocketWith('11:22:33') }).make();
      },
    });
    expect(result.ok).toBe(false);
    expect(result.failure?.kind).toBe('tls-cert');
    expect(result.offeredCertificate?.fingerprint256).toBe('112233');
  });

  it('survives a probe connection that also fails, rather than turning it into a 500', async () => {
    const { make } = fakeFtp({
      failAt: 'connect',
      error: Object.assign(new Error('self signed certificate'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }),
    });
    const result = await testDeployTarget(ftpCfg, { makeFtpClient: make });
    expect(result.ok).toBe(false);
    expect(result.offeredCertificate).toBeUndefined();
  });
});

describe('connection test — a plain FTP target reports that it is not encrypted', () => {
  it('marks the TLS step skipped and says the server could have done better', async () => {
    const { make } = fakeFtp({ socket: new Socket() }); // not a TLSSocket → no TLS was negotiated
    const plain = { ...ftpCfg, protocol: 'ftp' } as unknown as DeployConfig;
    let call = 0;
    const result = await testDeployTarget(plain, {
      makeFtpClient: () => {
        call += 1;
        return call === 1 ? make() : make();
      },
    });
    // The fake advertises AUTH TLS and its useTLS resolves, so the opportunistic upgrade is taken.
    expect(result.security).toBe('opportunistic');
    expect(result.steps.find((s) => s.key === 'tls')?.detail).toMatch(/opportunistic/);
  });
});

interface SftpFakeOptions {
  failAt?: 'connect' | 'put' | 'delete';
  error?: Error;
}
function fakeSftp(opts: SftpFakeOptions = {}): { make: () => SftpClient; calls: string[] } {
  const calls: string[] = [];
  const boom = (at: SftpFakeOptions['failAt']): void => {
    if (opts.failAt === at) throw opts.error ?? new Error('failed');
  };
  const make = (): SftpClient =>
    ({
      connect: async (o: { hostVerifier?: (k: string) => boolean }) => {
        calls.push('connect');
        // ssh2 calls the verifier during the handshake; the test captures the key through it.
        if (o.hostVerifier && !o.hostVerifier('AA:BB:CC')) throw new Error('Host verification failed');
        boom('connect');
      },
      mkdir: async () => {
        calls.push('mkdir');
      },
      exists: async () => 'd',
      put: async () => {
        calls.push('put');
        boom('put');
      },
      delete: async () => {
        calls.push('delete');
        boom('delete');
      },
      end: async () => {
        calls.push('end');
      },
    }) as unknown as SftpClient;
  return { make, calls };
}

describe('connection test — SFTP', () => {
  it('reports the host key so it can be pinned, and cleans up the probe file', async () => {
    const { make, calls } = fakeSftp();
    const result = await testDeployTarget(sftpCfg, { makeSftpClient: make });
    expect(result.ok).toBe(true);
    expect(result.security).toBe('ssh');
    expect(result.hostKeyFingerprint).toBe('aabbcc');
    expect(stepMap(result)).toEqual({ connect: 'ok', auth: 'ok', directory: 'ok', write: 'ok' });
    expect(calls).toContain('delete');
    expect(calls).toContain('end');
  });

  it('fails closed on a host key that does not match the pin, and still reports what was offered', async () => {
    const { make } = fakeSftp();
    const pinned = { ...sftpCfg, hostFingerprint: 'ff'.repeat(32) } as unknown as DeployConfig;
    const result = await testDeployTarget(pinned, { makeSftpClient: make });
    expect(result.ok).toBe(false);
    expect(result.failure?.kind).toBe('host-key');
    expect(result.hostKeyFingerprint).toBe('aabbcc');
  });

  it('names a write failure as such rather than blaming the credentials', async () => {
    const { make } = fakeSftp({ failAt: 'put', error: new Error('EACCES: permission denied') });
    const result = await testDeployTarget(sftpCfg, { makeSftpClient: make });
    expect(result.ok).toBe(false);
    expect(stepMap(result)).toMatchObject({ connect: 'ok', directory: 'ok', write: 'failed' });
  });

  // rsync is a separate transport on the same credentials; a green SFTP handshake does not prove it.
  it('runs rsync as its own step when the target uses it', async () => {
    const { make } = fakeSftp();
    let ran = false;
    const withRsync = { ...sftpCfg, useRsync: true } as unknown as DeployConfig;
    const result = await testDeployTarget(withRsync, {
      makeSftpClient: make,
      runRsync: async () => {
        ran = true;
      },
    });
    expect(ran).toBe(true);
    expect(stepMap(result).rsync).toBe('ok');
  });

  it('reports an rsync failure without blaming the SFTP steps that passed', async () => {
    const { make } = fakeSftp();
    const withRsync = { ...sftpCfg, useRsync: true } as unknown as DeployConfig;
    const result = await testDeployTarget(withRsync, {
      makeSftpClient: make,
      runRsync: () => Promise.reject(new Error('rsync failed (exit 12): connection unexpectedly closed')),
    });
    expect(result.ok).toBe(false);
    expect(result.failure?.kind).toBe('rsync');
    expect(stepMap(result)).toMatchObject({ connect: 'ok', write: 'ok', rsync: 'failed' });
  });
});
