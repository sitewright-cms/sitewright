import { TLSSocket } from 'node:tls';
import type { Client as FtpClient } from 'basic-ftp';
import type { FtpsMode } from '@sitewright/schema';
import {
  CertificatePinMismatchError,
  describeCertificate,
  normalizeFingerprint,
  type OfferedCertificate,
} from './deploy-errors.js';

/**
 * Establishing the FTP/FTPS control connection — the ONE place that decides how (and whether) the
 * connection is encrypted.
 *
 * ★ This is deliberately not `client.access()`. That convenience method does connect → TLS → login in
 * one call, which forbids the two things this platform needs:
 *
 *  1. **Verifying a pinned certificate BEFORE the password is sent.** Pinning means "trust this exact
 *     certificate instead of a public CA", so the CA check has to be off — and with it off, `access()`
 *     would cheerfully log in to whatever presented itself and leave us to notice afterwards, by which
 *     point the credentials are already gone. Splitting the sequence lets the pin be checked while the
 *     connection still carries nothing but a banner.
 *  2. **Opportunistic TLS on a plain `ftp` target.** `access()` takes a fixed boolean; it cannot ask
 *     the server what it supports and decide.
 *
 * Both the real transport and the connection tester call this, so what the test proves is what the
 * deploy does. Anything the tester wants to *report* is returned as {@link FtpConnectInfo}.
 */

/** How the control connection ended up being protected. */
export type FtpSecurity =
  /** Plain FTP; the server did not offer AUTH TLS. Credentials and files travel in the clear. */
  | 'none'
  /** Plain FTP target, upgraded because the server advertised AUTH TLS. Encrypted, but UNVERIFIED. */
  | 'opportunistic'
  /** FTPS: connected in the clear, then upgraded with AUTH TLS (RFC 4217). Verified or pinned. */
  | 'explicit'
  /** FTPS: TLS from the first byte (legacy, usually port 990). Verified or pinned. */
  | 'implicit';

/** What the TLS layer turned out to be, once there is one. */
export interface FtpTlsInfo {
  /** e.g. "TLSv1.3". */
  protocol: string;
  /** e.g. "TLS_AES_256_GCM_SHA384". */
  cipher: string;
  certificate: OfferedCertificate;
  /** True when this certificate was accepted because it matched the target's pin. */
  pinned: boolean;
  /** True when the certificate was accepted WITHOUT verification (opportunistic upgrade only). */
  unverified: boolean;
}

/** Everything the connection turned out to be — reported by the tester, ignored by the transport. */
export interface FtpConnectInfo {
  port: number;
  security: FtpSecurity;
  tls?: FtpTlsInfo;
  /** The server's FEAT list, which is what tells an operator what the server can actually do. */
  features: string[];
  /** The server's greeting line. */
  welcome?: string;
  /** True when AUTH TLS is advertised but this target is not using it. */
  couldUseTls: boolean;
}

export interface FtpConnectOptions {
  protocol: 'ftp' | 'ftps';
  host: string;
  port?: number;
  user: string;
  password: string;
  /** FTPS only. Absent = `explicit` (what "FTPS" means nearly everywhere). */
  ftpsMode?: FtpsMode;
  /** FTPS only. When set, this exact certificate is trusted INSTEAD of the public CA set. */
  certFingerprint?: string;
}

/** Default control port per mode: implicit FTPS is conventionally 990, everything else 21. */
export function defaultFtpPort(protocol: 'ftp' | 'ftps', mode: FtpsMode | undefined): number {
  return protocol === 'ftps' && mode === 'implicit' ? 990 : 21;
}

/** True when the FEAT map advertises `AUTH TLS` / `AUTH SSL`. */
export function advertisesAuthTls(features: Map<string, string>): boolean {
  const auth = features.get('AUTH');
  return auth !== undefined && /TLS|SSL/i.test(auth || 'TLS');
}

/** Reads the negotiated TLS details off a client whose control socket has been upgraded. */
function readTls(client: FtpClient, pinned: boolean, unverified: boolean): FtpTlsInfo | undefined {
  const socket = client.ftp.socket;
  if (!(socket instanceof TLSSocket)) return undefined;
  // `true` = don't follow the chain; the LEAF is what gets pinned and what a human recognizes.
  const cert = socket.getPeerCertificate(false);
  return {
    protocol: socket.getProtocol() ?? '',
    cipher: socket.getCipher()?.name ?? '',
    certificate: describeCertificate(cert),
    pinned,
    unverified,
  };
}

/**
 * Enforces the target's certificate pin on an already-upgraded connection, BEFORE anything secret is
 * sent. Throws {@link CertificatePinMismatchError} — carrying the offered certificate, so the UI can
 * show what it got and offer to re-pin — and leaves closing the client to the caller's `finally`.
 */
function assertPinned(client: FtpClient, expected: string): OfferedCertificate {
  const socket = client.ftp.socket;
  if (!(socket instanceof TLSSocket)) {
    throw new Error('a certificate is pinned for this target but the connection was not encrypted');
  }
  const offered = describeCertificate(socket.getPeerCertificate(false));
  if (offered.fingerprint256 !== normalizeFingerprint(expected)) {
    throw new CertificatePinMismatchError(normalizeFingerprint(expected), offered);
  }
  return offered;
}

/**
 * Connects, secures and logs in — in that order, which is the whole point (see the file comment).
 *
 * The client is left ready for transfers (`TYPE I`, and `PBSZ 0`/`PROT P` when encrypted, via
 * `useDefaultSettings`). On failure the caller closes the client; nothing here swallows an error
 * except the deliberate opportunistic-upgrade fallback, which is documented where it happens.
 */
export async function connectFtp(client: FtpClient, opts: FtpConnectOptions): Promise<FtpConnectInfo> {
  const mode: FtpsMode = opts.ftpsMode ?? 'explicit';
  const port = opts.port ?? defaultFtpPort(opts.protocol, mode);
  // Pinning REPLACES public-CA verification: with a pin we must accept a chain Node would reject
  // (that is the entire reason a pin is being used), and the pin check below is what makes it safe.
  // Without a pin, verification stays strict — a failure there is reported, never waved through.
  const pinning = opts.protocol === 'ftps' && !!opts.certFingerprint;
  const tlsOptions = { host: opts.host, ...(pinning ? { rejectUnauthorized: false } : {}) };

  let security: FtpSecurity = 'none';
  let unverified = false;
  let welcome: string | undefined;

  if (opts.protocol === 'ftps' && mode === 'implicit') {
    welcome = (await client.connectImplicitTLS(opts.host, port, tlsOptions)).message;
    security = 'implicit';
  } else {
    welcome = (await client.connect(opts.host, port)).message;
    if (opts.protocol === 'ftps') {
      await client.useTLS(tlsOptions);
      security = 'explicit';
    } else {
      // ── Opportunistic upgrade on a PLAIN ftp target ──
      // Ask the server what it supports and take TLS if it is on offer. This is best-effort by
      // definition: the certificate is NOT verified (a plain-FTP target has no pin and shared hosting
      // rarely has a matching certificate), so it buys confidentiality against a passive observer, not
      // authentication. That is strictly better than the plaintext it replaces — but it must never be
      // able to BREAK a target that works today, so every failure path falls back to plaintext.
      const probe = await client.features().catch(() => new Map<string, string>());
      if (advertisesAuthTls(probe)) {
        try {
          await client.useTLS({ host: opts.host, rejectUnauthorized: false });
          security = 'opportunistic';
          unverified = true;
        } catch {
          // A rejected AUTH command leaves the control connection usable; a failed TLS handshake
          // destroys it. Reconnecting covers both, and costs one extra connection only on this path.
          if (client.closed) welcome = (await client.connect(opts.host, port)).message;
          security = 'none';
        }
      }
    }
  }

  if (pinning) assertPinned(client, opts.certFingerprint!);

  // Mirrors `access()`: some servers only honour UTF-8 before login, others only after, so it is sent
  // in both places and the error is ignored in both.
  await client.sendIgnoringError('OPTS UTF8 ON');
  await client.login(opts.user, opts.password);
  await client.useDefaultSettings();

  const features = await client.features().catch(() => new Map<string, string>());
  return {
    port,
    security,
    tls: security === 'none' ? undefined : readTls(client, pinning, unverified),
    features: [...features.entries()].map(([k, v]) => (v ? `${k} ${v}` : k)).sort(),
    welcome: welcome?.trim(),
    couldUseTls: security === 'none' && advertisesAuthTls(features),
  };
}

/** How many control-channel lines a transcript keeps. Enough for a full login + a failing command. */
const MAX_TRANSCRIPT_LINES = 200;
/** Cap per line, so a server that answers with a wall of text cannot bloat the response. */
const MAX_TRANSCRIPT_LINE = 500;

/**
 * Records the control-channel conversation into `sink` — the single most useful artefact when a
 * deploy "just drops", because the server's refusal is a reply LINE that no other layer preserves.
 *
 * basic-ftp already writes `> PASS ###` instead of the password (FtpContext.send), and the redaction
 * here is a second belt: a transcript is shown in the UI and must never carry a credential even if
 * that upstream behaviour changes.
 */
export function captureTranscript(
  client: FtpClient,
  sink: string[],
  opts: {
    /**
     * Which end of the conversation to keep once the cap is reached.
     *
     * `first` suits a TEST, where the interesting part is the opening handshake and the run is short.
     * `last` suits a DEPLOY, where thousands of transfers would blow any cap and the only lines that
     * matter are the ones just before it broke — a rolling tail is the difference between "it dropped"
     * and "it dropped right after the server said 421".
     */
    keep?: 'first' | 'last';
  } = {},
): void {
  const keepLast = opts.keep === 'last';
  const ctx = client.ftp as unknown as { log: (message: string) => void };
  ctx.log = (message: string): void => {
    if (!keepLast && sink.length >= MAX_TRANSCRIPT_LINES) return;
    for (const line of String(message).split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (!keepLast && sink.length >= MAX_TRANSCRIPT_LINES) return;
      // Redact anything that looks like a credential-bearing command, whatever its casing.
      const safe = /^>\s*(PASS|ACCT)\b/i.test(trimmed) ? trimmed.replace(/^(>\s*\w+).*$/i, '$1 ###') : trimmed;
      sink.push(safe.slice(0, MAX_TRANSCRIPT_LINE));
      if (keepLast && sink.length > MAX_TRANSCRIPT_LINES) sink.shift();
    }
  };
}

/**
 * Fetches the certificate a server offers, WITHOUT verifying it and WITHOUT logging in.
 *
 * ★ Needed because a verification failure destroys the socket before anything can read the
 * certificate off it — so "the certificate could not be verified" is all Node can tell you, and the
 * operator is left unable to see WHICH certificate, issued by whom, for which names. This makes a
 * second, deliberate connection whose only purpose is to look. Nothing is trusted as a result: no
 * credentials are sent, the connection is closed immediately, and the caller can only offer the
 * fingerprint to a human to pin.
 */
export async function probeFtpsCertificate(
  client: FtpClient,
  opts: Pick<FtpConnectOptions, 'host' | 'port' | 'ftpsMode'>,
): Promise<OfferedCertificate | undefined> {
  const mode: FtpsMode = opts.ftpsMode ?? 'explicit';
  const port = opts.port ?? defaultFtpPort('ftps', mode);
  const tlsOptions = { host: opts.host, rejectUnauthorized: false };
  if (mode === 'implicit') await client.connectImplicitTLS(opts.host, port, tlsOptions);
  else {
    await client.connect(opts.host, port);
    await client.useTLS(tlsOptions);
  }
  const socket = client.ftp.socket;
  return socket instanceof TLSSocket ? describeCertificate(socket.getPeerCertificate(false)) : undefined;
}
