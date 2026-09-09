import { describe, it, expect } from 'vitest';
import { Socket } from 'node:net';
import { TLSSocket } from 'node:tls';
import type { Client as FtpClient } from 'basic-ftp';
import { advertisesAuthTls, captureTranscript, connectFtp, defaultFtpPort, probeFtpsCertificate } from '../src/publish/ftp-connect.js';

/**
 * A stand-in for basic-ftp's Client that records the ORDER of what it was asked to do. The order is
 * the property under test: a pinned certificate has to be checked while the connection still carries
 * nothing but a banner, so `login` must not appear in the trail after a pin failure.
 */
function fakeClient(opts: {
  features?: Map<string, string>;
  useTLS?: () => Promise<void>;
  closedAfterTlsFailure?: boolean;
  socket?: unknown;
} = {}): { client: FtpClient; trail: string[] } {
  const trail: string[] = [];
  let closed = false;
  const client = {
    ftp: { socket: opts.socket ?? {}, log: (): void => {} },
    get closed() {
      return closed;
    },
    connect: async (host: string, port: number) => {
      trail.push(`connect ${host}:${port}`);
      closed = false;
      return { code: 220, message: '220 Welcome' };
    },
    connectImplicitTLS: async (host: string, port: number) => {
      trail.push(`connectImplicitTLS ${host}:${port}`);
      return { code: 220, message: '220 Welcome (TLS)' };
    },
    useTLS: async () => {
      trail.push('useTLS');
      if (opts.useTLS) {
        closed = opts.closedAfterTlsFailure ?? false;
        await opts.useTLS();
      }
      return { code: 234, message: '234 AUTH TLS OK' };
    },
    features: async () => {
      trail.push('features');
      return opts.features ?? new Map<string, string>();
    },
    sendIgnoringError: async (cmd: string) => {
      trail.push(`send ${cmd}`);
      return { code: 200, message: '200 OK' };
    },
    login: async (user: string) => {
      trail.push(`login ${user}`);
      return { code: 230, message: '230 Logged in' };
    },
    useDefaultSettings: async () => {
      trail.push('useDefaultSettings');
    },
  } as unknown as FtpClient;
  return { client, trail };
}

const base = { host: 'ftp.example.com', user: 'alice', password: 'secret' } as const;

describe('defaultFtpPort', () => {
  it('is 990 only for implicit FTPS', () => {
    expect(defaultFtpPort('ftps', 'implicit')).toBe(990);
    expect(defaultFtpPort('ftps', 'explicit')).toBe(21);
    expect(defaultFtpPort('ftps', undefined)).toBe(21);
    expect(defaultFtpPort('ftp', undefined)).toBe(21);
  });
});

describe('advertisesAuthTls', () => {
  it('reads AUTH TLS / AUTH SSL out of a FEAT map, and says no when absent', () => {
    expect(advertisesAuthTls(new Map([['AUTH', 'TLS']]))).toBe(true);
    expect(advertisesAuthTls(new Map([['AUTH', 'SSL']]))).toBe(true);
    expect(advertisesAuthTls(new Map([['MLST', 'size']]))).toBe(false);
    // A bare "AUTH" line with no parameter still means the command exists.
    expect(advertisesAuthTls(new Map([['AUTH', '']]))).toBe(true);
  });
});

describe('connectFtp — FTPS', () => {
  it('upgrades with AUTH TLS before logging in (explicit mode)', async () => {
    const { client, trail } = fakeClient();
    const info = await connectFtp(client, { ...base, protocol: 'ftps' });
    expect(info.security).toBe('explicit');
    expect(info.port).toBe(21);
    expect(trail.indexOf('useTLS')).toBeLessThan(trail.indexOf('login alice'));
  });

  it('uses an implicit-TLS connection on 990 without sending AUTH TLS', async () => {
    const { client, trail } = fakeClient();
    const info = await connectFtp(client, { ...base, protocol: 'ftps', ftpsMode: 'implicit' });
    expect(info.security).toBe('implicit');
    expect(info.port).toBe(990);
    expect(trail).toContain('connectImplicitTLS ftp.example.com:990');
    expect(trail).not.toContain('useTLS');
  });

  // ★ THE ordering guarantee. Pinning turns off public-CA verification, so the pin check is the only
  // thing standing between the credentials and whatever answered the socket. If it ever ran after
  // login, a mismatched server would already have the password.
  it('refuses a pinned target before the password is sent', async () => {
    const { client, trail } = fakeClient();
    await expect(
      connectFtp(client, { ...base, protocol: 'ftps', certFingerprint: 'a'.repeat(64) }),
    ).rejects.toThrow();
    expect(trail.some((t) => t.startsWith('login'))).toBe(false);
  });
});

describe('connectFtp — plain FTP with opportunistic TLS', () => {
  it('upgrades when the server advertises AUTH TLS, and marks it unverified', async () => {
    const { client, trail } = fakeClient({ features: new Map([['AUTH', 'TLS']]) });
    const info = await connectFtp(client, { ...base, protocol: 'ftp' });
    expect(info.security).toBe('opportunistic');
    expect(trail.indexOf('useTLS')).toBeLessThan(trail.indexOf('login alice'));
  });

  it('stays plaintext when the server does not offer it, and says the server cannot', async () => {
    const { client, trail } = fakeClient({ features: new Map([['MLST', 'size']]) });
    const info = await connectFtp(client, { ...base, protocol: 'ftp' });
    expect(info.security).toBe('none');
    expect(info.couldUseTls).toBe(false);
    expect(trail).not.toContain('useTLS');
    expect(trail).toContain('login alice');
  });

  // Opportunistic means best-effort: it must never be able to break a target that works today.
  it('falls back to plaintext when the upgrade fails on a still-open control connection', async () => {
    const { client, trail } = fakeClient({
      features: new Map([['AUTH', 'TLS']]),
      useTLS: () => Promise.reject(new Error('500 AUTH not understood')),
    });
    const info = await connectFtp(client, { ...base, protocol: 'ftp' });
    expect(info.security).toBe('none');
    expect(trail).toContain('login alice');
    expect(trail.filter((t) => t.startsWith('connect ')).length).toBe(1); // no needless reconnect
  });

  it('reconnects and continues in plaintext when a failed handshake destroyed the connection', async () => {
    const { client, trail } = fakeClient({
      features: new Map([['AUTH', 'TLS']]),
      useTLS: () => Promise.reject(new Error('wrong version number')),
      closedAfterTlsFailure: true,
    });
    const info = await connectFtp(client, { ...base, protocol: 'ftp' });
    expect(info.security).toBe('none');
    expect(trail.filter((t) => t.startsWith('connect ')).length).toBe(2);
    expect(trail).toContain('login alice');
  });

  it('reports that TLS was AVAILABLE but unused when the target stays plain', async () => {
    // features() is consulted twice: once to decide, once to report. The second call is what feeds
    // `couldUseTls`, so a server that offers AUTH TLS is flagged even though nothing failed.
    let calls = 0;
    const { client } = fakeClient();
    (client as unknown as { features: () => Promise<Map<string, string>> }).features = async () => {
      calls += 1;
      return calls === 1 ? new Map<string, string>() : new Map([['AUTH', 'TLS']]);
    };
    const info = await connectFtp(client, { ...base, protocol: 'ftp' });
    expect(info.security).toBe('none');
    expect(info.couldUseTls).toBe(true);
  });
});

describe('captureTranscript', () => {
  it('records both directions and redacts a password command whatever its casing', () => {
    const sink: string[] = [];
    const { client } = fakeClient();
    captureTranscript(client, sink);
    const log = (client.ftp as unknown as { log: (m: string) => void }).log;
    log('> USER alice');
    log('< 331 Password required');
    log('> pass hunter2');
    log('> PASS hunter2');
    expect(sink).toEqual(['> USER alice', '< 331 Password required', '> pass ###', '> PASS ###']);
    expect(sink.join('\n')).not.toContain('hunter2');
  });

  it('splits multi-line replies and drops blank lines', () => {
    const sink: string[] = [];
    const { client } = fakeClient();
    captureTranscript(client, sink);
    (client.ftp as unknown as { log: (m: string) => void }).log('< 211-Features:\n MLST\n\n211 End');
    expect(sink).toEqual(['< 211-Features:', 'MLST', '211 End']);
  });

  it('keeps a ROLLING TAIL in `last` mode — a deploy\'s last replies are the ones that matter', () => {
    const sink: string[] = [];
    const { client } = fakeClient();
    captureTranscript(client, sink, { keep: 'last' });
    const log = (client.ftp as unknown as { log: (m: string) => void }).log;
    for (let i = 0; i < 500; i += 1) log(`< line ${i}`);
    expect(sink.length).toBe(200);
    expect(sink[sink.length - 1]).toBe('< line 499'); // the end survived, not the beginning
    expect(sink[0]).toBe('< line 300');
  });

  it('stops recording once the line cap is reached rather than growing without bound', () => {
    const sink: string[] = [];
    const { client } = fakeClient();
    captureTranscript(client, sink);
    const log = (client.ftp as unknown as { log: (m: string) => void }).log;
    for (let i = 0; i < 500; i += 1) log(`< line ${i}`);
    expect(sink.length).toBe(200);
  });
});

/** A TLS socket reporting a chosen certificate — enough to drive the pin check and TLS reporting. */
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
    getProtocol: () => 'TLSv1.2',
    getCipher: () => ({ name: 'ECDHE-RSA-AES256-GCM-SHA384' }),
  });
  return socket;
}

describe('connectFtp — certificate pinning', () => {
  const PIN = 'aabbcc';

  it('accepts the pinned certificate and logs in, reporting the pin as the reason it was trusted', async () => {
    const { client, trail } = fakeClient({ socket: tlsSocketWith('AA:BB:CC') });
    const info = await connectFtp(client, { ...base, protocol: 'ftps', certFingerprint: PIN });
    expect(info.security).toBe('explicit');
    expect(info.tls?.pinned).toBe(true);
    expect(info.tls?.unverified).toBe(false);
    expect(info.tls?.protocol).toBe('TLSv1.2');
    expect(info.tls?.certificate.subject).toBe('ftp.host.example');
    expect(trail).toContain('login alice');
  });

  it('rejects a DIFFERENT certificate before login, carrying the one it was offered', async () => {
    const { client, trail } = fakeClient({ socket: tlsSocketWith('99:88:77') });
    await expect(connectFtp(client, { ...base, protocol: 'ftps', certFingerprint: PIN })).rejects.toMatchObject({
      name: 'CertificatePinMismatchError',
      offered: { fingerprint256: '998877' },
    });
    expect(trail.some((t) => t.startsWith('login'))).toBe(false);
  });

  it('pins an implicit-TLS connection on the same terms', async () => {
    const { client } = fakeClient({ socket: tlsSocketWith('AA:BB:CC') });
    const info = await connectFtp(client, { ...base, protocol: 'ftps', ftpsMode: 'implicit', certFingerprint: PIN });
    expect(info.security).toBe('implicit');
    expect(info.tls?.pinned).toBe(true);
  });

  it('reports an opportunistic upgrade as encrypted but UNVERIFIED', async () => {
    const { client } = fakeClient({ features: new Map([['AUTH', 'TLS']]), socket: tlsSocketWith('AA:BB:CC') });
    const info = await connectFtp(client, { ...base, protocol: 'ftp' });
    expect(info.security).toBe('opportunistic');
    expect(info.tls?.unverified).toBe(true);
    expect(info.tls?.pinned).toBe(false);
  });
});

describe('probeFtpsCertificate', () => {
  it('reads the certificate without logging in — it exists only to look', async () => {
    const { client, trail } = fakeClient({ socket: tlsSocketWith('12:34') });
    const cert = await probeFtpsCertificate(client, { host: 'ftp.example.com' });
    expect(cert?.fingerprint256).toBe('1234');
    expect(trail.some((t) => t.startsWith('login'))).toBe(false);
  });

  it('uses an implicit connection when the target is implicit', async () => {
    const { client, trail } = fakeClient({ socket: tlsSocketWith('12:34') });
    await probeFtpsCertificate(client, { host: 'ftp.example.com', ftpsMode: 'implicit' });
    expect(trail).toContain('connectImplicitTLS ftp.example.com:990');
  });

  it('returns nothing when the connection never became TLS', async () => {
    const { client } = fakeClient({ socket: new Socket() });
    expect(await probeFtpsCertificate(client, { host: 'ftp.example.com' })).toBeUndefined();
  });
});
