import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The CSS surface author stylesheets are written against.
 *
 * A `--sw-*` custom property is read by hand-written author CSS and by every snippet in the library;
 * a `.sw-*` class is applied in authored markup that lives in the customer's project, not ours.
 * Renaming either fails SILENTLY — no error, no console warning, just a page that renders slightly
 * wrong. That failure mode is exactly why this is pinned rather than described in prose.
 *
 * Scanned from the emitters' SOURCE rather than from rendered output. Rendering pins only the names
 * one sample config happens to reach, and these emitters branch heavily on brand, typography, theme
 * and effect settings — a name reachable only with dark mode on is no less part of the API. A source
 * scan enumerates every name the platform can emit, under any configuration.
 */
const contractFile = fileURLToPath(new URL('../../../contract/css-api.json', import.meta.url));
const srcDir = fileURLToPath(new URL('../src', import.meta.url));
const tailwindSrcDir = fileURLToPath(new URL('../../tailwind/src', import.meta.url));

/**
 * Names the emitters BUILD rather than write out — `--sw-color-${role}` and friends. A literal scan
 * cannot see them and a single rendered sample only reaches the ones its config happens to enable
 * (the brand roles, for instance, are emitted from the dark-theme path). They are as much part of the
 * API as any literal: `--sw-color-primary` is what the reference tells authors to use.
 *
 * The generated family is pinned as `prefix + vocabulary`, so widening the vocabulary is an addition
 * and dropping a term is caught as the breaking change it is.
 */
const GENERATED = {
  // theme-mode.ts: `--sw-color-<role>` + `--sw-color-<role>-content` over the brand roles.
  '--sw-color-': ['primary', 'secondary', 'accent', 'neutral'],
} as const;

function generatedProperties(): string[] {
  const out: string[] = [];
  for (const [prefix, terms] of Object.entries(GENERATED)) {
    for (const term of terms) out.push(`${prefix}${term}`, `${prefix}${term}-content`);
  }
  return out;
}

function scan(): { properties: string[]; classes: string[] } {
  const properties = new Set<string>(generatedProperties());
  const classes = new Set<string>();
  for (const dir of [srcDir, tailwindSrcDir]) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const text = readFileSync(`${dir}/${file}`, 'utf8');
      // DECLARATIONS only (`--sw-x:`). A `var(--sw-y)` read is a consumer, not a promise — pinning
      // those would fail whenever an internal lookup is refactored.
      for (const m of text.matchAll(/(--sw-[a-z0-9-]+)\s*:/gi)) properties.add(m[1]!);
      // `.sw-x` in a selector position. The trailing guard keeps `.sw-x` in a comment or a JS
      // property chain out; a class is always followed by a selector/rule character.
      for (const m of text.matchAll(/\.(sw-[a-z0-9-]+)(?=[\s,{:>~+[.]|\\n)/g)) classes.add(m[1]!);
    }
  }
  return { properties: [...properties].sort(), classes: [...classes].sort() };
}

describe('contract: the CSS API author styles depend on', () => {
  it('matches the committed custom properties and classes', () => {
    const actual = scan();
    if (process.env.SW_CONTRACT_UPDATE === '1') {
      writeFileSync(contractFile, `${JSON.stringify(actual, null, 2)}\n`);
      return;
    }
    expect(
      actual,
      'contract/css-api.json changed.\n' +
        '  ADDED   → a minor. Regenerate with `pnpm contract:update`.\n' +
        '  REMOVED or RENAMED → BREAKING: author CSS referencing it stops applying SILENTLY.\n' +
        '                       Keep the old name as an alias, or bump the major.',
    ).toEqual(JSON.parse(readFileSync(contractFile, 'utf8')));
  });

  it('covers the brand and typography tokens authors reach for most', () => {
    // Spot-checked by name: these are the ones snippets and the reference docs tell authors to use,
    // so a scan that silently stopped finding them would be a broken guard, not a clean surface.
    const { properties } = scan();
    for (const token of ['--sw-color-primary', '--sw-font-heading', '--sw-font-body', '--sw-container']) {
      expect(properties, `${token} is documented for author CSS`).toContain(token);
    }
  });
});
