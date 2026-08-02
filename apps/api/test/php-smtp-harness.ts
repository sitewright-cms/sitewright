import net from 'node:net';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
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

export type { TestCert, SmtpTranscript, FakeSmtp, FakeSmtpOptions } from './smtp-server.js';
export { makeCert, startFakeSmtp } from './smtp-server.js';

/** A stand-in for the host's `sendmail`, so PHP's `mail()` can actually succeed under test. */
export interface SendmailCapture {
  /** Value for PHP's `sendmail_path` ini setting. */
  iniSetting: string;
  /** Everything `mail()` has piped to it so far (headers + body), or '' if it never ran. */
  read: () => Promise<string>;
  cleanup: () => Promise<void>;
}

/**
 * Creates a capturing replacement for `sendmail`.
 *
 * WHY: `mail()` is the oldest export delivery mode and nothing has ever executed it successfully —
 * a test box has no MTA, so the call returns false and every test could assert was the 502. Pointing
 * `sendmail_path` at a script that keeps stdin makes the path real: the message is produced, handed
 * over, and can be read back and asserted.
 *
 * The script ignores its arguments on purpose — PHP may invoke it with `-t -i`, and a naive
 * `cat > file` would treat those as filenames and fail in a way that looks like a mail failure.
 */
export async function makeSendmailCapture(): Promise<SendmailCapture> {
  const dir = await mkdtemp(join(tmpdir(), 'sw-sendmail-'));
  const out = join(dir, 'captured.eml');
  const script = join(dir, 'sendmail.sh');
  await writeFile(script, `#!/bin/sh\ncat >> '${out}'\n`, { encoding: 'utf8', mode: 0o755 });
  return {
    iniSetting: `sendmail_path=${script}`,
    read: async () => {
      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- a path this function just made
        return await readFile(out, 'utf8');
      } catch {
        return ''; // mail() never ran
      }
    },
    cleanup: () => rm(dir, { recursive: true, force: true }),
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
