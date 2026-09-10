import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { Client as FtpClientImpl } from 'basic-ftp';
import SftpClientImpl from 'ssh2-sftp-client';
import { remoteJoin } from './deploy/plan.js';
import { deployRsync } from './rsync-deploy.js';
import {
  FTP_TIMEOUT_MS,
  SFTP_CONNECT_TIMEOUT_MS,
  type DeployConfig,
  type DeploySecurity,
} from './adapters.js';
import { captureTranscript, connectFtp, defaultFtpPort, probeFtpsCertificate, type FtpTlsInfo } from './ftp-connect.js';
import { describeDeployError, normalizeFingerprint, type DeployFailure, type OfferedCertificate } from './deploy-errors.js';

/**
 * The deploy-target CONNECTION TEST.
 *
 * ★ WHY. Configuring an FTP/SFTP target was previously unfalsifiable: you saved credentials and found
 * out whether they worked by running a real deploy, whose only failure report was one constant
 * sentence. Everything that can actually go wrong — a wrong port, a TLS mode that does not match the
 * port, a certificate the shared host cannot make valid, a firewall eating the passive data channel,
 * an account that logs in fine but cannot write to the directory — presents identically from there.
 *
 * So this walks the SAME code path a deploy uses (`connectFtp` is shared with the transport, and the
 * rsync test really runs rsync) and reports each step separately. Which step fails is usually the
 * whole diagnosis: connect-ok/auth-failed is a password, auth-ok/write-failed is a permission, and
 * connect-ok/tls-failed with a certificate attached is the shared-hosting case that needs a pin.
 *
 * It transfers a single small file and deletes it again, because "can log in" and "can write here"
 * are different questions and only the second one predicts whether a deploy will work.
 */

/** The probe file. Named so an operator who finds one knows exactly what left it there. */
const PROBE_FILENAME = '.sitewright-connection-test';
const PROBE_BODY = 'Sitewright deploy-target connection test. Safe to delete.\n';

/** The steps a test walks, in order. Not every protocol has every step. */
export type DeployTestStepKey = 'connect' | 'tls' | 'auth' | 'directory' | 'write' | 'rsync' | 'branch';

export interface DeployTestStep {
  key: DeployTestStepKey;
  label: string;
  status: 'ok' | 'failed' | 'skipped';
  /** What was learned at this step ("TLSv1.3 · TLS_AES_256_GCM_SHA384", "wrote and removed 57 bytes"). */
  detail?: string;
  ms?: number;
}

export interface DeployTestResult {
  ok: boolean;
  protocol: DeployConfig['protocol'] | 'git';
  host: string;
  port: number;
  steps: DeployTestStep[];
  /** How the connection ended up protected — the answer to "is TLS actually being used here?". */
  security?: DeploySecurity;
  tls?: FtpTlsInfo;
  /** The SSH host key's SHA-256 fingerprint (SFTP), so it can be pinned from the UI. */
  hostKeyFingerprint?: string;
  /** A git-SSH remote's `known_hosts` LINE — what a git target pins (it takes a line, not a hash). */
  hostKeyLine?: string;
  /**
   * The certificate a server offered when verification FAILED — obtained by a separate, deliberate
   * look-only connection. Present exactly when the UI should offer to pin it.
   */
  offeredCertificate?: OfferedCertificate;
  /** The server's FEAT list (FTP), which is the ground truth about what it supports. */
  features?: string[];
  welcome?: string;
  /** The control-channel conversation, passwords redacted (FTP/FTPS only). */
  transcript?: string[];
  failure?: DeployFailure;
  elapsedMs: number;
}

/**
 * The pieces a test constructs, injectable so the ORCHESTRATION is unit-testable without a server —
 * the same idiom `deploySite` uses for its transport factory. What is faked is only the wire; the
 * step sequencing, the failure description and the certificate probe are the real code.
 */
export interface DeployTestDeps {
  makeFtpClient?: () => FtpClientImpl;
  makeSftpClient?: () => SftpClientImpl;
  /** Runs the real rsync probe for the rsync step. Takes the same `opts` the deploy path does, so a
   *  test observes the ACTUAL flags the probe runs with rather than a stand-in for them. */
  runRsync?: (siteDir: string, cfg: DeployConfig, opts: { dryRun?: boolean }) => Promise<unknown>;
}

/** Runs `fn`, recording it as a step. Rethrows so the caller stops at the first real failure.
 *  Exported so the git tester reports through the identical shape. */
export async function step<T>(
  steps: DeployTestStep[],
  key: DeployTestStepKey,
  label: string,
  fn: () => Promise<T>,
  detail?: (value: T) => string | undefined,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const value = await fn();
    steps.push({ key, label, status: 'ok', ms: Date.now() - startedAt, ...(detail?.(value) ? { detail: detail(value) } : {}) });
    return value;
  } catch (err) {
    steps.push({ key, label, status: 'failed', ms: Date.now() - startedAt });
    throw err;
  }
}

/** A one-line summary of the TLS layer, for the `tls` step's detail. */
function tlsDetail(tls: FtpTlsInfo | undefined): string | undefined {
  if (!tls) return undefined;
  const bits = [tls.protocol, tls.cipher].filter(Boolean);
  if (tls.pinned) bits.push('pinned certificate');
  else if (tls.unverified) bits.push('certificate NOT verified');
  return bits.join(' · ');
}

/** FTP/FTPS: connect → (TLS) → login → reach the directory → write and remove a probe file. */
async function testFtp(cfg: DeployConfig, deps: DeployTestDeps): Promise<DeployTestResult> {
  const isFtps = cfg.protocol === 'ftps';
  const port = cfg.port ?? defaultFtpPort(isFtps ? 'ftps' : 'ftp', cfg.ftpsMode);
  const startedAt = Date.now();
  const steps: DeployTestStep[] = [];
  const transcript: string[] = [];
  const client = deps.makeFtpClient ? deps.makeFtpClient() : new FtpClientImpl(FTP_TIMEOUT_MS);
  captureTranscript(client, transcript);
  const base: Omit<DeployTestResult, 'ok' | 'elapsedMs'> = { protocol: cfg.protocol, host: cfg.host, port, steps, transcript };

  try {
    // connect + TLS + login are one call because the ORDER between them is a security property (the
    // pin has to be checked before the password moves) — see ftp-connect.ts. They are reported as
    // separate steps afterwards, derived from how far the transcript got.
    const info = await step(steps, 'connect', `Connect to ${cfg.host}:${port}`, () =>
      connectFtp(client, {
        protocol: isFtps ? 'ftps' : 'ftp',
        host: cfg.host,
        port,
        user: cfg.user,
        password: cfg.password ?? '',
        ...(cfg.ftpsMode ? { ftpsMode: cfg.ftpsMode } : {}),
        ...(cfg.certFingerprint ? { certFingerprint: cfg.certFingerprint } : {}),
      }),
    );
    steps.push({
      key: 'tls',
      label: 'Encrypt the connection',
      status: info.security === 'none' ? 'skipped' : 'ok',
      detail:
        info.security === 'none'
          ? info.couldUseTls
            ? 'not encrypted — but this server offers AUTH TLS, so switching this target to FTPS would encrypt it'
            : 'not encrypted — this server does not offer AUTH TLS'
          : `${info.security === 'implicit' ? 'implicit TLS' : info.security === 'opportunistic' ? 'opportunistic AUTH TLS' : 'explicit AUTH TLS'} · ${tlsDetail(info.tls) ?? ''}`,
    });
    steps.push({ key: 'auth', label: `Sign in as ${cfg.user}`, status: 'ok' });

    await step(steps, 'directory', `Reach ${cfg.remoteDir}`, async () => {
      await client.ensureDir(cfg.remoteDir); // creates it if missing, and cds into it
      return client.pwd();
    }, (pwd) => `remote working directory is ${pwd}`);

    await step(steps, 'write', 'Write and remove a test file', async () => {
      await client.uploadFrom(Readable.from(PROBE_BODY), PROBE_FILENAME); // relative to the cwd set above
      // Cleanup is part of the test, not an afterthought: a probe file left behind on a customer's
      // web root is litter, and a delete that fails is itself worth reporting (write-only accounts).
      await client.remove(PROBE_FILENAME);
      return true;
    }, () => `wrote and removed ${PROBE_FILENAME} (${PROBE_BODY.length} bytes)`);

    return {
      ...base,
      ok: true,
      security: info.security,
      ...(info.tls ? { tls: info.tls } : {}),
      features: info.features,
      ...(info.welcome ? { welcome: info.welcome } : {}),
      elapsedMs: Date.now() - startedAt,
    };
  } catch (err) {
    const failure = describeDeployError(err, { protocol: cfg.protocol, host: cfg.host, port });
    // A certificate problem is the one failure where the fix lives in the answer: fetch the
    // certificate on a separate look-only connection so the UI can show it and offer to pin it.
    let offered = failure.certificate;
    if (!offered && isFtps && (failure.kind === 'tls-cert' || failure.kind === 'tls-protocol')) {
      const probe = deps.makeFtpClient ? deps.makeFtpClient() : new FtpClientImpl(FTP_TIMEOUT_MS);
      offered = await probeFtpsCertificate(probe, { host: cfg.host, port, ...(cfg.ftpsMode ? { ftpsMode: cfg.ftpsMode } : {}) }).catch(
        () => undefined,
      );
      probe.close();
    }
    return { ...base, ok: false, failure, ...(offered ? { offeredCertificate: offered } : {}), elapsedMs: Date.now() - startedAt };
  } finally {
    client.close();
  }
}

/** SFTP: handshake (reporting the host key) → auth → reach the directory → write and remove a probe. */
async function testSftp(cfg: DeployConfig, deps: DeployTestDeps): Promise<DeployTestResult> {
  const port = cfg.port ?? 22;
  const startedAt = Date.now();
  const steps: DeployTestStep[] = [];
  const client = deps.makeSftpClient ? deps.makeSftpClient() : new SftpClientImpl();
  const base: Omit<DeployTestResult, 'ok' | 'elapsedMs'> = { protocol: cfg.protocol, host: cfg.host, port, steps };
  // Captured from the host verifier so the fingerprint can be REPORTED (and pinned) rather than only
  // compared — an operator with no pin set otherwise has no way to learn what to pin.
  let hostKey: string | undefined;
  const pinned = cfg.hostFingerprint ? normalizeFingerprint(cfg.hostFingerprint) : undefined;

  try {
    await step(steps, 'connect', `Connect to ${cfg.host}:${port}`, async () => {
      const opts: Parameters<SftpClientImpl['connect']>[0] = {
        host: cfg.host,
        port,
        username: cfg.user,
        ...(cfg.password ? { password: cfg.password } : {}),
        ...(cfg.privateKey ? { privateKey: cfg.privateKey, ...(cfg.passphrase ? { passphrase: cfg.passphrase } : {}) } : {}),
        readyTimeout: SFTP_CONNECT_TIMEOUT_MS,
        hostHash: 'sha256',
        hostVerifier: (hashedKey: string): boolean => {
          hostKey = normalizeFingerprint(hashedKey);
          return pinned ? hostKey === pinned : true; // parity with the transport: pin, else trust on first use
        },
      };
      await client.connect(opts);
    });
    steps.push({
      key: 'auth',
      label: `Sign in as ${cfg.user}`,
      status: 'ok',
      detail: cfg.privateKey ? 'private key accepted' : 'password accepted',
    });

    await step(steps, 'directory', `Reach ${cfg.remoteDir}`, async () => {
      await client.mkdir(cfg.remoteDir, true).catch(() => {
        /* already there on every target after the first deploy */
      });
      return client.exists(cfg.remoteDir);
    }, (exists) => (exists ? `${cfg.remoteDir} exists and is reachable` : `${cfg.remoteDir} could not be created`));

    await step(steps, 'write', 'Write and remove a test file', async () => {
      const path = remoteJoin(cfg.remoteDir, PROBE_FILENAME);
      await client.put(Buffer.from(PROBE_BODY, 'utf8'), path);
      await client.delete(path);
      return true;
    }, () => `wrote and removed ${PROBE_FILENAME} (${PROBE_BODY.length} bytes)`);

    // rsync is a SEPARATE transport riding the same SSH credentials, and it fails for its own reasons
    // (no rsync binary, a shell-less account). Testing SFTP and calling rsync proven would be a lie,
    // so run the real thing — but under three independent guarantees that it cannot touch the target:
    // an EMPTY source (nothing to send), pruning forced OFF (no --delete), and --dry-run (rsync
    // modifies nothing regardless of the other two). Any one of them would do; a destructive flag is
    // worth belt and braces.
    if (cfg.useRsync) {
      const emptyDir = await mkdtemp(join(tmpdir(), 'sw-rsync-test-'));
      try {
        await step(
          steps,
          'rsync',
          'Run rsync over the same SSH connection',
          () => {
            const run = deps.runRsync ?? ((dir, c, o) => deployRsync(dir, c, undefined, o));
            return run(emptyDir, { ...cfg, rsyncDelete: false }, { dryRun: true });
          },
          () => 'rsync connected and completed a dry run — nothing was transferred or removed',
        );
      } finally {
        await rm(emptyDir, { recursive: true, force: true });
      }
    }

    return { ...base, ok: true, security: 'ssh', ...(hostKey ? { hostKeyFingerprint: hostKey } : {}), elapsedMs: Date.now() - startedAt };
  } catch (err) {
    return {
      ...base,
      ok: false,
      ...(hostKey ? { hostKeyFingerprint: hostKey } : {}),
      failure: describeDeployError(err, { protocol: cfg.protocol, host: cfg.host, port }),
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    await client.end().catch(() => {
      /* best-effort close */
    });
  }
}

/**
 * Tests a deploy target end to end and reports what happened at each step.
 *
 * Never throws for a connection problem — a failed test is a RESULT (`ok: false` with a described
 * failure), because "the test endpoint 500'd" tells an operator even less than the constant string
 * this whole change exists to replace.
 */
export async function testDeployTarget(cfg: DeployConfig, deps: DeployTestDeps = {}): Promise<DeployTestResult> {
  return cfg.protocol === 'sftp' ? testSftp(cfg, deps) : testFtp(cfg, deps);
}
