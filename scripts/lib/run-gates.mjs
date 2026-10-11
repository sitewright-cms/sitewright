// The gate RUNNER behind `scripts/verify.mjs` — which gates exist is decided there; how one is run, and
// how a failure is reported, is decided here. It is a separate module for one reason: so that
// `scripts/gate-output-selftest.mjs` can drive it with a synthetic failing gate and prove, on every
// run, that a failure still reaches the log.
import { spawnSync } from 'node:child_process';

/**
 * Run `gates` in order, stopping at the first failure, and END THE PROCESS with the right exit code.
 *
 * ★★ THIS NEVER CALLS `process.exit()`, AND MUST NOT START TO. It sets `process.exitCode` and returns,
 * so Node exits by itself once stdout has drained.
 *
 * A gate's output is written in one piece. When stdout is a FILE that write is synchronous; when it is a
 * PIPE — which is what a CI runner hands us — Node writes what fits in the pipe buffer (64 KB on Linux)
 * and queues the rest. `process.exit()` discards that queue. So the old `write(out); process.exit(1)`
 * delivered the first 64 KB or so of a failing gate and threw away everything after it, and the part
 * thrown away is the END: the failed test's name, its assertion, the summary, turbo's own verdict.
 *
 * That is what "a red build whose log contains no reason" was, every time. It read as GitHub truncating
 * an oversized log, and two rounds of making the output smaller (the `dot` reporter, silencing passing
 * tests) each helped a little, because a smaller log loses less. The log was never too big. Measured:
 * 3,000,000 bytes written, 65,536 delivered — and the full 3,000,000 when stdout was a file, which is
 * why no local run ever showed it.
 *
 * Same family as the `maxBuffer` trap below, with the same perverse bias: only a FAILING run takes the
 * exit path, so the gate was unreadable exactly, and only, when there was something to read.
 */
export function runGates(gates, { ci = false } = {}) {
  // Collapsible sections keep the CI log readable now that the gates are one step; locally they are just
  // a heading. Timings are printed either way so a slow gate is obvious without opening the run.
  const open = (n) => console.log(ci ? `::group::${n}` : `\n── ${n} ──`);
  const close = () => ci && console.log('::endgroup::');

  const started = Date.now();
  const timings = [];
  for (const gate of gates) {
    open(gate.name);
    const t = Date.now();
    // `pipe` so a tolerated failure can be inspected; echoed immediately so output still streams in order.
    //
    // ★ `maxBuffer: Infinity` IS THE GATE. spawnSync defaults to a 1 MB buffer, and on overflow it KILLS
    // the child and reports the overflow in `res.error` while leaving `res.status` at 0 — so a `status`-only
    // check reads a truncated, murdered run as a pass. This gate spent time in exactly that state: the api
    // suite went red, its failures printed large HTML diffs, the diffs pushed the output past 1 MB, and the
    // extra output turned the failure into "✔ all gates passed" both locally and in CI. The perverse part
    // is the direction of the bias — a NOISY failure was more likely to be swallowed than a quiet one, so
    // the gate got least trustworthy exactly when it mattered most. Never let this go back to a default
    // buffer, and never check `status` without `error`.
    const res = spawnSync(gate.cmd[0], gate.cmd.slice(1), { encoding: 'utf8', shell: false, maxBuffer: Infinity });
    const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
    process.stdout.write(out);
    const ms = Date.now() - t;
    timings.push([gate.name, ms]);
    close();

    // The verdict goes to STDOUT, after the output it describes. On stderr it overtook that output in a
    // CI log (stderr is written synchronously, a piped stdout is not), so "everything above this line
    // passed" was printed ABOVE the failure.
    if (res.error) {
      // The command never ran, or was killed. Not a test result — a broken gate, which must never pass.
      console.log(`\n✖ ${gate.name} could not be run to completion after ${(ms / 1000).toFixed(1)}s: ${res.error.message}`);
      process.exitCode = 1;
      return;
    }
    if (res.status !== 0) {
      if (gate.tolerate?.(out)) {
        console.log(ci ? `::warning::${gate.tolerateNote}` : `WARNING: ${gate.tolerateNote}`);
        continue;
      }
      console.log(`\n✖ ${gate.name} failed (exit ${res.status ?? 'signal ' + res.signal}) after ${(ms / 1000).toFixed(1)}s`);
      console.log('  Gates run in CI order; every gate before this one passed.');
      process.exitCode = res.status || 1;
      return;
    }
  }

  console.log('\n✔ all gates passed');
  for (const [name, ms] of timings) console.log(`   ${String((ms / 1000).toFixed(1)).padStart(7)}s  ${name}`);
  console.log(`   ${String(((Date.now() - started) / 1000).toFixed(1)).padStart(7)}s  TOTAL`);
}
