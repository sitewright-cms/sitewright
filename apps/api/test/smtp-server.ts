import net from 'node:net';
import tls from 'node:tls';
import { spawnSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A scripted SMTP server for tests that need a REAL dialogue rather than a mocked transport.
//
// Shared deliberately: the exported contact.php speaks SMTP from PHP, and the platform mailer speaks
// it from nodemailer. Two hand-written fakes would drift, and the weaker one would quietly become
// the weaker guarantee — so both clients are held to the same server.
//
// It is also written to be ADVERSARIAL, which an off-the-shelf server is not: it can refuse to
// advertise STARTTLS, inject bytes before the handshake, stall after the greeting, or present an
// untrusted certificate. Those are the cases that catch downgrade bugs.

/** A self-signed cert that is ALSO its own CA, so a client can verify the peer against it. */
export interface TestCert {
  key: string;
  cert: string;
  /** Path to the PEM, for PHP's `openssl.cafile` or Node's `ca` option. */
  caFile: string;
  dir: string;
}

/** Generates a throwaway cert for 127.0.0.1 + ::1 + localhost (openssl CLI; suites skip without it). */
export async function makeCert(): Promise<TestCert> {
  const dir = await mkdtemp(join(tmpdir(), 'sw-php-cert-'));
  const key = join(dir, 'key.pem');
  const cert = join(dir, 'cert.pem');
  const res = spawnSync(
    'openssl',
    ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', key, '-out', cert, '-days', '1', '-nodes',
     '-subj', '/CN=localhost',
     // All three names, so the same cert serves an IPv4, IPv6 or by-hostname connection — the
     // DNS/family tests would otherwise fail on the NAME rather than on what they mean to test.
     '-addext', 'subjectAltName=IP:127.0.0.1,IP:::1,DNS:localhost',
     '-addext', 'basicConstraints=critical,CA:TRUE'],
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
  /** The two `AUTH LOGIN` continuation lines, base64 as sent, in the order the client sent them. */
  authLoginUser: string | null;
  authLoginPass: string | null;
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
  /** Reject only `AUTH PLAIN` (535) while honouring the `AUTH LOGIN` challenge — the real reason
   *  the LOGIN fallback exists, and the only way to exercise it end to end. */
  rejectPlainAuth?: boolean;
  /** Greet normally, then answer NOTHING — a black hole that keeps the socket open. The shape a
   *  per-operation timeout cannot bound, because each individual wait looks survivable. */
  stallAfterGreeting?: boolean;
  /** Reject RCPT TO with 550. */
  rejectRecipient?: boolean;
  /** Answer `MAIL FROM` with 530 until the session has authenticated — what a real relay does, and
   *  the only way to prove a client actually authenticated rather than merely sent an AUTH line. */
  requireAuth?: boolean;
  /**
   * Append these bytes to the STARTTLS "220" reply, in the SAME write, before the handshake —
   * i.e. what an on-path attacker injects to have the client read them back as though they had
   * arrived inside the encrypted session (RFC 3207 §6).
   */
  injectAfterStartTls?: string;
  /** Address to listen on. `::1` exercises the IPv6 path; default is IPv4 loopback. */
  bindHost?: string;
  /** Listen on a SPECIFIC port (25/465/587) instead of an ephemeral one. Only for the port-semantics
   *  matrix — everything else should stay on port 0 so suites never collide. */
  bindPort?: number;
  /** Mechanisms to advertise on the `AUTH` capability line. A server offering only one is how a
   *  client's choice of mechanism gets exercised — nodemailer picks from what is advertised and
   *  does NOT retry another after a 535. */
  authMechanisms?: string;
  cert?: TestCert;
}

/** Starts a scripted SMTP server on an ephemeral port. */
export async function startFakeSmtp(options: FakeSmtpOptions = {}): Promise<FakeSmtp> {
  const transcript: SmtpTranscript = {
    commands: [],
    rawData: [],
    authPlain: null,
    authLoginUser: null,
    authLoginPass: null,
    upgraded: false,
  };
  let resolveFinished: () => void;
  const finished = new Promise<void>((r) => (resolveFinished = r));
  let authenticated = false;

  const speak = (sock: net.Socket | tls.TLSSocket, phase: '' | '[tls] '): void => {
    sock.setEncoding('utf8');
    let buffer = '';
    let inData = false;
    // AUTH LOGIN is a challenge/response: the next two lines after it are base64 payloads, not
    // commands, so the dispatcher has to track where it is. Without this the server answered the
    // generic "250 ok" to `AUTH LOGIN`, the client's chain died on the first step expecting 334,
    // and the username/password lines were never sent — the fallback looked tested but wasn't.
    let authStage: '' | 'user' | 'pass' = '';
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
        if (options.stallAfterGreeting) continue; // record it, answer nothing, hold the socket open
        if (authStage === 'user') {
          transcript.authLoginUser = line;
          authStage = 'pass';
          sock.write('334 UGFzc3dvcmQ6\r\n'); // base64("Password:")
          continue;
        }
        if (authStage === 'pass') {
          transcript.authLoginPass = line;
          authStage = '';
          if (options.rejectAuth) {
            sock.write('535 5.7.8 bad credentials\r\n');
          } else {
            authenticated = true;
            sock.write('235 2.7.0 ok\r\n');
          }
          continue;
        }
        const up = line.toUpperCase();
        if (up === 'AUTH LOGIN') {
          if (options.rejectAuth && !options.rejectPlainAuth) {
            sock.write('535 5.7.8 bad credentials\r\n');
            continue;
          }
          authStage = 'user';
          sock.write('334 VXNlcm5hbWU6\r\n'); // base64("Username:")
          continue;
        }
        if (up.startsWith('EHLO') || up.startsWith('HELO')) {
          const starttls = options.offerStartTls && phase === '' ? '250-STARTTLS\r\n' : '';
          const mechs = options.authMechanisms ?? 'PLAIN LOGIN';
          sock.write(`250-fake greets you\r\n250-PIPELINING\r\n${starttls}250-AUTH ${mechs}\r\n250 HELP\r\n`);
        } else if (up.startsWith('AUTH PLAIN')) {
          transcript.authPlain = line.slice('AUTH PLAIN '.length);
          if (options.rejectAuth || options.rejectPlainAuth) {
            sock.write('535 5.7.8 bad credentials\r\n');
          } else {
            authenticated = true;
            sock.write('235 2.7.0 ok\r\n');
          }
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
          // A relay that demands authentication answers 530 until it has it. Without this a client
          // that skipped AUTH entirely would still sail through to a queued message, and the test
          // would be proving nothing about authentication at all.
          sock.write(options.requireAuth && !authenticated ? '530 5.7.0 authentication required\r\n' : '250 2.1.0 ok\r\n');
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
    speak(sock, '');
    sock.on('close', () => resolveFinished());
  };

  const server =
    options.implicitTls && options.cert
      ? tls.createServer({ key: options.cert.key, cert: options.cert.cert }, onConnection)
      : net.createServer(onConnection);
  server.on('tlsClientError', () => resolveFinished()); // verification failure = no session at all

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject); // a taken/privileged port must surface, not hang
    server.listen(options.bindPort ?? 0, options.bindHost ?? '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    transcript,
    finished,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
