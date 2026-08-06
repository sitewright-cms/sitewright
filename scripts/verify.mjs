#!/usr/bin/env node
// THE verification gate — the single source of truth for "is this mergeable?".
//
// Both `pnpm verify` (local) and the CI `Verify` job run THIS script, so the two can no longer drift.
// That drift was the actual cause of the recurring red builds: `pnpm verify` used to run only
// typecheck + lint + build + test, while CI additionally ran the dependency audit and three
// generated-file drift checks. A change could pass locally, get merged, and only then fail on main —
// which is why the audit and gen-check gates account for most of the historical CI failures.
//
// Adding a gate? Add it HERE. Do not add a step to ci.yml.
import { spawnSync } from 'node:child_process';

/** One gate: a label, the command, and whether a known-infra failure is tolerated. */
const GATES = [
  {
    name: 'Audit dependencies',
    // Was `pnpm audit --audit-level high`, which failed OPEN on a transport error and used a floor
    // too high to catch the class of advisory we actually ship (a moderate, remotely-triggerable
    // ReDoS in a network-facing dep passed it cleanly). Both fixed in the script — see its header.
    // `auditConfig.ignoreGhsas` (pnpm-workspace.yaml) stays EMPTY: acceptances live in the gate,
    // so `pnpm audit` itself never lies about what is in the tree.
    cmd: ['node', 'scripts/audit-gate.mjs'],
  },
  // A raw NUL byte makes git call a source file BINARY, so its diffs stop rendering and every
  // later change to it is invisible to review. Cheap to check, silent and permanent if missed —
  // it hid the OIDC auth implementation from review for months.
  { name: 'Source files are text', cmd: ['node', 'scripts/text-sources-gate.mjs'] },
  // Guard against hand-edits / upstream drift of the generated icon + vendored-runtime sets.
  { name: 'Check generated brand icons', cmd: ['pnpm', '--filter', '@sitewright/blocks', 'gen:brand-icons:check'] },
  { name: 'Check generated flag icons', cmd: ['pnpm', '--filter', '@sitewright/blocks', 'gen:flag-icons:check'] },
  { name: 'Check generated vendor runtimes', cmd: ['pnpm', '--filter', '@sitewright/blocks', 'gen:vendor:check'] },
  { name: 'Typecheck', cmd: ['pnpm', 'typecheck'] },
  { name: 'Lint', cmd: ['pnpm', 'lint'] },
  // Build before test: some integration tests assert on built output.
  { name: 'Build', cmd: ['pnpm', 'build'] },
  { name: 'Test (with coverage gate)', cmd: ['pnpm', 'test'] },
];

const ci = process.env.GITHUB_ACTIONS === 'true';

// `actions/setup-node` registers an `eslint-stylish` problem matcher, which turns every line of lint
// output into a GitHub annotation. This repo carries ~250 deliberately-accepted `security/*` WARNINGS
// (object-injection sinks and friends), so that matcher only ever produces noise — it fills the run's
// 10-annotation display budget on green builds and buries anything that actually matters. Lint ERRORS
// still fail this script loudly, with the file and rule in the log. The `tsc` matcher is left alone:
// those are real failures worth pinning to a line.
if (ci) {
  console.log('::remove-matcher owner=eslint-stylish::');
  console.log('::remove-matcher owner=eslint-compact::');
}
// Collapsible sections keep the CI log readable now that the gates are one step; locally they are just
// a heading. Timings are printed either way so a slow gate is obvious without opening the run.
const open = (n) => console.log(ci ? `::group::${n}` : `\n── ${n} ──`);
const close = () => ci && console.log('::endgroup::');

const started = Date.now();
const timings = [];
for (const gate of GATES) {
  open(gate.name);
  const t = Date.now();
  // `pipe` so a tolerated failure can be inspected; echoed immediately so output still streams in order.
  const res = spawnSync(gate.cmd[0], gate.cmd.slice(1), { encoding: 'utf8', shell: false });
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  process.stdout.write(out);
  const ms = Date.now() - t;
  timings.push([gate.name, ms]);
  close();

  if (res.status !== 0) {
    if (gate.tolerate?.(out)) {
      console.log(ci ? `::warning::${gate.tolerateNote}` : `WARNING: ${gate.tolerateNote}`);
      continue;
    }
    console.error(`\n✖ ${gate.name} failed (exit ${res.status ?? 'signal ' + res.signal}) after ${(ms / 1000).toFixed(1)}s`);
    console.error('  Gates run in CI order; everything above this line passed.');
    process.exit(res.status || 1);
  }
}

console.log('\n✔ all gates passed');
for (const [name, ms] of timings) console.log(`   ${String((ms / 1000).toFixed(1)).padStart(7)}s  ${name}`);
console.log(`   ${String(((Date.now() - started) / 1000).toFixed(1)).padStart(7)}s  TOTAL`);
