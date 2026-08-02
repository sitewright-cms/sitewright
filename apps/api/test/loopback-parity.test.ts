import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { isLoopbackSmtpHost } from '../src/mail/mailer.js';
import { smtpClientPhp } from '../src/publish/contact-php.js';
import { phpAvailable } from './php-smtp-harness.js';

// "Is this host loopback?" decides whether a message may travel UNENCRYPTED — a loopback relay has
// no on-path attacker, anything else does. Two separate SMTP clients ask that question (the platform
// mailer in TypeScript, the exported contact.php in PHP), and a customer's guarantee must not depend
// on which one carries their mail. This runs the REAL emitted PHP — not a transcription of it —
// against the platform predicate, host for host.

/** The answer each side must give. `true` = loopback = may go unencrypted when there is no auth. */
const CASES: ReadonlyArray<readonly [host: string, loopback: boolean]> = [
  // Genuine loopback.
  ['localhost', true],
  ['LocalHost', true],
  ['  localhost  ', true],
  ['localhost.', true], // fully-qualified form of the same name
  ['127.0.0.1', true],
  ['127.0.0.53', true], // systemd-resolved's stub listener
  ['127.1.2.3', true], // all of 127.0.0.0/8
  ['::1', true],
  ['[::1]', true],
  ['0:0:0:0:0:0:0:1', true],

  // ★ Names that a prefix test mistakes for loopback. Each is a registrable hostname whose owner
  // decides where it resolves, so treating it as loopback hands the no-encryption exemption to a
  // host on the public internet.
  ['127.evil.com', false],
  ['127.0.0.1.evil.com', false],
  ['127.0.0.1.', true], // a trailing dot is the root label; still the same address
  ['localhost.evil.com', false],
  ['notlocalhost', false],
  ['localhost-evil.com', false],

  // Not addresses at all, or outside 127/8.
  ['1270.0.0.1', false],
  ['127.0.0.999', false],
  ['128.0.0.1', false],
  ['12.7.0.1', false],
  ['smtp.acme.com', false],
  ['', false],
];

/** Runs the emitted `sw_smtp_is_loopback` over the same hosts, in a real interpreter. */
function phpAnswers(hosts: readonly string[]): boolean[] {
  const script = `<?php
${smtpClientPhp(25)}
$hosts = json_decode('${JSON.stringify(hosts).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}', true);
$out = array();
foreach ($hosts as $h) { $out[] = sw_smtp_is_loopback($h); }
echo json_encode($out);
`;
  const res = spawnSync('php', ['-r', script.replace(/^<\?php\n/, '')], { encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`php failed: ${res.stderr || res.stdout}`);
  return JSON.parse(res.stdout) as boolean[];
}

describe.skipIf(!phpAvailable())('loopback recognition is identical in both SMTP clients', () => {
  it('★ agrees host-for-host with the platform mailer', () => {
    const hosts = CASES.map(([h]) => h);
    const fromPhp = phpAnswers(hosts);
    const disagreements = hosts
      .map((h, i) => ({ host: h, ts: isLoopbackSmtpHost(h), php: fromPhp[i]! }))
      .filter((r) => r.ts !== r.php);
    expect(disagreements).toEqual([]);
  });

  it('★ neither client accepts a hostname that merely LOOKS like loopback', () => {
    // The bug this pins: `/^127\./` and `strpos($host,'127.')===0` both accept these.
    const spoofs = ['127.evil.com', '127.0.0.1.evil.com', 'localhost.evil.com', '1270.0.0.1'];
    const fromPhp = phpAnswers(spoofs);
    for (const [i, host] of spoofs.entries()) {
      expect(isLoopbackSmtpHost(host), `TS accepted ${host}`).toBe(false);
      expect(fromPhp[i], `PHP accepted ${host}`).toBe(false);
    }
  });

  it('both accept every genuine form, so the carve-out still works where it should', () => {
    const real = CASES.filter(([, ok]) => ok).map(([h]) => h);
    const fromPhp = phpAnswers(real);
    for (const [i, host] of real.entries()) {
      expect(isLoopbackSmtpHost(host), `TS rejected ${host}`).toBe(true);
      expect(fromPhp[i], `PHP rejected ${host}`).toBe(true);
    }
  });
});

describe('isLoopbackSmtpHost', () => {
  it.each(CASES.map(([host, expected]) => ({ host, expected })))(
    'classifies $host as loopback=$expected',
    ({ host, expected }) => {
      expect(isLoopbackSmtpHost(host)).toBe(expected);
    },
  );
});
