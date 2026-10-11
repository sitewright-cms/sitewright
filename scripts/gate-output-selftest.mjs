#!/usr/bin/env node
// Proves that a FAILING gate's output reaches the log intact — the one thing a gate runner must not get
// wrong, and the thing this one got wrong for months (see `lib/run-gates.mjs`).
//
// It runs the real runner against a synthetic gate that prints far more than a pipe buffer holds and
// then fails, reads the result back through a PIPE the way a CI runner does, and checks that the last
// line arrived and the exit code survived. A green gate proves nothing until it has been seen to fail
// readably; this is that, on every run, in about half a second.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runGates } from './lib/run-gates.mjs';

const PAYLOAD_BYTES = 2_000_000; // ~30 pipe buffers: anything dropped on exit is dropped by a wide margin
const SENTINEL = 'gate-output-selftest: the last line of the failing gate';
const EXIT_CODE = 3;

if (process.argv[2] === '--child') {
  // The gate under test: a lot of output, the line that matters at the very END, then a failure. It
  // fails by `exitCode` for the reason this file exists — a `process.exit()` here would cut its own
  // output short, and the test would be measuring the fixture.
  const noisyFailure = `process.stdout.write('x'.repeat(${PAYLOAD_BYTES}) + '\\n${SENTINEL}\\n'); process.exitCode = ${EXIT_CODE}`;
  runGates([{ name: 'synthetic failing gate', cmd: [process.execPath, '-e', noisyFailure] }]);
} else {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child'], { stdio: ['ignore', 'pipe', 'inherit'] });
  let bytes = 0;
  let tail = '';
  child.stdout.on('data', (chunk) => {
    bytes += chunk.length;
    tail = (tail + chunk.toString('utf8')).slice(-400);
  });
  // Do not read straight away. A reader that keeps up hides the bug: the pipe never fills, so nothing
  // is ever queued for an early exit to throw away. A CI runner does not keep up. (Paused WITH the
  // listener attached — a stream nobody listens to is drained and discarded when the child exits.)
  child.stdout.pause();
  setTimeout(() => child.stdout.resume(), 300);
  child.on('close', (code) => {
    const problems = [];
    if (bytes < PAYLOAD_BYTES) problems.push(`only ${bytes} of at least ${PAYLOAD_BYTES} bytes arrived`);
    if (!tail.includes(SENTINEL)) problems.push('the last line the failing gate printed is missing');
    if (!tail.includes('✖ synthetic failing gate failed')) problems.push("the runner's own verdict is missing");
    if (code !== EXIT_CODE) problems.push(`exit code was ${code}, expected ${EXIT_CODE}`);
    if (problems.length > 0) {
      console.log(`✖ a failing gate's output does NOT survive a pipe — ${problems.join('; ')}.`);
      console.log('  Something ends the process before stdout has drained (a `process.exit()`?). See scripts/lib/run-gates.mjs.');
      process.exitCode = 1;
      return;
    }
    console.log(`✔ a failing gate's output survives a pipe (${bytes} bytes, verdict last, exit ${code})`);
  });
}
