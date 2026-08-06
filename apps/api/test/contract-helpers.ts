import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

/** The committed contract directory (repo root `contract/`). */
export const contractPath = (name: string): string =>
  fileURLToPath(new URL(`../../../contract/${name}`, import.meta.url));

/**
 * Compare a generated surface against its committed snapshot.
 *
 * `pnpm contract:update` (SW_CONTRACT_UPDATE=1) rewrites the file instead of asserting — the only
 * supported way to change one. The failure message says what to do rather than just what differs,
 * because the right answer depends on the DIRECTION of the change: additions are a minor, removals
 * and renames are a major (see contract/README.md).
 */
export function expectContract(name: string, actual: unknown): void {
  const file = contractPath(name);
  const serialized = `${JSON.stringify(actual, null, 2)}\n`;
  if (process.env.SW_CONTRACT_UPDATE === '1') {
    writeFileSync(file, serialized);
    return;
  }
  let committed: string;
  try {
    committed = readFileSync(file, 'utf8');
  } catch {
    throw new Error(`contract/${name} is missing — run \`pnpm contract:update\` to create it.`);
  }
  expect(
    JSON.parse(serialized),
    `contract/${name} changed.\n` +
      `  ADDED entries      → a minor. Regenerate with \`pnpm contract:update\` and note it in the CHANGELOG.\n` +
      `  REMOVED or RENAMED → a BREAKING change. Put it back, or take it through the deprecation\n` +
      `                       policy in docs/compatibility.md and bump the major.`,
  ).toEqual(JSON.parse(committed));
}

/**
 * Collect `"METHOD /path"` for every route an app registers.
 *
 * Fed by the `onRoute` option rather than `printRoutes`, whose output is lossy for wildcards (see the
 * hook's registration in app.ts). HEAD is dropped: Fastify derives it from GET, so listing it would
 * double the file without adding a promise.
 */
export function collectRoutes(): { onRoute: (r: { method: string | string[]; url: string }) => void; inventory: () => string[] } {
  const seen: string[] = [];
  return {
    onRoute: ({ method, url }) => {
      for (const m of Array.isArray(method) ? method : [method]) {
        if (m !== 'HEAD') seen.push(`${m} ${url}`);
      }
    },
    inventory: () => [...new Set(seen)].sort(),
  };
}
