import { describe, it, expect, vi } from 'vitest';
import {
  SFTP_CONNECT_RETRY_DELAY_MS,
  connectSftpWithRetry,
  isTransientSftpConnectError,
  type SftpConnectable,
} from '../src/publish/sftp-connect.js';

// ★ These are the EXACT errors ssh2-sftp-client 12.1.1 threw against a real OpenSSH server (and a TCP
// peer that resets) — not paraphrases. A fake that throws tidier wording is how a classifier ends up
// matching messages the library never produces.
const real = {
  reset: new Error('getConnection: Connection lost before handshake'),
  refused: Object.assign(new Error('getConnection: connect ECONNREFUSED 172.21.0.2:2298'), { code: 'ECONNREFUSED' }),
  notFound: Object.assign(new Error('getConnection: getaddrinfo ENOTFOUND no-such-host.invalid'), { code: 'ENOTFOUND' }),
  hostKey: new Error('getConnection: Host denied (verification failed)'),
  auth: new Error('getConnection: All configured authentication methods failed'),
  timeout: new Error('getConnection: Timed out while waiting for handshake'),
  badKey: new Error('getConnection: Cannot parse privateKey: Encrypted private OpenSSH key detected, but no passphrase given'),
};

describe('isTransientSftpConnectError', () => {
  it('retries a connection the server dropped early', () => {
    expect(isTransientSftpConnectError(real.reset)).toBe(true);
    expect(isTransientSftpConnectError(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }))).toBe(true);
    expect(isTransientSftpConnectError(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))).toBe(true);
    expect(isTransientSftpConnectError(Object.assign(new Error('getaddrinfo EAI_AGAIN example.com'), { code: 'EAI_AGAIN' }))).toBe(true);
    expect(isTransientSftpConnectError(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }))).toBe(true);
  });

  it('never retries what fails the same way twice', () => {
    for (const err of [real.refused, real.notFound, real.hostKey, real.auth, real.timeout, real.badKey]) {
      expect(isTransientSftpConnectError(err), err.message).toBe(false);
    }
  });

  it('matches the CODE, not words in the message, which can carry server-supplied text', () => {
    // A disconnect reason is the server's own text. Naming a transient error in it must not buy a retry.
    expect(isTransientSftpConnectError(new Error('getConnection: All configured authentication methods failed (ECONNRESET)'))).toBe(false);
    expect(isTransientSftpConnectError(new Error('Disconnected: socket hang up EPIPE EAI_AGAIN'))).toBe(false);
    expect(isTransientSftpConnectError(new Error('getconnection: connection lost before handshake'))).toBe(false);
  });

  it('is false for anything that is not an Error', () => {
    expect(isTransientSftpConnectError('Connection lost before handshake')).toBe(false);
    expect(isTransientSftpConnectError(undefined)).toBe(false);
  });
});

/** A fake client whose connect follows `script`: an Error throws, anything else connects. */
function fakeClient(outcome: Error | 'ok', log: string[], name: string): SftpConnectable {
  return {
    connect: async () => {
      log.push(`${name}.connect`);
      if (outcome !== 'ok') throw outcome;
    },
    end: async () => {
      log.push(`${name}.end`);
    },
  };
}

describe('connectSftpWithRetry', () => {
  it('returns the first client when it connects, without a pause or a second client', async () => {
    const log: string[] = [];
    const first = fakeClient('ok', log, 'first');
    const makeRetry = vi.fn(() => fakeClient('ok', log, 'retry'));
    const sleep = vi.fn(async () => {});
    await expect(connectSftpWithRetry(first, makeRetry, {}, sleep)).resolves.toBe(first);
    expect(makeRetry).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
    expect(log).toEqual(['first.connect']);
  });

  it('fails at once on a non-transient error (no pause, no second attempt) and ends the client', async () => {
    for (const err of [real.hostKey, real.auth, real.refused, real.timeout]) {
      const log: string[] = [];
      const makeRetry = vi.fn(() => fakeClient('ok', log, 'retry'));
      const sleep = vi.fn(async () => {});
      await expect(connectSftpWithRetry(fakeClient(err, log, 'first'), makeRetry, {}, sleep)).rejects.toBe(err);
      expect(makeRetry).not.toHaveBeenCalled();
      expect(sleep).not.toHaveBeenCalled();
      expect(log).toEqual(['first.connect', 'first.end']);
    }
  });

  it('retries an early drop ONCE, after the pause, on a fresh client', async () => {
    const log: string[] = [];
    const retry = fakeClient('ok', log, 'retry');
    const sleep = vi.fn(async () => {
      log.push('sleep');
    });
    const result = await connectSftpWithRetry(fakeClient(real.reset, log, 'first'), () => retry, {}, sleep);
    expect(result).toBe(retry);
    expect(sleep).toHaveBeenCalledWith(SFTP_CONNECT_RETRY_DELAY_MS);
    // The dropped client is ended BEFORE the pause, so nothing half-open waits through it.
    expect(log).toEqual(['first.connect', 'first.end', 'sleep', 'retry.connect']);
  });

  it('gives up after the one retry with the SECOND error, and ends both clients', async () => {
    const log: string[] = [];
    const second = new Error('getConnection: Connection lost before handshake (again)');
    await expect(
      connectSftpWithRetry(fakeClient(real.reset, log, 'first'), () => fakeClient(second, log, 'retry'), {}, async () => {}),
    ).rejects.toBe(second);
    expect(log).toEqual(['first.connect', 'first.end', 'retry.connect', 'retry.end']);
  });

  it('passes the SAME options (with the host verifier) to both attempts', async () => {
    const seen: unknown[] = [];
    const hostVerifier = (): boolean => true;
    const options = { host: 'h', hostVerifier };
    const make = (outcome: Error | 'ok'): SftpConnectable => ({
      connect: async (o) => {
        seen.push(o);
        if (outcome !== 'ok') throw outcome;
      },
      end: async () => {},
    });
    await connectSftpWithRetry(make(real.reset), () => make('ok'), options, async () => {});
    expect(seen).toEqual([options, options]);
    expect((seen[1] as { hostVerifier: unknown }).hostVerifier).toBe(hostVerifier);
  });

  it('is not derailed by an end() that rejects', async () => {
    const throwingEnd: SftpConnectable = {
      connect: async () => {
        throw real.reset;
      },
      end: async () => {
        throw new Error('already closed');
      },
    };
    const ok = fakeClient('ok', [], 'retry');
    await expect(connectSftpWithRetry(throwingEnd, () => ok, {}, async () => {})).resolves.toBe(ok);
    await expect(connectSftpWithRetry({ ...throwingEnd, connect: async () => { throw real.auth; } }, () => ok, {}, async () => {})).rejects.toBe(real.auth);
  });
});
