#!/usr/bin/env node
// The dependency-advisory gate. Replaces a bare `pnpm audit --audit-level high`, which had two holes:
//
// 1. It FAILED OPEN. A transport error (npm outage, proxy, poisoned registry) made `pnpm audit` exit
//    non-zero with no advisory data, and the old gate tolerated that error string unconditionally —
//    reporting "no known vulnerabilities" from a check that never reached the advisory database.
//
// 2. `high` is the WRONG FLOOR, and this repo has the proof. The hono ReDoS in `hono/cors`
//    (unauthenticated, reachable through @modelcontextprotocol/sdk's HTTP transport) is scored
//    MODERATE, so `--audit-level high` returned clean both before and after we patched it. A
//    remotely-triggerable DoS in a network-facing dependency is exactly what a gate should stop, and
//    that class of advisory lands at moderate routinely.
//
// So the floor is MODERATE — but a floor alone would just wedge on the advisories we have already
// judged unreachable and cannot clear. Hence: moderate+ fails unless the advisory is in ACCEPTED
// below, with a written reason. That is deliberately NOT `auditConfig.ignoreGhsas` (which now lives
// in pnpm-workspace.yaml, and is itself deprecated in favour of `audit.ignore`) — an ignore makes
// `pnpm audit` itself lie. Here the audit keeps telling the truth and the GATE reasons about the
// delta, so a NEW moderate advisory blocks a merge on the day it is published.
//
// The failure mode of an allowlist is that entries outlive the advisory that justified them (all
// three former ignoreGhsas entries did). So a stale entry is a HARD FAILURE too: if an accepted
// advisory stops matching the tree, this exits non-zero and tells you to delete the line.
import { spawnSync } from 'node:child_process';

// Every field below comes from the registry and none of its shapes are guaranteed. An unhandled
// throw would already exit non-zero, but only because that is Node's default — and "fails closed by
// accident" is not a property you can rely on. Make it a decision.
process.on('uncaughtException', (e) => {
  console.error(`✖ audit gate crashed, so nothing was audited: ${e?.stack ?? e}`);
  process.exit(1);
});

/**
 * Moderate-or-higher advisories we have consciously accepted, keyed by GHSA id.
 * An entry needs a reason someone can re-evaluate later — "not exploitable here", not "known issue".
 * Critical and high are NEVER acceptable; they are not consulted against this map.
 */
const ACCEPTED = {
  'GHSA-8988-4f7v-96qf':
    '@opentelemetry/core <2.8.0 — unbounded allocation parsing W3C Baggage headers, via ' +
    'lighthouse -> @sentry/node. Sentry pins otel 1.x, so clearing it means forcing a MAJOR into a ' +
    'third-party dep. Lighthouse runs against our OWN locally-served build and never parses ' +
    'attacker-supplied baggage. Revisit when Sentry ships otel 2.',
};

const SEVERITY_RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const FLOOR = SEVERITY_RANK.moderate;

const res = spawnSync('pnpm', ['audit', '--json'], { encoding: 'utf8', shell: false, maxBuffer: 64 * 1024 * 1024 });
const raw = `${res.stdout ?? ''}`;
const err = `${res.stderr ?? ''}`;

/** Fail closed: no parseable advisory data means we did not check, which is not the same as clean. */
function unreachable(why) {
  // `pnpm audit` exits non-zero BOTH when it finds advisories and when it cannot reach the endpoint.
  // Only the second is an outage, and only the literal transport error is waivable — a connection
  // failure or garbage response is not, because we cannot tell those from a hostile proxy.
  const waivable = err.includes('ERR_PNPM_AUDIT_BAD_RESPONSE') || raw.includes('ERR_PNPM_AUDIT_BAD_RESPONSE');
  if (waivable && process.env.SW_ALLOW_AUDIT_OUTAGE === '1') {
    console.log(`WARNING: AUDIT DID NOT RUN — ${why}. Waived via SW_ALLOW_AUDIT_OUTAGE.`);
    process.exit(0);
  }
  console.error(`✖ audit did not run: ${why}`);
  console.error(err.trim() || raw.slice(0, 2000));
  if (waivable) {
    console.error('\n  If the advisory endpoint is genuinely down and you accept merging UNAUDITED,');
    console.error('  re-run with SW_ALLOW_AUDIT_OUTAGE=1. Do not set that in CI.');
  }
  process.exit(1);
}

let report;
try {
  report = JSON.parse(raw);
} catch {
  unreachable('pnpm audit produced no parseable JSON');
}
if (!report || typeof report.advisories !== 'object' || report.advisories === null) {
  unreachable('pnpm audit returned no advisories object');
}

const advisories = Object.values(report.advisories);
const gating = [];
const accepted = [];
const below = [];

for (const a of advisories) {
  // `Object.hasOwn`, not a bare lookup: a severity of "constructor" or "toString" would otherwise
  // resolve to an inherited Object.prototype member instead of undefined, so `??` would never reach
  // the critical fallback. It still fails closed today (those values are not numbers, so every
  // comparison below is false and the entry gates) — but by accident, and this file's whole point is
  // that its safety is deliberate.
  const rank = Object.hasOwn(SEVERITY_RANK, a.severity) ? SEVERITY_RANK[a.severity] : SEVERITY_RANK.critical;
  if (rank < FLOOR) {
    below.push(a);
    continue;
  }
  // High and critical are never waivable, whatever the map says.
  const waivable = rank === FLOOR && Object.hasOwn(ACCEPTED, a.github_advisory_id);
  (waivable ? accepted : gating).push(a);
}

// Every field here comes from the registry, so none of it is guaranteed to be a string. A missing
// `severity` used to throw inside .padEnd() — which still exited non-zero, but as an uncaught stack
// trace that aborted the report mid-loop and hid every advisory after it.
const show = (v, pad = 0) => String(v ?? 'unknown').padEnd(pad);
const line = (a) => `${show(a.severity, 8)} ${show(a.module_name)} — ${show(a.title)} (${show(a.github_advisory_id)})`;

for (const a of below) console.log(`  below floor  ${line(a)}`);
for (const a of accepted) console.log(`  accepted     ${line(a)}`);

// A stale acceptance is as dangerous as a missing one: it is an exemption nobody is re-reading.
const seen = new Set(advisories.map((a) => a.github_advisory_id));
const stale = Object.keys(ACCEPTED).filter((id) => !seen.has(id));

let failed = false;
if (gating.length) {
  failed = true;
  console.error(`\n✖ ${gating.length} advisory(ies) at or above ${Object.keys(SEVERITY_RANK)[FLOOR]}, not accepted:\n`);
  for (const a of gating) console.error(`    ${line(a)}\n      fixed in: ${a.patched_versions}\n      ${a.url}`);
  console.error('\n  Fix by pinning in `overrides`. If it is genuinely unreachable in this codebase,');
  console.error('  add the GHSA id to ACCEPTED in scripts/audit-gate.mjs WITH the reason.');
}
if (stale.length) {
  failed = true;
  console.error(`\n✖ ${stale.length} ACCEPTED entry(ies) no longer match anything — delete them:\n`);
  for (const id of stale) console.error(`    ${id}`);
  console.error('\n  This is the failure mode that retired the old ignoreGhsas list: an exemption');
  console.error('  outliving its advisory. Removing it is the whole point of failing here.');
}
if (failed) process.exit(1);

console.log(
  `\n✔ no unaccepted advisories at or above moderate ` +
    `(${advisories.length} total: ${accepted.length} accepted, ${below.length} below floor)`,
);
