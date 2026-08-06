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
// images, fonts and media fixtures legitimately contain arbitrary bytes (440 tracked files here do).
const SOURCE_EXT =
  /\.(?:[cm]?[jt]sx?|json|md|css|s[ac]ss|ya?ml|html?|txt|sh|sql|toml|env\.example)$/i;

// Reviewed source that carries no extension, so the regex above would skip it.
const SOURCE_BASENAMES = new Set(['Dockerfile', '.nvmrc', '.gitignore', '.dockerignore', '.editorconfig', '.gitattributes']);

const isSource = (path) => {
  const base = path.slice(path.lastIndexOf('/') + 1);
  return SOURCE_EXT.test(path) || SOURCE_BASENAMES.has(base);
};

let files;
try {
  // `-s` (not plain `-z`) so the MODE comes too: a tracked symlink's blob is just its target path,
  // but readFileSync would follow the link and scan whatever it points at — a file git is not
  // tracking here, and possibly a binary one. Skip mode 120000 rather than rely on this repo
  // happening to have no symlinks today. Format: "<mode> <sha> <stage>\t<path>" per NUL-terminated record.
  files = execFileSync('git', ['ls-files', '-s', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean)
    .map((rec) => {
      const tab = rec.indexOf('\t');
      return { mode: rec.slice(0, 6), path: rec.slice(tab + 1) };
    })
    .filter((e) => e.mode !== '120000')
    .map((e) => e.path);
} catch (err) {
  // No git (a tarball build, a vendored copy) — skip rather than fail the whole gate on something
  // this check cannot evaluate. It runs on every PR and every push, which is where it matters.
  console.log(`text-sources: skipped (git unavailable: ${err instanceof Error ? err.message : err})`);
  process.exit(0);
}

const offenders = [];
for (const file of files) {
  if (!isSource(file)) continue;
  let buf;
  try {
    buf = readFileSync(file);
  } catch {
    continue; // deleted-but-tracked during a rebase, or a submodule path
  }
  if (!buf.includes(0)) continue;
  // EVERY offset, not just the first: two of the four files that prompted this gate carried NULs on
  // several different lines, which is exactly the case where reporting one line leaves you hunting
  // for the rest. The point is to make the fix a jump.
  const lines = [];
  for (let at = buf.indexOf(0); at !== -1; at = buf.indexOf(0, at + 1)) {
    lines.push(buf.subarray(0, at).toString('utf8').split('\n').length);
  }
  // git sniffs only the FIRST 8000 BYTES when deciding binary-ness, so where the earliest NUL sits
  // decides whether the file is unreviewable TODAY or merely close to it.
  //
  // NOTE the direction, which is the opposite of the intuitive one: a latent NUL becomes binary when
  // content above it SHRINKS (a deletion, a refactor) and pulls it back inside the window — growth
  // above it pushes the offset further out and makes it safer. Measured: a NUL at 8501 stayed a text
  // diff after adding 500 bytes above it, and flipped to "Binary files … differ" after removing 1100.
  offenders.push({ file, lines, alreadyBinary: lines.length > 0 && buf.indexOf(0) < 8000 });
}

if (offenders.length) {
  const now = offenders.filter((o) => o.alreadyBinary);
  const latent = offenders.filter((o) => !o.alreadyBinary);
  const at = (o) => `${o.file}:${o.lines.join(',')}  (${o.lines.length} NUL${o.lines.length === 1 ? '' : 's'})`;
  console.error(`\n✖ ${offenders.length} source file(s) contain a raw NUL byte:\n`);
  for (const o of now) console.error(`    ${at(o)} — ALREADY BINARY to git: diffs do not render`);
  for (const o of latent) console.error(`    ${at(o)} — latent: past git's 8000-byte sniff window, for now`);
  console.error("\n  A NUL inside git's first 8000 bytes makes the whole file 'binary': `git diff` prints");
  console.error('  "Binary files … differ" and GitHub shows no line diff, so every future change to it');
  console.error('  is invisible to review. A NUL further in is the same bug in waiting: it turns binary');
  console.error('  when content above it SHRINKS and pulls it back inside the window.');
  console.error("\n  Almost always a NUL written as a literal character where the escape '\\0' was meant");
  console.error('  (likewise \\x7f, \\x1f). The escapes are identical at runtime and diff normally.');
  process.exit(1);
}

console.log(`✔ no raw NUL bytes in ${files.filter(isSource).length} tracked source files`);
