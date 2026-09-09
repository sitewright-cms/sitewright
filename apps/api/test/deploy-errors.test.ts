import { describe, it, expect } from 'vitest';
import type { PeerCertificate } from 'node:tls';
import {
  attachTranscript,
  CertificatePinMismatchError,
  describeCertificate,
  describeDeployError,
  normalizeFingerprint,
  readTranscript,
  type DeployEndpoint,
} from '../src/publish/deploy-errors.js';

const ftp: DeployEndpoint = { protocol: 'ftps', host: 'ftp.example.com', port: 21 };
const sftp: DeployEndpoint = { protocol: 'sftp', host: 'ssh.example.com', port: 22 };

/** A basic-ftp FTPError: an Error whose `code` is the numeric reply and whose message is the line. */
function reply(code: number, message: string): Error {
  return Object.assign(new Error(message), { code });
}
/** A libuv error: an Error carrying a string `code`. */
function sys(code: string, message = code): Error {
  return Object.assign(new Error(message), { code });
}

describe('describeDeployError — FTP reply codes', () => {
  it('names a 421 as the server turning us away, not a credential problem', () => {
    const d = describeDeployError(reply(421, '421 Too many connections (8) from this IP'), ftp);
    expect(d.kind).toBe('rate-limit');
    expect(d.replyCode).toBe(421);
    // The server's own words survive — that sentence is the entire diagnosis.
    expect(d.detail).toContain('Too many connections');
    expect(d.hint).toMatch(/10-minute ban|per-IP/);
  });

  it('reads a 530 as bad credentials', () => {
    const d = describeDeployError(reply(530, '530 Login incorrect.'), ftp);
    expect(d.kind).toBe('auth');
  });

  // ★ 530 is overloaded — the same code means "wrong password" AND "you must encrypt first", and
  // telling an operator to re-check a correct password would send them the wrong way entirely.
  it('reads a 530 that mentions encryption as a TLS requirement, not bad credentials', () => {
    const d = describeDeployError(reply(530, '530 Non-anonymous sessions must use encryption.'), ftp);
    expect(d.kind).toBe('tls-required');
    expect(d.hint).toMatch(/FTPS/);
  });

  it('separates a quota (552) from a permission problem (550)', () => {
    expect(describeDeployError(reply(552, '552 Quota exceeded'), ftp).kind).toBe('quota');
    expect(describeDeployError(reply(550, '550 Permission denied'), ftp).kind).toBe('permission');
    expect(describeDeployError(reply(550, '550 No such file or directory'), ftp).kind).toBe('path');
  });

  it('reports an unmapped reply code rather than inventing a cause', () => {
    const d = describeDeployError(reply(451, '451 Local error in processing'), ftp);
    expect(d.replyCode).toBe(451);
    expect(d.detail).toContain('451');
  });

  it('names a 425 as the data connection, which is a different fix from the control connection', () => {
    expect(describeDeployError(reply(425, "425 Can't open data connection"), ftp).kind).toBe('data-connection');
  });
});

describe('describeDeployError — socket and TLS', () => {
  it.each([
    ['ENOTFOUND', 'dns'],
    ['ECONNREFUSED', 'refused'],
    ['ETIMEDOUT', 'timeout'],
    ['ECONNRESET', 'reset'],
    ['EHOSTUNREACH', 'unreachable'],
  ])('maps %s to %s', (code, kind) => {
    expect(describeDeployError(sys(code), ftp).kind).toBe(kind);
  });

  it('names a wrong-version-number as a TLS MODE mismatch, with the port as the fix', () => {
    const d = describeDeployError(sys('ERR_SSL_WRONG_VERSION_NUMBER', 'wrong version number'), ftp);
    expect(d.kind).toBe('tls-protocol');
    expect(d.hint).toMatch(/implicit|990/i);
  });

  it('distinguishes a hostname mismatch from an untrusted chain', () => {
    const mismatch = describeDeployError(
      sys('ERR_TLS_CERT_ALTNAME_INVALID', "Hostname/IP does not match certificate's altnames"),
      ftp,
    );
    expect(mismatch.kind).toBe('tls-cert');
    expect(mismatch.message).toMatch(/different host name/);
    const selfSigned = describeDeployError(sys('DEPTH_ZERO_SELF_SIGNED_CERT', 'self signed certificate'), ftp);
    expect(selfSigned.kind).toBe('tls-cert');
    expect(selfSigned.message).toMatch(/could not be verified/);
  });

  it('carries the offered certificate through a pin mismatch so the UI can offer to re-pin', () => {
    const offered = describeCertificate({
      subject: { CN: 'ftp.host.example' },
      issuer: { CN: "Let's Encrypt R3" },
      valid_from: 'Jan  1 00:00:00 2026 GMT',
      valid_to: 'Apr  1 00:00:00 2026 GMT',
      fingerprint256: 'AA:BB:' + 'CC:'.repeat(30) + 'DD',
      subjectaltname: 'DNS:ftp.host.example, DNS:host.example',
    } as unknown as PeerCertificate);
    const d = describeDeployError(new CertificatePinMismatchError('a'.repeat(64), offered), ftp);
    expect(d.kind).toBe('tls-cert-pin');
    expect(d.certificate?.altNames).toEqual(['ftp.host.example', 'host.example']);
    expect(d.hint).toMatch(/renews every 90 days|do not pin/i);
  });
});

describe('describeDeployError — SSH and rsync', () => {
  it('separates a rejected credential from an unreadable key', () => {
    expect(describeDeployError(new Error('All configured authentication methods failed'), sftp).kind).toBe('auth');
    expect(describeDeployError(new Error('Cannot parse privateKey: Unsupported key format'), sftp).kind).toBe('key');
  });

  it('names a host-key mismatch as a pin failure, not an auth failure', () => {
    expect(describeDeployError(new Error('Host verification failed'), sftp).kind).toBe('host-key');
  });

  it('reads the rsync exit code and points at the SFTP fallback for an SSH-layer failure', () => {
    const d = describeDeployError(new Error('rsync failed (exit 12): connection unexpectedly closed'), sftp);
    expect(d.kind).toBe('rsync');
    expect(d.hint).toMatch(/Transfer with rsync/);
    expect(describeDeployError(new Error('rsync failed (exit 23): some files could not be transferred'), sftp).kind).toBe('permission');
  });
});

describe('describeDeployError — fallback', () => {
  it('never invents a cause, and always carries the raw error', () => {
    const d = describeDeployError(new Error('something entirely novel'), ftp);
    expect(d.kind).toBe('unknown');
    expect(d.detail).toBe('something entirely novel');
    // The old behaviour — a constant sentence with the reason discarded — is what this must not be.
    expect(d.message).not.toBe('deploy failed: could not connect or transfer to the target');
  });

  it('handles a thrown non-Error', () => {
    expect(describeDeployError('plain string', ftp).detail).toBe('plain string');
  });
});

describe('certificate helpers', () => {
  it('normalizes a colon-separated uppercase fingerprint to bare lowercase hex', () => {
    expect(normalizeFingerprint('AB:CD:EF')).toBe('abcdef');
  });

  it('flags an expired, self-signed certificate', () => {
    const cert = describeCertificate({
      subject: { CN: 'self.example' },
      issuer: { CN: 'self.example' },
      valid_from: 'Jan  1 00:00:00 2020 GMT',
      valid_to: 'Jan  2 00:00:00 2020 GMT',
      fingerprint256: 'ab:cd',
      subjectaltname: '',
    } as unknown as PeerCertificate);
    expect(cert.selfSigned).toBe(true);
    expect(cert.expired).toBe(true);
    expect(cert.fingerprint256).toBe('abcd');
  });

  it('takes the first CN when a DN carries several', () => {
    const cert = describeCertificate({
      subject: { CN: ['first.example', 'second.example'] },
      issuer: { O: 'Some CA' },
      valid_from: '',
      valid_to: '',
      fingerprint256: '',
      subjectaltname: undefined,
    } as unknown as PeerCertificate);
    expect(cert.subject).toBe('first.example');
    expect(cert.issuer).toBe('Some CA');
    expect(cert.altNames).toEqual([]);
  });
});

describe('control-channel transcript', () => {
  it('rides along whichever cause is named', () => {
    const err = reply(421, '421 Too many connections');
    attachTranscript(err, ['> USER alice', '< 421 Too many connections']);
    const d = describeDeployError(err, ftp);
    expect(d.kind).toBe('rate-limit');
    expect(d.transcript).toEqual(['> USER alice', '< 421 Too many connections']);
  });

  it('reaches the fallback case too, which is where it matters most', () => {
    const err = new Error('something entirely novel');
    attachTranscript(err, ['< 220 hello']);
    expect(describeDeployError(err, ftp).transcript).toEqual(['< 220 hello']);
  });

  it('is absent when nothing was stamped, rather than an empty array', () => {
    expect(describeDeployError(reply(530, '530 Login incorrect'), ftp).transcript).toBeUndefined();
  });

  it('copies the lines, so a rolling buffer that keeps moving cannot rewrite the report', () => {
    const live = ['< 220 hello'];
    const err = new Error('boom');
    attachTranscript(err, live);
    live.push('< 226 later');
    expect(readTranscript(err)).toEqual(['< 220 hello']);
  });

  it('ignores a non-object throw and an empty tail without blowing up', () => {
    expect(() => attachTranscript('a string', ['x'])).not.toThrow();
    const err = new Error('boom');
    attachTranscript(err, []);
    expect(readTranscript(err)).toBeUndefined();
  });
});
