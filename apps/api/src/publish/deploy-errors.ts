import type { PeerCertificate } from 'node:tls';

/**
 * Turning a failed deploy into something an operator can act on.
 *
 * ★ WHY THIS FILE EXISTS. Every deploy failure used to reach the UI as one constant string —
 * "deploy failed: could not connect or transfer to the target" — while the actual cause was
 * `log.error`'d server-side and seen by nobody. That is a real loss of information, not a cosmetic
 * one: an FTP server answers a refused connection with a REPLY LINE that names the reason
 * ("421 Too many connections from this IP", "530 Login incorrect", "552 Quota exceeded"), and
 * basic-ftp hands that line straight through as `FTPError.message` with the numeric reply in `.code`.
 * The server had been explaining itself all along.
 *
 * So this maps the underlying error to (a) a sentence a non-specialist can act on, (b) a `kind` the
 * UI can branch on, and (c) the verbatim `detail` for whoever wants the raw truth. Modelled on
 * `describeSmtpError` in ../mail/mailer.ts, which does the same job for SMTP — including its lesson:
 * key on CODES where a code exists, because prose gets reworded by libraries and servers and a
 * message-only matcher silently falls through to the generic case.
 */

/** What went wrong, as a tag the UI can branch on (icon, hint, whether to offer certificate pinning). */
export type DeployFailureKind =
  | 'dns' // the host name does not resolve
  | 'refused' // nothing is listening / egress blocked
  | 'unreachable' // no route to the host
  | 'timeout' // connected (or not) but nothing answered in time
  | 'reset' // the peer closed an established connection
  | 'rate-limit' // 421 and friends — too many connections, or a temporary block
  | 'tls-required' // the server refuses to proceed without encryption
  | 'tls-unsupported' // we asked to encrypt and the server cannot
  | 'tls-protocol' // TLS spoken at the wrong moment (implicit vs explicit mismatch)
  | 'tls-cert' // the certificate could not be verified
  | 'tls-cert-pin' // a certificate was verified but is not the PINNED one
  | 'auth' // credentials rejected
  | 'key' // the private key could not be read or is passphrase-protected
  | 'host-key' // SSH host key did not match the pinned fingerprint
  | 'permission' // authenticated, but not allowed to write here
  | 'quota' // out of space on the target
  | 'path' // the remote directory does not exist / cannot be created
  | 'data-connection' // control channel fine, data channel could not be opened (PASV/firewall)
  | 'rsync' // rsync itself failed (its stderr carries the reason)
  | 'unknown';

/** A certificate offered by a server, reported so an operator can decide whether to trust it. */
export interface OfferedCertificate {
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  /** SHA-256 of the DER-encoded leaf, lowercase hex — what gets pinned as `certFingerprint`. */
  fingerprint256: string;
  /** Subject Alternative Names, so a hostname mismatch is visible rather than inferred. */
  altNames: string[];
  /** True when the certificate is outside its validity window right now. */
  expired: boolean;
  /** True when it is its own issuer. */
  selfSigned: boolean;
}

/** A described failure: one actionable sentence, plus the raw truth underneath it. */
export interface DeployFailure {
  kind: DeployFailureKind;
  /** One sentence, plain language, naming the cause. Safe to show to a project writer. */
  message: string;
  /** What to do about it. */
  hint?: string;
  /** The verbatim underlying error or server reply line. */
  detail?: string;
  /** The numeric FTP reply code, when the failure was an FTP reply. */
  replyCode?: number;
  /** The certificate the server offered, when the failure was certificate-related. */
  certificate?: OfferedCertificate;
  /** The tail of the control-channel conversation (FTP/FTPS), passwords redacted. */
  transcript?: string[];
}

/**
 * Where a transport parks its control-channel tail on the error it is about to throw.
 *
 * ★ A SYMBOL, not a property name. The error travels through code that pattern-matches on `message`
 * and `code`; a named property could collide with a library's own field or be picked up by something
 * serialising the error wholesale. `Symbol.for` keeps it reachable across module instances without
 * exporting a mutable registry.
 */
const TRANSCRIPT = Symbol.for('sitewright.deploy.transcript');

/** Stamps the control-channel tail onto a failing error so the route can report it. */
export function attachTranscript(err: unknown, lines: ReadonlyArray<string>): void {
  if (err !== null && typeof err === 'object' && lines.length > 0) {
    (err as Record<symbol, unknown>)[TRANSCRIPT] = [...lines];
  }
}

/** Reads back a tail stamped by {@link attachTranscript}. */
export function readTranscript(err: unknown): string[] | undefined {
  if (err === null || typeof err !== 'object') return undefined;
  const value = (err as Record<symbol, unknown>)[TRANSCRIPT];
  return Array.isArray(value) ? (value as string[]) : undefined;
}

/** The connection details a message can name without disclosing anything the caller doesn't have. */
export interface DeployEndpoint {
  protocol: string;
  host: string;
  port: number;
}

/** `where` as "host:port", for embedding in a sentence. */
function at(e: DeployEndpoint): string {
  return `${e.host}:${e.port}`;
}

/** Normalizes a node `fingerprint256` ("AB:CD:…") to bare lowercase hex. */
export function normalizeFingerprint(value: string): string {
  return value.trim().toLowerCase().replace(/:/g, '');
}

/** Summarizes a peer certificate for display (and for the pin the operator may accept). */
export function describeCertificate(cert: PeerCertificate): OfferedCertificate {
  // A DN attribute is `string | string[]` — a CN can legitimately appear more than once. Take the
  // first, so a multi-CN certificate reports a name instead of failing to typecheck into one.
  const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));
  const name = (parts: PeerCertificate['subject'] | undefined): string => {
    if (!parts) return '';
    // CN is what a human recognizes; fall back to O so an intermediate-only subject still reads.
    return first(parts.CN) || first(parts.O);
  };
  const now = Date.now();
  const from = Date.parse(cert.valid_from);
  const to = Date.parse(cert.valid_to);
  return {
    subject: name(cert.subject),
    issuer: name(cert.issuer),
    validFrom: cert.valid_from ?? '',
    validTo: cert.valid_to ?? '',
    fingerprint256: normalizeFingerprint(cert.fingerprint256 ?? ''),
    // `subjectaltname` is "DNS:a.example, DNS:b.example, IP Address:1.2.3.4".
    altNames: (cert.subjectaltname ?? '')
      .split(',')
      .map((s) => s.trim().replace(/^(DNS|IP Address):/, ''))
      .filter(Boolean),
    expired: Number.isFinite(from) && Number.isFinite(to) ? now < from || now > to : false,
    selfSigned: !!cert.subject && !!cert.issuer && name(cert.subject) === name(cert.issuer),
  };
}

/** Thrown when a server's certificate verified fine but is not the one pinned on the target. */
export class CertificatePinMismatchError extends Error {
  constructor(
    readonly expected: string,
    readonly offered: OfferedCertificate,
  ) {
    super(`the server's TLS certificate does not match the pinned fingerprint`);
    this.name = 'CertificatePinMismatchError';
  }
}

/** Reads a numeric FTP reply code off a basic-ftp `FTPError` (its `.code` is the reply code). */
function ftpReplyCode(err: unknown): number | undefined {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'number' && code >= 100 && code <= 599) return code;
  // Some paths stringify it; and a bare reply line starts with the code.
  if (typeof code === 'string' && /^[1-5]\d\d$/.test(code)) return Number(code);
  return undefined;
}

/** Reads a libuv/Node error code (`ECONNREFUSED`, `ERR_TLS_CERT_ALTNAME_INVALID`, …). */
function systemCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && !/^\d+$/.test(code) ? code : '';
}

/**
 * FTP reply codes worth naming. Keyed on the CODE, with the server's own text carried through as
 * `detail` — the text varies by server (vsftpd/ProFTPD/Pure-FTPd/FileZilla/IIS all word 530
 * differently) but the code does not.
 */
function describeFtpReply(code: number, raw: string, e: DeployEndpoint): DeployFailure | null {
  switch (code) {
    case 421:
      return {
        kind: 'rate-limit',
        message: `${at(e)} accepted the connection and then closed it before login (FTP 421).`,
        hint:
          'This is the server turning you away, not a credential problem — usually a per-IP connection ' +
          'limit, a "too many users" cap, or an automatic block after repeated attempts (fail2ban and ' +
          'cPanel cPHulk both default to a 10-minute ban, which is why it starts working again on its ' +
          'own). The server\'s own words are below; if they mention connections or users, wait for the ' +
          'block to lapse rather than retrying, since each retry can extend it.',
        detail: raw,
        replyCode: code,
      };
    case 425:
    case 426:
      return {
        kind: 'data-connection',
        message: `The control connection to ${at(e)} works, but the data connection for the transfer could not be opened (FTP ${code}).`,
        hint:
          'Passive-mode FTP needs a second connection on a high port. Check that the server advertises a ' +
          'reachable passive address and that its passive port range is open in its firewall.',
        detail: raw,
        replyCode: code,
      };
    case 430:
    case 530:
      // 530 is overloaded: "not logged in" AND "you must encrypt first" both use it.
      if (/encrypt|tls|ssl|secure/i.test(raw)) {
        return {
          kind: 'tls-required',
          message: `${at(e)} requires an encrypted connection and refused a plain FTP login (FTP ${code}).`,
          hint: 'Switch this target to FTPS (TLS).',
          detail: raw,
          replyCode: code,
        };
      }
      return {
        kind: 'auth',
        message: `${at(e)} rejected the username or password (FTP ${code}).`,
        hint:
          'Re-enter the password — a saved credential is never shown back, so a stale one looks identical ' +
          'to a correct one. Some panels also require the full "user@domain" form as the FTP username.',
        detail: raw,
        replyCode: code,
      };
    case 522:
    case 534:
      return {
        kind: 'tls-required',
        message: `${at(e)} refused the connection on policy grounds — it requires TLS (FTP ${code}).`,
        hint: 'Switch this target to FTPS (TLS).',
        detail: raw,
        replyCode: code,
      };
    case 500:
    case 502:
    case 504:
      return {
        kind: 'tls-unsupported',
        message: `${at(e)} does not understand a command this transfer needs (FTP ${code}).`,
        hint:
          'If this happened while starting TLS, the server does not offer FTPS on this port — use plain ' +
          'FTP, or the port your host documents for FTPS.',
        detail: raw,
        replyCode: code,
      };
    case 532:
    case 550:
      return {
        kind: /no such file|not found|directory/i.test(raw) ? 'path' : 'permission',
        message: `${at(e)} refused the operation (FTP ${code}).`,
        hint:
          'The login worked, so this is about the remote directory: check that it exists and that this ' +
          'account may write to it. A remote directory is relative to whatever the account is chrooted to.',
        detail: raw,
        replyCode: code,
      };
    case 552:
      return {
        kind: 'quota',
        message: `${at(e)} is out of space for this account (FTP 552).`,
        hint: 'Free space on the target, or raise the account quota, then deploy again.',
        detail: raw,
        replyCode: code,
      };
    case 553:
      return {
        kind: 'permission',
        message: `${at(e)} rejected a file name in the build (FTP 553).`,
        detail: raw,
        replyCode: code,
      };
    default:
      return null;
  }
}

/** Node/libuv socket + TLS failures, which is everything that happens before a reply code exists. */
function describeSocket(code: string, raw: string, e: DeployEndpoint): DeployFailure | null {
  // ★ Matched on the CODE *or* the message. A code is the reliable signal, but not every layer
  // preserves one: isomorphic-git and node-fetch wrap the original error and leave the libuv code
  // only in the prose ("... failed, reason: connect ECONNREFUSED 127.0.0.1:443"). Keying on the code
  // alone therefore dropped every git transport failure into the generic bucket.
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || /getaddrinfo|ENOTFOUND|EAI_AGAIN/i.test(raw)) {
    return {
      kind: 'dns',
      message: `The host name "${e.host}" could not be resolved.`,
      hint: 'Check it for a typo. Use the server\'s host name or IP — not the website address, unless they are the same machine.',
      detail: raw,
    };
  }
  if (code === 'ECONNREFUSED' || /ECONNREFUSED/i.test(raw)) {
    return {
      kind: 'refused',
      message: `Nothing accepted a connection on ${at(e)}.`,
      hint: `Check the port (${e.port}) and that the server allows connections from this machine's IP.`,
      detail: raw,
    };
  }
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || /EHOSTUNREACH|ENETUNREACH/i.test(raw)) {
    return { kind: 'unreachable', message: `There is no network route to ${at(e)}.`, detail: raw };
  }
  if (code === 'ETIMEDOUT' || code === 'ERR_SOCKET_CONNECTION_TIMEOUT' || /^Timeout|timed? ?out/i.test(raw)) {
    return {
      kind: 'timeout',
      message: `${at(e)} did not respond in time.`,
      hint:
        'Usually a firewall dropping the connection silently, or the wrong port. If the transfer had ' +
        'already started, the server stalled mid-upload — often a sign of load or a per-IP throttle.',
      detail: raw,
    };
  }
  if (code === 'ECONNRESET' || code === 'EPIPE' || /socket hang ?up|ECONNRESET|EPIPE/i.test(raw)) {
    return {
      kind: 'reset',
      message: `${at(e)} closed the connection unexpectedly.`,
      hint:
        'An abrupt close with no reply line usually means the server dropped you deliberately — an ' +
        'intrusion-prevention rule, a connection cap, or a TLS mismatch on the port.',
      detail: raw,
    };
  }
  // ── TLS ──
  if (code === 'ERR_SSL_WRONG_VERSION_NUMBER' || code === 'EPROTO' || /wrong version number|packet length too long/i.test(raw)) {
    return {
      kind: 'tls-protocol',
      message: `${at(e)} did not speak TLS when it was expected to.`,
      hint:
        'The TLS mode does not match the port. Implicit TLS is encrypted from the first byte (usually ' +
        'port 990); explicit TLS starts in the clear and upgrades with AUTH TLS (usually port 21). Swap ' +
        'the mode, or use the port your host documents for it.',
      detail: raw,
    };
  }
  if (
    /self.signed|unable to (verify|get local issuer)|DEPTH_ZERO|SELF_SIGNED|UNABLE_TO_VERIFY|CERT_HAS_EXPIRED|ALTNAME|Hostname\/IP does not match|certificate/i.test(
      raw + ' ' + code,
    )
  ) {
    const mismatch = /ALTNAME|Hostname\/IP does not match/i.test(raw + ' ' + code);
    return {
      kind: 'tls-cert',
      message: mismatch
        ? `The TLS certificate at ${at(e)} is valid but was issued for a different host name.`
        : `The TLS certificate at ${at(e)} could not be verified.`,
      hint:
        'This is normal on shared hosting, where FTPS presents the hosting company\'s own certificate ' +
        'rather than one for your domain. Review the certificate below and pin it if you recognise it — ' +
        'that accepts exactly this certificate for this target, and nothing else.',
      detail: raw,
    };
  }
  return null;
}

/** ssh2 / SFTP failures, which report as prose rather than codes. */
function describeSsh(raw: string, e: DeployEndpoint): DeployFailure | null {
  if (/All configured authentication methods failed/i.test(raw)) {
    return {
      kind: 'auth',
      message: `${at(e)} rejected every credential offered.`,
      hint:
        'For password auth, re-enter the password. For key auth, check the PUBLIC half of this key is in ' +
        'the account\'s ~/.ssh/authorized_keys, and that the server permits that key type.',
      detail: raw,
    };
  }
  if (/Cannot parse privateKey|Unsupported key format|bad passphrase|Encrypted private key detected/i.test(raw)) {
    return {
      kind: 'key',
      message: 'The private key could not be read.',
      hint:
        'Paste the whole key including its BEGIN and END lines. If it is passphrase-protected, supply ' +
        'the passphrase — an encrypted key with no passphrase fails exactly like a malformed one.',
      detail: raw,
    };
  }
  if (/Host (key )?verification failed|handshake failed.*host key|hostVerifier/i.test(raw)) {
    return {
      kind: 'host-key',
      message: `The SSH host key at ${e.host} does not match the pinned fingerprint.`,
      hint:
        'Either the server was rebuilt or rekeyed, or the connection is being intercepted. Confirm the ' +
        'new fingerprint out of band before clearing or updating the pin.',
      detail: raw,
    };
  }
  if (/no matching (key exchange|cipher|host key|MAC)/i.test(raw)) {
    return {
      kind: 'unknown',
      message: `${at(e)} and this server could not agree on an SSH algorithm.`,
      hint: 'The server is likely very old or very hardened. Its SSH logs will name the algorithms it will accept.',
      detail: raw,
    };
  }
  return null;
}

/** rsync exits with a code that names the failure class; its stderr tail carries the specifics. */
function describeRsync(raw: string, e: DeployEndpoint): DeployFailure | null {
  const m = /rsync failed \(exit (\d+)\)/.exec(raw);
  if (!m) return null;
  const exit = Number(m[1]);
  const common = { detail: raw, kind: 'rsync' as const };
  if (exit === 12 || exit === 5)
    return {
      ...common,
      message: `rsync could not establish its session with ${e.host}.`,
      hint:
        'Almost always the SSH layer underneath: authentication, or the account being restricted to SFTP ' +
        'only. Turn "Transfer with rsync" off to use the per-file SFTP path, which needs no shell.',
    };
  if (exit === 23 || exit === 13)
    return { ...common, kind: 'permission', message: 'rsync transferred only part of the build — some files were refused by the target.', hint: 'Check write permissions on the remote directory.' };
  if (exit === 11) return { ...common, kind: 'quota', message: 'rsync could not write on the target — it reported a file I/O error (often a full disk or quota).' };
  if (exit === 30 || exit === 35) return { ...common, kind: 'timeout', message: `rsync timed out waiting for ${e.host}.` };
  if (exit === 127 || exit === 126) return { ...common, message: `rsync is not available on ${e.host}.`, hint: 'Turn "Transfer with rsync" off — the SFTP path needs nothing installed on the target.' };
  return { ...common, message: `rsync failed on ${e.host} (exit ${exit}).`, hint: "The server's own message is below." };
}

/**
 * git failures, which arrive in two dialects: the `git` binary's stderr (SSH remotes) and
 * isomorphic-git's error objects (HTTPS remotes, where an `HttpError` carries the status in `data`).
 *
 * ★ The distinction that matters here is READ vs WRITE access. A deploy token that can clone but not
 * push produces a 403 on `git-receive-pack` — which the old generic message rendered identically to a
 * bad token, sending operators to regenerate a credential that was never the problem.
 */
function describeGit(err: unknown, raw: string, e: DeployEndpoint): DeployFailure | null {
  const status = (err as { data?: { statusCode?: unknown } } | null)?.data?.statusCode;
  const code = typeof status === 'number' ? status : /\b(401|403|404)\b/.exec(raw) ? Number(/\b(401|403|404)\b/.exec(raw)![1]) : undefined;

  if (code === 401 || /Authentication failed|Invalid username or password|could not read Username/i.test(raw)) {
    return {
      kind: 'auth',
      message: `${e.host} rejected the access token.`,
      hint:
        'Regenerate the token and check its scope — a classic GitHub token needs `repo`, a fine-grained ' +
        'one needs Contents: Read and write for this repository. An expired token fails identically to a wrong one.',
      detail: raw,
    };
  }
  if (code === 403 || /denied to|write access|not authorized|permission to .* denied/i.test(raw)) {
    return {
      kind: 'permission',
      message: `${e.host} accepted the credential but refuses to let it PUSH.`,
      hint:
        'Read access works and write access does not — so the credential is valid and under-scoped, not ' +
        'wrong. Grant it write access to this repository (or, for a deploy key, tick "Allow write access").',
      detail: raw,
    };
  }
  if (code === 404 || /Repository not found|does not appear to be a git repository|not found/i.test(raw)) {
    return {
      kind: 'path',
      message: `${e.host} has no repository at that path — or the credential cannot see it.`,
      hint:
        'A private repository the credential lacks access to is reported as "not found" rather than ' +
        '"forbidden", deliberately, so check the URL AND the credential\'s access to it.',
      detail: raw,
    };
  }
  if (/Permission denied \(publickey|no matching host key|Could not read from remote repository/i.test(raw)) {
    return {
      kind: 'auth',
      message: `${e.host} rejected the SSH key.`,
      hint: 'Add the PUBLIC half of this key to the repository as a deploy key (with write access), or to the account.',
      detail: raw,
    };
  }
  if (/Could not resolve host/i.test(raw)) {
    return { kind: 'dns', message: `The host name "${e.host}" could not be resolved.`, hint: 'Check the repository URL for a typo.', detail: raw };
  }
  return null;
}

/**
 * Describes ANY deploy/test failure as an actionable result.
 *
 * Order matters: a certificate PIN mismatch is our own error type and must not be re-matched by the
 * generic certificate prose rule below it; an FTP reply code beats prose because the code is stable;
 * and the socket/TLS rules run before the SSH ones because ECONNREFUSED reads the same on every
 * protocol. The fallback never invents a cause — it says only what is certain and carries the raw
 * error, which is still infinitely more than the constant string this replaced.
 */
export function describeDeployError(err: unknown, endpoint: DeployEndpoint): DeployFailure {
  const raw = err instanceof Error ? err.message : String(err);
  // Every branch below returns through here, so the transcript rides along whichever cause is named.
  const transcript = readTranscript(err);
  const withTranscript = (f: DeployFailure): DeployFailure => (transcript ? { ...f, transcript } : f);

  if (err instanceof CertificatePinMismatchError) {
    return withTranscript({
      kind: 'tls-cert-pin',
      message: `${at(endpoint)} presented a TLS certificate that is not the one pinned for this target.`,
      hint:
        'If you rotated the certificate (or your host did — Let\'s Encrypt renews every 90 days), review ' +
        'the new one below and pin it to continue. If you changed nothing, do not pin it: an unexpected ' +
        'certificate is what an intercepted connection looks like.',
      detail: `pinned ${err.expected.slice(0, 16)}…, offered ${err.offered.fingerprint256.slice(0, 16)}…`,
      certificate: err.offered,
    });
  }

  const reply = ftpReplyCode(err);
  if (reply !== undefined) {
    const described = describeFtpReply(reply, raw, endpoint);
    if (described) return withTranscript(described);
    return withTranscript({
      kind: reply >= 500 ? 'permission' : 'unknown',
      message: `${at(endpoint)} refused the request (FTP ${reply}).`,
      detail: raw,
      replyCode: reply,
    });
  }

  const code = systemCode(err);
  const socket = describeSocket(code, raw, endpoint);
  if (socket) return withTranscript(socket);

  // basic-ftp's own prose for a data connection it could not open (distinct from a 425 reply).
  if (/Can't open data connection|PASV returned another host|Can't parse response to 'PASV'|EPSV/i.test(raw)) {
    return withTranscript({
      kind: 'data-connection',
      message: `${at(endpoint)} logged in, but its data connection could not be opened.`,
      hint:
        'The server is advertising a passive address this machine cannot reach — typical when the FTP ' +
        'server sits behind NAT without a configured external address, or when its passive port range ' +
        'is firewalled. Its passive-mode settings are what to fix.',
      detail: raw,
    });
  }

  const rsync = describeRsync(raw, endpoint);
  if (rsync) return withTranscript(rsync);

  // Before the SSH rules: a git-over-SSH failure carries BOTH dialects, and the git-specific reading
  // (read vs write access) is the more useful of the two.
  const gitErr = describeGit(err, raw, endpoint);
  if (gitErr) return withTranscript(gitErr);

  const ssh = describeSsh(raw, endpoint);
  if (ssh) return withTranscript(ssh);

  return withTranscript({
    kind: 'unknown',
    message: `The deploy to ${at(endpoint)} failed.`,
    hint: 'The underlying error is below — it is the server\'s or the transport\'s own wording.',
    detail: raw,
  });
}
