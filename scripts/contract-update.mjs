#!/usr/bin/env node
/**
 * Regenerate every snapshot under `contract/`.
 *
 * The guards themselves do the writing (each knows how to produce its own surface); this just runs
 * them with SW_CONTRACT_UPDATE=1 so there is ONE command to remember and no second implementation of
 * the generation logic to drift from the checking logic.
 *
 * Regenerating is a deliberate act. `contract/README.md` says what to do with the diff — in short:
 * additions are a minor, removals and renames are breaking.
 */
import { spawnSync } from 'node:child_process';

/** Each entry is a package filter plus the guard files that write into `contract/`. */
const GUARDS = [
  { pkg: '@sitewright/api', tests: ['test/contract-http.test.ts', 'test/contract-mcp.test.ts', 'test/contract-kinds.test.ts'] },
  { pkg: '@sitewright/blocks', tests: ['test/contract-css.test.ts'] },
];

let failed = false;
for (const { pkg, tests } of GUARDS) {
  process.stderr.write(`\x1b[36m[contract]\x1b[0m regenerating from ${pkg}…\n`);
  const res = spawnSync('pnpm', ['-F', pkg, 'exec', 'vitest', 'run', ...tests], {
    stdio: 'inherit',
    env: { ...process.env, SW_CONTRACT_UPDATE: '1' },
  });
  if (res.status !== 0) failed = true;
}

if (failed) {
  process.stderr.write(
    '\x1b[31m[contract] a guard failed while regenerating.\x1b[0m ' +
      'The snapshots it owns may be stale — fix the failure and re-run.\n',
  );
  process.exit(1);
}

process.stderr.write(
  '\x1b[36m[contract]\x1b[0m done. \x1b[1mRead the diff before committing\x1b[0m — ' +
    'a removal or rename in there is a BREAKING change (contract/README.md).\n',
);
