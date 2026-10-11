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
import { runGates } from './lib/run-gates.mjs';

/** One gate: a label, the command, and whether a known-infra failure is tolerated. */
const GATES = [
  // First, because every gate below it runs on this Node: a version below the floor produces
  // failures that point anywhere but at the cause. pnpm only WARNS about `engines` and exits 0,
  // so the field needs something that actually checks it. ~1ms.
  { name: 'Node version', cmd: ['node', 'scripts/node-version-gate.mjs'] },
  // Before any gate that can fail noisily: proves a FAILING gate's output still reaches the log. It did
  // not, for months — a red build arrived with its reason cut off the end (see lib/run-gates.mjs) — and
  // nothing could have noticed, because only a failing run takes that path. ~0.5s.
  { name: 'Gate output survives a failure', cmd: ['node', 'scripts/gate-output-selftest.mjs'] },
  {
    name: 'Audit dependencies',
    // Was `pnpm audit --audit-level high`, which failed OPEN on a transport error and used a floor
    // too high to catch the class of advisory we actually ship (a moderate, remotely-triggerable
    // ReDoS in a network-facing dep passed it cleanly). Both fixed in the script — see its header.
    // `auditConfig.ignoreGhsas` (pnpm-workspace.yaml) stays EMPTY: acceptances live in the gate,
    // so `pnpm audit` itself never lies about what is in the tree.
    cmd: ['node', 'scripts/audit-gate.mjs'],
  },
  // Proves the bytes the lockfile pins are the bytes npm signed — checked at the moment a lockfile
  // entry is WRITTEN, which is when a dependency change is actually being decided.
  //
  // `--changed` keeps this a function of the diff, which is the rule for everything in this script:
  // on a PR that touches no dependency it verifies nothing, makes no network call, and costs ~40ms,
  // so the gate stays fast and works offline. The full sweep is a function of TIME and belongs in
  // the scheduled audit (.github/workflows/audit.yml), which runs it nightly.
  { name: 'Registry signatures', cmd: ['node', 'scripts/registry-signatures.mjs', '--changed', 'origin/main'] },
  // A raw NUL byte makes git call a source file BINARY, so its diffs stop rendering and every
  // later change to it is invisible to review. Cheap to check, silent and permanent if missed —
  // it hid the OIDC auth implementation from review for months.
  { name: 'Source files are text', cmd: ['node', 'scripts/text-sources-gate.mjs'] },
  // Guard against hand-edits / upstream drift of the generated icon + vendored-runtime sets.
  { name: 'Check generated brand icons', cmd: ['pnpm', '--filter', '@sitewright/blocks', 'gen:brand-icons:check'] },
  { name: 'Check generated flag icons', cmd: ['pnpm', '--filter', '@sitewright/blocks', 'gen:flag-icons:check'] },
  { name: 'Check generated vendor runtimes', cmd: ['pnpm', '--filter', '@sitewright/blocks', 'gen:vendor:check'] },
  // The Tailwind reference dataset is derived from the installed `tailwindcss`. Upgrading Tailwind
  // without regenerating would leave the editor documenting utilities that no longer exist (or
  // missing ones that now do) — and the authored prose in topics.ts would silently go out of sync.
  { name: 'Check generated Tailwind reference', cmd: ['pnpm', '--filter', '@sitewright/tailwind-reference', 'gen:check'] },
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
// How a gate is run, and how a failure is reported, lives in lib/run-gates.mjs. It ends the process by
// setting `process.exitCode`, never by `process.exit()` — read the note there before changing that.
runGates(GATES, { ci });
