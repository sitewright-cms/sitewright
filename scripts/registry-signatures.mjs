#!/usr/bin/env node
// Verifies that package versions pinned in pnpm-lock.yaml were SIGNED BY NPM, and reports how much
// of the tree carries build provenance.
//
// ★ PROVENANCE IS REPORTED, NEVER ENFORCED — and the measurement says why. Sweeping the whole tree
// (2026-08-09): 323/968 attested overall, and splitting that by who chose the dependency does NOT
// rescue it — DIRECT dependencies are 36/95 (37.9%), transitive 236/730 (32.3%). The obvious fallback
// ("we cannot gate the tree, but we can gate what we picked") therefore fails too: 59 of the 95
// packages this repo chose have no provenance, among them react, typescript, eslint, fastify,
// handlebars and jsdom. A gate there would fail on every install and be switched off within a week,
// which is the failure mode the audit floor was already rewritten once to avoid.
//
// So the split is printed, the unattested DIRECT packages are named, and nothing fails. The number to
// watch is not the ratio — that mostly measures npm's ecosystem — but a package that HAD provenance
// and stopped: that is a change in someone's release pipeline, and it is worth a human looking.
//
// ★ The signature is checked against the integrity hash **from our lockfile**, not the one the
// registry returns in the same response. Verifying the registry's own hash against the registry's own
// signature proves only that the registry is self-consistent — it would pass just as happily if our
// lockfile pinned something else entirely. Checking OUR hash proves the specific bytes we are going
// to install are the bytes npm signed.
//
// npm signs `<name>@<version>:<integrity>` with ECDSA P-256; public keys live at /-/npm/v1/keys.
// That is the scheme `npm audit signatures` uses — which cannot be used here, because it expects
// npm's own lockfile and node_modules layout and reports "found no dependencies to audit that were
// installed from a supported registry" against a pnpm tree.
//
// ★ WHAT THIS DOES NOT DEFEND AGAINST. The signing keys and the manifests come from the SAME origin
// over the same channel, with no independent trust anchor. An attacker who controls the registry or
// the network path can serve a forged manifest, a forged signature, and a matching forged key, all
// self-consistent. This check therefore protects against a TAMPERED LOCKFILE under an honest
// registry — someone editing an integrity hash, or a resolution being silently re-pinned — and not
// against a hostile registry. npm's own tooling has the same property; stating it because a control
// that quietly implies more than it delivers is worse than no control.
//
// MODES
//   (default)          verify every registry-resolved package in the lockfile
//   --changed <ref>    verify only entries whose integrity was ADDED or CHANGED vs <ref>
//
// `--changed` is what the merge gate runs: it is a function of the diff (usually zero packages, so
// zero network calls and no offline penalty), and it checks the moment that actually matters — when
// a lockfile entry is written. The scheduled audit runs the full sweep, which is a function of time.
// If the base ref cannot be resolved, --changed falls back to the FULL sweep rather than skipping:
// not being able to work out what changed is not a reason to check nothing.
import { createPublicKey, createVerify } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const CONCURRENCY = 20;
const REGISTRY = 'https://registry.npmjs.org';
const LOCKFILE = 'pnpm-lock.yaml';
/** Above this share of unreachable packages, the run is not a pass — it is an unfinished check. */
const MAX_UNREACHABLE_RATIO = 0.05;

/**
 * The dependency names THIS repo chooses — every `dependencies` / `devDependencies` /
 * `optionalDependencies` / `peerDependencies` entry across the workspace.
 *
 * ★ Why the split matters more than the total. Provenance coverage across a whole tree is a fact
 * about npm's ecosystem, not about this repo: two thirds of it is transitive packages nobody here
 * picked, and a gate on that number could only ever be turned off. The DIRECT set is the part that is
 * actually a decision — so it is the only part where "must have provenance" could become a rule, and
 * the only number worth watching for regressions.
 */
function directDependencyNames() {
  const names = new Set();
  let manifests;
  try {
    manifests = execFileSync('git', ['ls-files', '*package.json'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    return names; // not a git checkout — the split is simply not reported
  }
  for (const file of manifests) {
    if (file.includes('node_modules/')) continue;
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      continue; // a fixture that is not valid JSON must not break the audit
    }
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const name of Object.keys(pkg[field] ?? {})) names.add(name);
    }
  }
  return names;
}

/** Package key line in a pnpm v9 lockfile: `  name@version:` (quoted when scoped). */
const KEY_RE = /^ {2}'?((?:@[^/'@]+\/)?[^'@\s]+)@([^':]+)'?:\s*$/;
const INTEGRITY_RE = /integrity:\s*(sha\d+-[A-Za-z0-9+/=]+)/;

/**
 * Every registry-resolved `name@version` -> the integrity WE pin.
 *
 * Also returns `skipped`: package keys that looked like registry entries but yielded no integrity.
 * Those must be surfaced, never dropped — a silently-shrinking denominator is how a check reports
 * "all N verified" while N itself quietly got smaller.
 */
function pinnedPackages(lockPath) {
  const lines = readFileSync(lockPath, 'utf8').split('\n');
  const pinned = new Map();
  const skipped = [];
  let inPackages = false;
  for (let i = 0; i < lines.length; i += 1) {
    // Only the `packages:` block carries resolutions; `snapshots:` repeats the same keys without them.
    if (/^[a-z]+:\s*$/.test(lines[i])) inPackages = lines[i].startsWith('packages:');
    if (!inPackages) continue;
    const m = KEY_RE.exec(lines[i]);
    if (!m) continue;
    const version = m[2].replace(/\(.*\)$/, '');
    if (!/^\d/.test(version)) continue; // link:/file:/workspace: — no registry tarball to verify
    const spec = `${m[1]}@${version}`;
    let integrity = null;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (KEY_RE.test(lines[j]) || /^[a-z]+:\s*$/.test(lines[j])) break;
      const g = INTEGRITY_RE.exec(lines[j]);
      if (g) {
        integrity = g[1];
        break;
      }
    }
    if (integrity) pinned.set(spec, integrity);
    else skipped.push(spec);
  }
  return { pinned, skipped };
}

/** Specs whose integrity line was added or changed relative to `ref`, or null if ref is unusable. */
function changedSpecs(ref) {
  let diff;
  try {
    // Diff the WORKING TREE against the branch point, not `ref...HEAD`. The gate runs on the files
    // as they are on disk, so a commit-to-commit diff misses an edit that has not been committed yet
    // — which is precisely the state a developer is in when they run `pnpm verify` before pushing.
    // Measured: with `ref...HEAD`, a tampered-but-uncommitted integrity produced a clean pass.
    // The merge-base rather than `ref` itself so that commits landing on main meanwhile are not
    // mistaken for changes made here.
    const base = execFileSync('git', ['merge-base', ref, 'HEAD'], { encoding: 'utf8' }).trim();
    diff = execFileSync('git', ['diff', '--unified=0', base, '--', LOCKFILE], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
  // An added integrity line is preceded, within the hunk, by the package key it belongs to. Rather
  // than reconstruct that, take every added integrity VALUE and map it back through the parsed
  // lockfile — the integrity is unique per package version, so the mapping is unambiguous.
  const added = new Set();
  for (const line of diff.split('\n')) {
    if (!line.startsWith('+')) continue;
    const g = INTEGRITY_RE.exec(line);
    if (g) added.add(g[1]);
  }
  return added;
}

const args = process.argv.slice(2);
const changedIdx = args.indexOf('--changed');
const baseRef = changedIdx === -1 ? null : (args[changedIdx + 1] ?? 'origin/main');

const { pinned, skipped } = pinnedPackages(LOCKFILE);
if (pinned.size === 0) {
  console.error(`✖ no registry-resolved packages found in ${LOCKFILE} — the lockfile format may have changed`);
  process.exit(1);
}
if (skipped.length) {
  console.error(`\n✖ ${skipped.length} package key(s) yielded no integrity and would have gone UNVERIFIED:\n`);
  for (const s of skipped.slice(0, 20)) console.error(`    ${s}`);
  console.error('\n  Failing rather than quietly verifying a smaller set than the lockfile contains.');
  process.exit(1);
}

let specs = [...pinned.keys()];
let scope = `all ${specs.length}`;
if (baseRef) {
  const added = changedSpecs(baseRef);
  if (added === null) {
    console.log(`(could not diff against ${baseRef} — falling back to the full sweep)`);
  } else {
    specs = specs.filter((s) => added.has(pinned.get(s)));
    scope = `${specs.length} changed vs ${baseRef}`;
    if (specs.length === 0) {
      console.log(`✔ no lockfile integrity changed vs ${baseRef} — nothing to verify`);
      process.exit(0);
    }
  }
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

const unsigned = [];
const invalid = [];
const expiredKey = [];
const errored = [];
let attested = 0;
const attestedNames = new Set();
const seenNames = new Set();
let cursor = 0;

async function worker() {
  while (cursor < specs.length) {
    const spec = specs[cursor];
    cursor += 1;
    const at = spec.lastIndexOf('@');
    const name = spec.slice(0, at);
    let dist;
    try {
      const res = await fetch(`${REGISTRY}/${name.replace('/', '%2f')}/${spec.slice(at + 1)}`, {
        headers: { accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      ({ dist } = await res.json());
    } catch (err) {
      errored.push(`${spec} (${err.message})`);
      continue;
    }
    if (dist?.attestations) {
      attested += 1;
      attestedNames.add(name);
    }
    seenNames.add(name);

    const sig = dist?.signatures?.[0];
    if (!sig) {
      unsigned.push(spec);
      continue;
    }
    const key = keyById.get(sig.keyid);
    if (!key) {
      invalid.push(`${spec} — signed with a key npm does not publish (${sig.keyid})`);
      continue;
    }
    // An expired key still verifies arithmetically. Surface it: a signature from a retired key is
    // not evidence the way a current one is, and npm currently publishes one expired key.
    if (key.expires && Date.parse(key.expires) < Date.now()) {
      expiredKey.push(`${spec} — signed with a key that expired ${key.expires}`);
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

if (invalid.length) {
  console.error(`\n✖ ${invalid.length} package(s) failed signature verification:\n`);
  for (const line of invalid) console.error(`    ${line}`);
  console.error('\n  The bytes our lockfile pins are NOT the bytes npm signed for that version. Treat');
  console.error('  it as a tampered dependency until proven otherwise — do NOT "fix" it by refreshing');
  console.error('  the lockfile, which just re-pins whatever is being served now.');
}
if (unsigned.length) {
  console.error(`\n✖ ${unsigned.length} package(s) have no registry signature at all:\n`);
  for (const spec of unsigned.slice(0, 20)) console.error(`    ${spec}`);
  if (unsigned.length > 20) console.error(`    …and ${unsigned.length - 20} more`);
}
if (expiredKey.length) {
  console.error(`\n! ${expiredKey.length} package(s) are signed with an EXPIRED npm key:`);
  for (const line of expiredKey.slice(0, 10)) console.error(`    ${line}`);
  console.error('  Not failed on — npm has not re-signed old releases — but worth knowing.');
}
if (errored.length) {
  console.error(`\n! ${errored.length} package(s) could not be reached and were NOT verified:`);
  for (const line of errored.slice(0, 10)) console.error(`    ${line}`);
}

const verified = specs.length - unsigned.length - invalid.length - errored.length;
console.log(`\nscope       ${scope}`);
console.log(`verified    ${verified}/${specs.length}`);
console.log(`attested    ${attested}/${specs.length}   (provenance — reported, not enforced)`);

// ★ The split. A whole-tree provenance gate is not available — most of npm does not publish it — so
// the useful question is narrower: of the packages THIS repo actually chose, how many are attested?
// That is the number an enforcement threshold could ever be set against, and the one whose decline
// means something (a dependency's own release pipeline stopped attesting) rather than reflecting the
// ecosystem at large.
const direct = directDependencyNames();
const directSeen = [...seenNames].filter((n) => direct.has(n));
if (directSeen.length) {
  const directAttested = directSeen.filter((n) => attestedNames.has(n));
  const pct = (n, d) => `${((n / d) * 100).toFixed(1)}%`;
  const transitiveSeen = seenNames.size - directSeen.length;
  const transitiveAttested = attestedNames.size - directAttested.length;
  console.log(`  direct      ${directAttested.length}/${directSeen.length}   (${pct(directAttested.length, directSeen.length)} of the dependencies this repo chose)`);
  if (transitiveSeen > 0) {
    console.log(`  transitive  ${transitiveAttested}/${transitiveSeen}   (${pct(transitiveAttested, transitiveSeen)} — not this repo's choice)`);
  }
  const missing = directSeen.filter((n) => !attestedNames.has(n)).sort();
  if (missing.length) {
    console.log(`\n  Direct dependencies WITHOUT provenance (${missing.length}) — the actionable list:`);
    for (const name of missing) console.log(`    ${name}`);
  }
}

if (invalid.length || unsigned.length) process.exit(1);
if (errored.length > specs.length * MAX_UNREACHABLE_RATIO) {
  console.error(`\n✖ ${errored.length} lookups failed — too many to call this a pass`);
  process.exit(1);
}
// Never claim more than was actually checked.
if (errored.length) {
  console.log(`\n✔ ${verified} verified; ${errored.length} unreachable and therefore UNCHECKED`);
} else {
  console.log(`\n✔ every package in scope matches a signature npm issued for it`);
}
