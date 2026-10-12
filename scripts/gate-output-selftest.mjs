#!/usr/bin/env node
// Proves that a FAILING gate's output reaches the log intact — the one thing a gate runner must not get
// wrong, and the thing this one got wrong for months (see `lib/run-gates.mjs`).
//
// And that it reaches it READABLE: no line longer than the 64 KB at which `gh run view --log` silently
// stops reading. The synthetic gate prints its 2 MB as ONE line for exactly that reason.
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
const LONGEST_READABLE_LINE = 64_000; // bytes; `gh` reads logs with a 64 KB line buffer

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
  let lineBytes = 0; // length of the line currently arriving — lines span chunks
  let longestLine = 0;
  // Decoded by the stream, not per chunk: the verdict starts with a multi-byte character, and a chunk
  // boundary inside it would otherwise read as "the verdict is missing".
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    bytes += Buffer.byteLength(chunk);
    tail = (tail + chunk).slice(-400);
    const pieces = chunk.split('\n');
    pieces.forEach((piece, idx) => {
      lineBytes = (idx === 0 ? lineBytes : 0) + Buffer.byteLength(piece);
      if (lineBytes > longestLine) longestLine = lineBytes;
    });
  });
  // A runner that never exits must fail this gate, not hang the build until the job times out.
  const giveUp = setTimeout(() => child.kill('SIGKILL'), 30_000);
  // Do not read straight away. A reader that keeps up hides the bug: the pipe never fills, so nothing
  // is ever queued for an early exit to throw away. A CI runner does not keep up. (Paused WITH the
  // listener attached — a stream nobody listens to is drained and discarded when the child exits.)
  child.stdout.pause();
  setTimeout(() => child.stdout.resume(), 300);
  child.on('close', (code) => {
    clearTimeout(giveUp);
    const problems = [];
    if (bytes < PAYLOAD_BYTES) problems.push(`only ${bytes} of at least ${PAYLOAD_BYTES} bytes arrived`);
    if (!tail.includes(SENTINEL)) problems.push('the last line the failing gate printed is missing');
    if (!tail.includes('✖ synthetic failing gate failed')) problems.push("the runner's own verdict is missing");
    if (longestLine > LONGEST_READABLE_LINE) problems.push(`a line of ${longestLine} bytes got through — \`gh run view --log\` stops reading at 64 KB`);
    if (code !== EXIT_CODE) problems.push(`exit code was ${code ?? 'none — it had to be killed after 30s'}, expected ${EXIT_CODE}`);
    if (problems.length > 0) {
      console.log(`✖ a failing gate's output does NOT reach the log whole and readable — ${problems.join('; ')}.`);
      console.log('  Either something ends the process before stdout has drained (a `process.exit()`?), or over-long lines are no longer wrapped. See scripts/lib/run-gates.mjs.');
      process.exitCode = 1;
      return;
    }
    console.log(`✔ a failing gate's output reaches the log whole and readable (${bytes} bytes, longest line ${longestLine}, verdict last, exit ${code})`);
  });
}
