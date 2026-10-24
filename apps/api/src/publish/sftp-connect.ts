import type SftpClientImpl from 'ssh2-sftp-client';

/**
 * Opening the SFTP connection, with ONE retry for a server that drops it before the handshake.
 *
 * ★ WHY. ssh2-sftp-client 11 retried a failed connect once, 25 s later, for almost any error. Version 12
 * removed retries altogether. Most of what 11 retried fails the same way twice: a wrong pin or a
 * black-holed host only made the author wait 25 s longer (measured against a real OpenSSH server, a
 * wrong host-key pin took 25.1 s on 11 and 0.1 s on 12). One case is real, though: a busy OpenSSH server
 * drops unauthenticated connections at random once `MaxStartups` is reached, which is the everyday
 * state of the shared hosting these targets usually are. That drop surfaces as "Connection lost before
 * handshake", and a second attempt a few seconds later normally gets in.
 *
 * So this retries ONLY that kind of drop, once, on a FRESH client, and nothing else. A host-key
 * mismatch, rejected credentials, an unreadable key, a refused or unknown host and a handshake timeout
 * all fail at once, as before. Both the transport and the connection tester call this, so the test
 * proves what the deploy does.
 */

type SftpConnectOptions = Parameters<SftpClientImpl['connect']>[0];

/** The part of the client this needs; the tests pass fakes of it. */
export interface SftpConnectable {
  connect(options: SftpConnectOptions): Promise<unknown>;
  end(): Promise<unknown>;
}

/** The pause before the one retry. Long enough for a saturated sshd to finish a pending login. */
export const SFTP_CONNECT_RETRY_DELAY_MS = 5_000;

/** Codes that mean the peer went away mid-connect. `EAI_AGAIN` is a temporary DNS failure. */
const TRANSIENT_CODES = new Set(['ECONNRESET', 'EPIPE', 'EAI_AGAIN']);
/** ssh2 reports a pre-handshake drop with no code at all, so this one message is matched. Only that
 *  exact phrase and case-sensitive: an error message can carry server-supplied text (a disconnect
 *  reason), and a looser pattern would let a server choose to be retried. */
const TRANSIENT_MESSAGE = /Connection lost before handshake/;

/** True when a connect failure is worth one more attempt: the server dropped the connection early. */
export function isTransientSftpConnectError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && TRANSIENT_CODES.has(code)) return true;
  return TRANSIENT_MESSAGE.test(err.message);
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Connects `client`, retrying once on a fresh client from `makeRetryClient` when the first attempt was
 * dropped early. Resolves with whichever client is connected. A client whose connect failed is ended
 * before this moves on, so a failure never leaves a half-open session behind.
 */
export async function connectSftpWithRetry<C extends SftpConnectable>(
  client: C,
  makeRetryClient: () => C,
  options: SftpConnectOptions,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<C> {
  try {
    await client.connect(options);
    return client;
  } catch (err) {
    await client.end().catch(() => {
      /* already closed */
    });
    if (!isTransientSftpConnectError(err)) throw err;
  }
  await sleep(SFTP_CONNECT_RETRY_DELAY_MS);
  const retry = makeRetryClient();
  try {
    await retry.connect(options);
    return retry;
  } catch (err) {
    await retry.end().catch(() => {
      /* already closed */
    });
    throw err;
  }
}
