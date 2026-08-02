import net from 'node:net';
import tls from 'node:tls';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Test harness for the GENERATED contact.php: a scripted SMTP server (plain, STARTTLS or implicit
// TLS) plus PHP's built-in web server, so the emitted code is exercised the way a customer's host
// runs it — a real HTTP POST, a real socket, a real SMTP dialogue.
//
// Why a web server rather than `php contact.php`: under the CLI SAPI `php://input` is ALWAYS empty
// (it only maps to the request body under a web SAPI), so a CLI run can never get past the
// `json_decode` guard and would silently test nothing.

/** True when a `php` binary is on PATH — the PHP-executing suites skip without one. */
export function phpAvailable(): boolean {
  try {
    return spawnSync('php', ['--version'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
}

/** A self-signed cert that is ALSO its own CA, so PHP can verify the peer against it. */
export interface TestCert {
  key: string;
  cert: string;
  /** Path to the PEM, for PHP's `openssl.cafile`. */
  caFile: string;
  dir: string;
}

/** Generates a throwaway cert for 127.0.0.1 (openssl CLI; the suite skips when absent). */
export async function makeCert(): Promise<TestCert> {
  const dir = await mkdtemp(join(tmpdir(), 'sw-php-cert-'));
  const key = join(dir, 'key.pem');
  const cert = join(dir, 'cert.pem');
  const res = spawnSync(
    'openssl',
    ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', key, '-out', cert, '-days', '1', '-nodes',
     '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-addext', 'basicConstraints=critical,CA:TRUE'],
    { stdio: 'ignore' },
  );
  if (res.status !== 0) throw new Error('openssl failed to generate a test certificate');
  const { readFile } = await import('node:fs/promises');
  return { key: await readFile(key, 'utf8'), cert: await readFile(cert, 'utf8'), caFile: cert, dir };
}

/** What the fake SMTP server observed. */
export interface SmtpTranscript {
  /** Every command line, in order. TLS-phase lines are prefixed `[tls] `. */
  commands: string[];
  /** The DATA payload, as the server received it (still dot-stuffed). */
  rawData: string[];
  /** The argument of `AUTH PLAIN`, base64 as sent (null when AUTH never happened). */
  authPlain: string | null;
  /** True once the connection was upgraded via STARTTLS. */
  upgraded: boolean;
}

export interface FakeSmtp {
  port: number;
  transcript: SmtpTranscript;
  /** Resolves when the client disconnects. */
  finished: Promise<void>;
  close: () => Promise<void>;
}

export interface FakeSmtpOptions {
  /** Advertise STARTTLS in the EHLO response (and honour it). */
  offerStartTls?: boolean;
  /** Serve implicit TLS from the first byte (port 465 style). */
  implicitTls?: boolean;
  /** Reject AUTH with 535. */
  rejectAuth?: boolean;
  /** Reject RCPT TO with 550. */
  rejectRecipient?: boolean;
  /**
   * Append these bytes to the STARTTLS "220" reply, in the SAME write, before the handshake —
   * i.e. what an on-path attacker injects to have the client read them back as though they had
   * arrived inside the encrypted session (RFC 3207 §6).
   */
  injectAfterStartTls?: string;
  cert?: TestCert;
}

/** Starts a scripted SMTP server on an ephemeral port. */
export async function startFakeSmtp(options: FakeSmtpOptions = {}): Promise<FakeSmtp> {
  const transcript: SmtpTranscript = { commands: [], rawData: [], authPlain: null, upgraded: false };
  let resolveFinished: () => void;
  const finished = new Promise<void>((r) => (resolveFinished = r));

  const speak = (sock: net.Socket | tls.TLSSocket, phase: '' | '[tls] '): void => {
    sock.setEncoding('utf8');
    let buffer = '';
    let inData = false;
    const onData = (chunk: string): void => {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            transcript.commands.push(`${phase}<END-OF-DATA>`);
            sock.write('250 2.0.0 queued\r\n');
          } else {
            transcript.rawData.push(line);
          }
          continue;
        }
        transcript.commands.push(`${phase}${line}`);
        const up = line.toUpperCase();
        if (up.startsWith('EHLO')) {
          const starttls = options.offerStartTls && phase === '' ? '250-STARTTLS\r\n' : '';
          sock.write(`250-fake greets you\r\n250-PIPELINING\r\n${starttls}250-AUTH PLAIN LOGIN\r\n250 HELP\r\n`);
        } else if (up.startsWith('AUTH PLAIN')) {
          transcript.authPlain = line.slice('AUTH PLAIN '.length);
          sock.write(options.rejectAuth ? '535 5.7.8 bad credentials\r\n' : '235 2.7.0 ok\r\n');
        } else if (up === 'STARTTLS') {
          if (!options.offerStartTls || !options.cert) {
            sock.write('454 4.7.0 TLS unavailable\r\n');
            continue;
          }
          sock.write(`220 2.0.0 ready to start TLS\r\n${options.injectAfterStartTls ?? ''}`);
          sock.removeListener('data', onData);
          transcript.upgraded = true;
          const upgraded = new tls.TLSSocket(sock as net.Socket, {
            isServer: true,
            key: options.cert.key,
            cert: options.cert.cert,
          });
          speak(upgraded, '[tls] ');
          return;
        } else if (up.startsWith('MAIL FROM')) {
          sock.write('250 2.1.0 ok\r\n');
        } else if (up.startsWith('RCPT TO')) {
          sock.write(options.rejectRecipient ? '550 5.1.1 no such user\r\n' : '250 2.1.5 ok\r\n');
        } else if (up === 'DATA') {
          inData = true;
          sock.write('354 end with .\r\n');
        } else if (up === 'QUIT') {
          sock.write('221 2.0.0 bye\r\n');
          sock.end();
        } else {
          sock.write('250 2.0.0 ok\r\n');
        }
      }
    };
    sock.on('data', onData);
    sock.on('error', () => {}); // a client abort mid-handshake is a valid outcome under test
  };

  const onConnection = (sock: net.Socket | tls.TLSSocket): void => {
    sock.write('220 fake ESMTP ready\r\n');
    speak(sock, options.implicitTls ? '' : '');
    sock.on('close', () => resolveFinished());
  };

  const server =
    options.implicitTls && options.cert
      ? tls.createServer({ key: options.cert.key, cert: options.cert.cert }, onConnection)
      : net.createServer(onConnection);
  server.on('tlsClientError', () => resolveFinished()); // verification failure = no session at all

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    transcript,
    finished,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

export interface PhpSite {
  base: string;
  dir: string;
  stop: () => Promise<void>;
}

/** Writes `files` into a temp dir and serves it with PHP's built-in server. */
export async function startPhpSite(files: Record<string, string>, phpIni: string[] = []): Promise<PhpSite> {
  const dir = await mkdtemp(join(tmpdir(), 'sw-php-site-'));
  for (const [name, content] of Object.entries(files)) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- test-controlled names under a private temp dir
    await writeFile(join(dir, name), content, 'utf8');
  }
  // Claim an ephemeral port, then hand it to PHP (it has no "port 0" mode).
  const probe = net.createServer();
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as net.AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));

  const args = [...phpIni.flatMap((i) => ['-d', i]), '-S', `127.0.0.1:${port}`, '-t', dir];
  const proc: ChildProcess = spawn('php', args, { stdio: ['ignore', 'ignore', 'ignore'] });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 200; i++) {
    try {
      await fetch(base);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  return {
    base,
    dir,
    stop: async () => {
      proc.kill('SIGKILL');
      await once(proc, 'exit').catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** POSTs a form submission to the served contact.php. */
export async function submit(site: PhpSite, body: unknown): Promise<{ status: number; text: string }> {
  const res = await fetch(`${site.base}/contact.php`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}
