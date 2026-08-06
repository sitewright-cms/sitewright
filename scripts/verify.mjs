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
    cmd: ['pnpm', 'audit', '--audit-level', 'high'],
    // This gate used to auto-tolerate ERR_PNPM_AUDIT_BAD_RESPONSE, because npm had retired the
    // quick-audit endpoint this pnpm calls (HTTP 410). That endpoint answers again, so the tolerance
    // is gone: a gate that silently passes when it cannot reach the advisory database is a gate that
    // reports "no known vulnerabilities" without having looked. It now FAILS CLOSED.
    //
    // If the endpoint breaks again and it is genuinely blocking, an operator can unblock DELIBERATELY
    // with SW_ALLOW_AUDIT_OUTAGE=1 (it prints a loud warning and is visible in the log). Do not set it
    // in ci.yml — the point is that a human decides, per incident, to merge without an audit.
    tolerate: (out) =>
      process.env.SW_ALLOW_AUDIT_OUTAGE === '1' && out.includes('ERR_PNPM_AUDIT_BAD_RESPONSE'),
    tolerateNote: 'AUDIT DID NOT RUN — advisory endpoint unreachable, waived via SW_ALLOW_AUDIT_OUTAGE',
    // `pnpm.auditConfig.ignoreGhsas` is EMPTY and should stay that way: an exemption silently outlives
    // the advisory that justified it (all three former entries did — one had already stopped matching
    // the tree). Fix by pinning in pnpm.overrides instead, so the audit keeps telling the truth.
    //
    // Two advisories remain, both BELOW this gate, neither reachable here:
    // - GHSA-g7r4-m6w7-qqqr (esbuild <0.28.1, low): arbitrary file read via the esbuild DEV SERVER, on
    //   Windows. Reached only through vitest -> vite, so it is test tooling that never runs in prod, and
    //   we run Linux. A blanket esbuild override is not viable (vite pins 0.25; 0.28 drops transpile
    //   support for our editor browser targets) — re-check on the next vite bump.
    // - GHSA-8988-4f7v-96qf (@opentelemetry/core <2.8.0, moderate): unbounded allocation parsing W3C
    //   Baggage headers, via lighthouse -> @sentry/node. Sentry pins otel 1.x, so clearing it means
    //   forcing a MAJOR into a third-party dep; Lighthouse runs against our OWN locally-served build and
    //   never parses attacker-supplied baggage. Revisit when Sentry ships otel 2.
    //
    // A third (hono ReDoS in CORS middleware, GHSA via @modelcontextprotocol/sdk) was cleared by
    // bumping the pnpm.overrides pin to >=4.12.34 — the previous >=4.12.27 pin had gone stale.
  },
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
