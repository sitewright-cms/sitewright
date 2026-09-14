#!/usr/bin/env node
// Fails if the running Node does not satisfy the root package.json `engines.node`.
//
// Why this is a gate and not just the field: pnpm only WARNS about `engines` and exits 0 — measured,
// with `engine-strict=true` as well as without. So on its own the field is documentation that nothing
// enforces, and it had already gone stale: it said `>=22.13` while `lighthouse` (a PRODUCTION
// dependency of apps/api) required `>=22.19`, and the jsdom 30 bump pushed the real floor to
// `^22.22.2`. Nobody noticed, because nothing was checking.
//
// The cost of not checking is not the missing version — it is WHERE the failure lands. A contributor
// on an older Node installs cleanly, then hits something several steps away (a test environment that
// will not start, an API that is missing) with nothing pointing at the cause. This says it in one
// line, at the front of the gate, in about a millisecond.
//
// `.nvmrc` deliberately stays on the major (`22`) rather than pinning the patch: CI resolves it with
// `node-version-file`, so pinning would freeze CI on one patch release and stop it picking up Node's
// own security updates. The FLOOR lives here; the version file says which line to be on.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const range = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).engines?.node;
if (!range) {
  console.error('node-version-gate: package.json has no `engines.node` to check against.');
  process.exit(1);
}

/** `v22.22.2` / `22.22` / `26` -> [major, minor, patch]; missing parts are 0. Null if unparseable. */
function parseVersion(value) {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(value.trim());
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null;
}

const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * One alternative of the range, as `{ caret, floor }`: `^x.y.z` (at least this, same major) or
 * `>=x.y.z`.
 *
 * ★ An alternative this cannot parse THROWS rather than returning false. A range the gate does not
 * understand must never be able to read as "satisfied" — that would turn the whole check into a
 * silent no-op, which is the exact failure mode the gate exists to prevent.
 */
function parseClause(clause) {
  const caret = clause.startsWith('^');
  const atLeast = clause.startsWith('>=');
  if (!caret && !atLeast) throw new Error(`node-version-gate: unsupported range clause "${clause}" in engines.node`);
  const floor = parseVersion(clause.slice(caret ? 1 : 2));
  if (!floor) throw new Error(`node-version-gate: unparseable version in range clause "${clause}"`);
  return { caret, floor };
}

const satisfies = (version, { caret, floor }) =>
  compare(version, floor) >= 0 && (caret ? version[0] === floor[0] : true);

// An explicit version argument makes the matcher checkable — `node scripts/node-version-gate.mjs
// 22.20.0` answers "would that contributor pass?" without installing it. Defaults to the real one.
const subject = process.argv[2] ?? process.version;
const current = parseVersion(subject);
if (!current) {
  console.error(`node-version-gate: could not parse the version "${subject}".`);
  process.exit(1);
}

// ★ EVERY clause is parsed before any is tested. `some()` short-circuits, so validating inside it
// would skip whatever follows the first match — `"^22.22.2 || ~24"` would pass on 22.22.2 and never
// notice that `~24` is unsupported, which is precisely the silent no-op this is meant to rule out.
const clauses = range.split('||').map((c) => c.trim()).filter(Boolean).map(parseClause);
if (!clauses.some((clause) => satisfies(current, clause))) {
  console.error(`This repo needs Node ${range} — this is ${subject}.`);
  console.error('`.nvmrc` names the supported line: run `nvm use` (or `fnm use`) in the repo root, or install a newer Node.');
  console.error('The floor is set by dependencies, not by preference: lighthouse needs >=22.19 and jsdom needs ^22.22.2.');
  process.exit(1);
}
