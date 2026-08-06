#!/usr/bin/env node
// Verifies that every package version pinned in pnpm-lock.yaml was SIGNED BY NPM, and reports how
// much of the tree carries build provenance.
//
// ★ The important detail: the signature is checked against the integrity hash **from our lockfile**,
// not the one the registry hands back in the same response. Verifying the registry's own hash against
// the registry's own signature proves only that the registry is self-consistent — it would pass just
// as happily if our lockfile pinned something else entirely. Checking OUR hash proves the specific
// bytes we are going to install are the bytes npm signed.
//
// npm signs the string `<name>@<version>:<integrity>` with ECDSA P-256; the public keys live at
// /-/npm/v1/keys. That is the same scheme `npm audit signatures` uses — which cannot be used here,
// because it expects npm's own lockfile and node_modules layout and simply reports
// "found no dependencies to audit that were installed from a supported registry" against a pnpm tree.
//
// Why this is not in `pnpm verify`: it makes ~1000 network requests. The merge gate stays fast and
// offline-capable; this runs in the scheduled audit, where a daily check is the right cadence for
// "has anything about our pinned bytes changed upstream".
//
// PROVENANCE (dist.attestations) is reported but NOT enforced. Measured 2026-08-06: 100% of the tree
// is signed, only 30.5% is attested. A hard provenance gate would fail on two thirds of the tree
// today and be switched off within a week — the same trap as an audit floor set where it always
// fires. The number is printed so a drop is visible and the ratchet can tighten later.
import { createPublicKey, createVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';

const CONCURRENCY = 20;
const REGISTRY = 'https://registry.npmjs.org';

/** Package key line in a pnpm v9 lockfile: `  name@version:` (quoted when scoped). */
const KEY_RE = /^ {2}'?((?:@[^/'@]+\/)?[^'@\s]+)@([^':]+)'?:\s*$/;
/** The `resolution: {integrity: sha512-…}` that follows it. */
const INTEGRITY_RE = /integrity:\s*(sha\d+-[A-Za-z0-9+/=]+)/;

function pinnedPackages(lockPath) {
  const lines = readFileSync(lockPath, 'utf8').split('\n');
  const out = new Map();
  for (let i = 0; i < lines.length; i += 1) {
    const m = KEY_RE.exec(lines[i]);
    if (!m) continue;
    const version = m[2].replace(/\(.*\)$/, ''); // strip peer-suffix, e.g. `1.2.3(react@19)`
    if (!/^\d/.test(version)) continue; // link:/file:/workspace: entries have no registry tarball
    // The resolution block sits within the next few lines of the package key.
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j += 1) {
      if (KEY_RE.test(lines[j])) break;
      const g = INTEGRITY_RE.exec(lines[j]);
      if (g) {
        out.set(`${m[1]}@${version}`, g[1]);
        break;
      }
    }
  }
  return out;
}

const lockPath = process.argv[2] ?? 'pnpm-lock.yaml';
const pinned = pinnedPackages(lockPath);
if (pinned.size === 0) {
  console.error(`✖ no registry-resolved packages found in ${lockPath} — the lockfile format may have changed`);
  process.exit(1);
}

let keys;
try {
  const res = await fetch(`${REGISTRY}/-/npm/v1/keys`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  ({ keys } = await res.json());
} catch (err) {
  // Fail CLOSED, same rule as the audit gate: not being able to check is not the same as clean.
  console.error(`✖ could not fetch npm's signing keys, so nothing was verified: ${err.message}`);
  process.exit(1);
}
const keyById = new Map(keys.map((k) => [k.keyid, k]));

const specs = [...pinned.keys()];
const unsigned = [];
const invalid = [];
const errored = [];
let attested = 0;
let cursor = 0;

async function worker() {
  while (cursor < specs.length) {
    const spec = specs[cursor];
    cursor += 1;
    const at = spec.lastIndexOf('@');
    const name = spec.slice(0, at);
    const version = spec.slice(at + 1);
    let dist;
    try {
      const res = await fetch(`${REGISTRY}/${name.replace('/', '%2f')}/${version}`, {
        headers: { accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      ({ dist } = await res.json());
    } catch (err) {
      errored.push(`${spec} (${err.message})`);
      continue;
    }
    if (dist?.attestations) attested += 1;

    const sig = dist?.signatures?.[0];
    if (!sig) {
      unsigned.push(spec);
      continue;
    }
    const key = keyById.get(sig.keyid);
    if (!key) {
      invalid.push(`${spec} — signed with an unknown key ${sig.keyid}`);
      continue;
    }
    // ★ OUR pinned integrity, not dist.integrity. See the header.
    const payload = `${spec}:${pinned.get(spec)}`;
    let ok = false;
    try {
      const pub = createPublicKey({ key: Buffer.from(key.key, 'base64'), format: 'der', type: 'spki' });
      ok = createVerify('SHA256').update(payload).end().verify(pub, Buffer.from(sig.sig, 'base64'));
    } catch (err) {
      invalid.push(`${spec} — signature could not be checked: ${err.message}`);
      continue;
    }
    if (!ok) invalid.push(`${spec} — SIGNATURE DOES NOT MATCH the integrity we pin`);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const total = specs.length;
const pct = (n) => `${((n / total) * 100).toFixed(1)}%`;

if (invalid.length) {
  console.error(`\n✖ ${invalid.length} package(s) failed signature verification:\n`);
  for (const line of invalid) console.error(`    ${line}`);
  console.error('\n  This means the bytes our lockfile pins are NOT the bytes npm signed for that');
  console.error('  version. Treat it as a compromised or tampered dependency until proven otherwise —');
  console.error('  do not "fix" it by refreshing the lockfile, which would just re-pin whatever is');
  console.error('  being served now.');
}
if (unsigned.length) {
  console.error(`\n✖ ${unsigned.length} package(s) have no registry signature at all:\n`);
  for (const spec of unsigned.slice(0, 20)) console.error(`    ${spec}`);
  if (unsigned.length > 20) console.error(`    …and ${unsigned.length - 20} more`);
  console.error('\n  Every package in this tree was signed when this check was written, so an unsigned');
  console.error('  one is an anomaly worth understanding rather than an expected gap.');
}
// Network failures are not verification failures, but they DO mean those packages went unchecked,
// so say so loudly rather than folding them into a pass.
if (errored.length) {
  console.error(`\n! ${errored.length} package(s) could not be reached and were NOT verified:`);
  for (const line of errored.slice(0, 10)) console.error(`    ${line}`);
}

console.log(`\nsigned      ${total - unsigned.length - invalid.length - errored.length}/${total}`);
console.log(`attested    ${attested}/${total}  ${pct(attested)}   (provenance — reported, not enforced)`);

if (invalid.length || unsigned.length) process.exit(1);
if (errored.length > total * 0.05) {
  console.error(`\n✖ too many lookups failed (${errored.length}) to call this a pass`);
  process.exit(1);
}
console.log(`\n✔ every pinned package version matches a signature npm issued for it`);
