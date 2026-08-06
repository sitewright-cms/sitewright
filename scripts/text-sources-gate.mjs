#!/usr/bin/env node
// Fails if a tracked SOURCE file contains a raw NUL byte (0x00).
//
// Why this is a gate and not a lint rule: a single 0x00 anywhere in a file makes git classify the
// WHOLE FILE as binary. `git diff` prints "Binary files a/… and b/… differ" and GitHub renders no
// line diff at all — so every change to that file, forever, is invisible to review unless someone
// thinks to pass `--text`. It is silent, it is permanent until fixed, and it gets worse the longer
// it goes unnoticed because nobody can see what changed in the meantime.
//
// This was not hypothetical. `apps/api/src/auth/oidc.ts` — the OIDC authentication implementation —
// carried one for months. A security reviewer only found a four-line comment change in it by running
// a byte-level diff, because the PR showed no diff at all. Three more source files had the same bug,
// all from the same idiom: a NUL used as a composite-key separator, written as a literal character
// instead of the two-character escape `\0`. The escape is identical at runtime and diffs fine.
//
// ESLint cannot catch this: `no-irregular-whitespace` does not cover NUL, and a rule that did would
// still only run on files the parser accepts. This is a property of the BYTES, so it is checked on
// the bytes.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Extensions whose diffs a human is expected to read. Deliberately not "everything tracked" —
// fixtures, snapshots and binary assets legitimately contain arbitrary bytes.
const SOURCE_EXT =
  /\.(?:[cm]?[jt]sx?|json|md|css|s[ac]ss|ya?ml|html?|txt|sh|sql|toml|env\.example)$/i;

let files;
try {
  files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean);
} catch (err) {
  // No git (a tarball build, a vendored copy) — skip rather than fail the whole gate on something
  // this check cannot evaluate. It runs on every PR and every push, which is where it matters.
  console.log(`text-sources: skipped (git unavailable: ${err instanceof Error ? err.message : err})`);
  process.exit(0);
}

const offenders = [];
for (const file of files) {
  if (!SOURCE_EXT.test(file)) continue;
  let buf;
  try {
    buf = readFileSync(file);
  } catch {
    continue; // deleted-but-tracked during a rebase, or a broken symlink
  }
  const at = buf.indexOf(0);
  if (at === -1) continue;
  // Report a line number so the fix is a jump, not a hunt.
  const line = buf.subarray(0, at).toString('utf8').split('\n').length;
  const count = buf.reduce((n, b) => (b === 0 ? n + 1 : n), 0);
  // git sniffs only the FIRST 8000 BYTES when deciding binary-ness, so where the NUL sits decides
  // whether the file is unreviewable TODAY or merely one insertion away from it. Both are worth
  // failing on — the second silently becomes the first when anything above it grows — but saying
  // which is which keeps the message honest and tells you how urgent it is.
  offenders.push({ file, line, count, alreadyBinary: at < 8000 });
}

if (offenders.length) {
  const now = offenders.filter((o) => o.alreadyBinary);
  const latent = offenders.filter((o) => !o.alreadyBinary);
  console.error(`\n✖ ${offenders.length} source file(s) contain a raw NUL byte:\n`);
  for (const o of now) {
    console.error(`    ${o.file}:${o.line}  (${o.count} NUL) — ALREADY BINARY to git: diffs do not render`);
  }
  for (const o of latent) {
    console.error(`    ${o.file}:${o.line}  (${o.count} NUL) — latent: past git's 8000-byte sniff window, for now`);
  }
  console.error("\n  A NUL inside git's first 8000 bytes makes the whole file 'binary': `git diff` prints");
  console.error('  "Binary files … differ" and GitHub shows no line diff, so every future change to it');
  console.error('  is invisible to review. A NUL further in is the same bug waiting for the file to');
  console.error('  grow above it.');
  console.error("\n  Almost always a NUL written as a literal character where the escape '\\0' was meant");
  console.error('  (likewise \\x7f, \\x1f). The escapes are identical at runtime and diff normally.');
  process.exit(1);
}

console.log(`✔ no raw NUL bytes in ${files.filter((f) => SOURCE_EXT.test(f)).length} tracked source files`);
