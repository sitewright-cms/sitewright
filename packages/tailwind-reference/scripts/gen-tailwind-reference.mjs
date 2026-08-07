#!/usr/bin/env node
// Generates the TAILWIND REFERENCE data module (packages/tailwind-reference/src/generated.ts).
//
// Everything factual about Tailwind — which utility classes exist, what CSS each one generates, what
// its theme value resolves to — is DERIVED here from the installed `tailwindcss` package, never
// hand-written. That matters twice over: 23k classes is not a maintainable hand-list, and a Tailwind
// upgrade must move the docs with it. `gen:tailwind-reference:check` (in the verify gate) fails when
// the committed module and the installed Tailwind disagree.
//
// Only the PROSE is authored, and it lives in the sibling `topics.ts` — one title + description per
// CSS-property signature (~300), not per class. Tailwind's own docs prose is NOT MIT-licensed
// (the tailwindcss.com repo is separate from the MIT npm package), so none of it is copied here.
//
// The grouping key is the SET OF CSS PROPERTIES a class generates. That is what makes the topic list
// fall out of the data instead of being curated: `text-sm` generates `font-size` and `text-red-500`
// generates `color`, so the polymorphic `text-` root splits into "Font Size" and "Text Color" on its
// own — exactly the split the official docs draw by hand.
//
// Usage: node scripts/gen-tailwind-reference.mjs [--report]
//   --report  print the signature inventory (for authoring topics.ts) instead of writing the module.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { __unstable__loadDesignSystem } from '@tailwindcss/node';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '../src/generated.ts');

// The same import pair the publish compiler uses (compile.ts) — theme + utilities, no preflight — so
// the documented class set is exactly the set an author can actually use on a published page.
const TAILWIND_BASE = dirname(require.resolve('tailwindcss/theme.css'));
const INPUT = `@import "tailwindcss/theme.css" layer(theme);\n@import "tailwindcss/utilities.css";`;

/**
 * The declarations a single class generates.
 *
 * `candidatesToCss` returns a whole CSS snippet, which for many utilities is preceded by the
 * `@property` registrations of the `--tw-*` custom properties it relies on. Those are machinery, not
 * documentation — and they are the bulk of the bytes (96k `syntax:`/`inherits:` lines across the full
 * set), so they are stripped before anything else.
 */
function declarationsOf(cssText) {
  const stripped = cssText.replace(/@property[^{]*\{[^}]*\}/g, '');
  const out = [];
  for (const m of stripped.matchAll(/^\s+([a-zA-Z-]+):\s*([^;]+);/gm)) {
    out.push([m[1], m[2].trim().replace(/\s+/g, ' ')]);
  }
  return out;
}

/**
 * The properties that identify a topic. Real CSS properties win; a utility that only sets `--tw-*`
 * internals (gradient stops, shadow colours, `divide-*-reverse`) is identified by those instead —
 * without that fallback ~3,000 classes collapse into one meaningless "(none)" bucket.
 */
function signatureOf(decls) {
  const real = decls.filter(([p]) => !p.startsWith('--'));
  const use = real.length > 0 ? real : decls;
  // The KEY dedupes; the declarations do not. `container` sets `max-width` once per breakpoint, so
  // its five identical property names are one topic ("Container") but five values worth showing.
  return { props: [...new Set(use.map(([p]) => p))], decls: use };
}

/** `var(--text-sm)` → the theme value behind it, so a row can show `0.875rem` and not a variable. */
function resolveValue(ds, raw) {
  const m = /^var\((--[a-zA-Z0-9-]+)\)$/.exec(raw);
  if (!m) return undefined;
  const resolved = ds.resolveThemeValue?.(m[1]);
  if (typeof resolved !== 'string') return undefined;
  // Theme values may carry newlines (the default font stacks) — flatten for single-line display.
  const flat = resolved.replace(/\s+/g, ' ').trim();
  return flat === raw ? undefined : flat;
}

const ds = await __unstable__loadDesignSystem(INPUT, { base: TAILWIND_BASE, onDependency: () => {} });

const classList = ds.getClassList();
const names = classList.map(([name]) => name);
const cssPerClass = ds.candidatesToCss(names);

/** signature key → { props, classes: [name, values, hasModifiers][] } */
const topics = new Map();
for (let i = 0; i < names.length; i++) {
  const css = cssPerClass[i];
  if (css == null) continue; // a listed class Tailwind declines to compile — nothing to document
  const { props, decls } = signatureOf(declarationsOf(css));
  if (props.length === 0) continue;
  const key = props.join(',');
  let topic = topics.get(key);
  if (!topic) {
    topic = { props, classes: [] };
    topics.set(key, topic);
  }
  // Per class: its name, the value of each declaration (raw + resolved when a theme var backs it),
  // and whether it accepts modifiers (`text-sm/relaxed`) so the UI can say so.
  const values = decls.map(([, raw]) => {
    const resolved = resolveValue(ds, raw);
    return resolved ? [raw, resolved] : [raw];
  });
  topic.classes.push([names[i], values, classList[i][1]?.modifiers?.length > 0 ? 1 : 0]);
}

const variants = ds.getVariants().map((v) => ({
  name: v.name,
  hasDash: v.hasDash !== false,
  isArbitrary: v.isArbitrary === true,
  values: v.values ?? [],
}));

const tailwindVersion = require('tailwindcss/package.json').version;

if (process.argv.includes('--report')) {
  const rows = [...topics].sort((a, b) => b[1].classes.length - a[1].classes.length);
  console.log(`tailwindcss ${tailwindVersion} · ${names.length} classes · ${topics.size} signatures\n`);
  for (const [key, t] of rows) {
    console.log(`${String(t.classes.length).padStart(5)}  ${key}`);
    console.log(`       e.g. ${t.classes.slice(0, 4).map(([n]) => n).join(', ')}`);
  }
  process.exit(0);
}

const payload = {
  tailwindVersion,
  classCount: names.length,
  topics: [...topics].map(([sig, t]) => ({ sig, props: t.props, classes: t.classes })),
  variants,
};

const banner = `// GENERATED by scripts/gen-tailwind-reference.mjs — DO NOT EDIT.
// Run \`pnpm --filter @sitewright/tailwind-reference gen\` to regenerate.
// Derived from tailwindcss ${tailwindVersion} (MIT). Prose lives in ./topics.ts, which is authored.
import type { GeneratedReference } from './types.js';

export const GENERATED_REFERENCE: GeneratedReference = `;

writeFileSync(OUT, `${banner}${JSON.stringify(payload)};\n`, 'utf8');
console.log(
  `wrote ${OUT}\n  tailwindcss ${tailwindVersion} · ${names.length} classes · ${topics.size} topics · ${variants.length} variants`,
);
