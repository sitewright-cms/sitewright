// The shape of the Tailwind reference dataset, shared by the GENERATED half (generated.ts — class
// names, declarations, resolved theme values) and the AUTHORED half (topics.ts — category, title,
// description, preview kind). Keeping the two halves in separate files is what lets the generated
// one be diff-checked in CI (`gen:check`) without a human edit ever conflicting.
//
// ★ This module is published separately as `@sitewright/tailwind-reference/meta`, and the EDITOR must
// import from there rather than from the package root. The root re-exports `GENERATED_REFERENCE` —
// 2.17 MB of data literal that belongs on the server and reaches the browser over `/authoring/
// tailwind/reference`, never in the SPA bundle. Rollup happens to tree-shake it today, but that is
// the bundler being clever about a side-effect-free module, not a guarantee; importing the subpath
// makes it structural instead. `test/no-root-import.test.ts` in the editor enforces it.

/** The top-level shelves of the reference, in the order the UI lists them. */
export const CATEGORIES = [
  'layout',
  'flexbox-grid',
  'spacing',
  'sizing',
  'typography',
  'backgrounds',
  'borders',
  'effects',
  'filters',
  'tables',
  'transitions',
  'transforms',
  'interactivity',
  'svg',
  'accessibility',
] as const;

export type Category = (typeof CATEGORIES)[number];

/** Human labels for the category shelves. */
export const CATEGORY_LABELS: Record<Category, string> = {
  layout: 'Layout',
  'flexbox-grid': 'Flexbox & Grid',
  spacing: 'Spacing',
  sizing: 'Sizing',
  typography: 'Typography',
  backgrounds: 'Backgrounds',
  borders: 'Borders',
  effects: 'Effects',
  filters: 'Filters',
  tables: 'Tables',
  transitions: 'Transitions & Animation',
  transforms: 'Transforms',
  interactivity: 'Interactivity',
  svg: 'SVG',
  accessibility: 'Accessibility',
};

/**
 * How (and whether) a topic's classes can be shown rather than described.
 *
 * A preview is only worth rendering when the utility's effect is visible on a single, uncontrived
 * element. `display:flex` is not — a demo of it needs a whole invented scene of child boxes, which
 * teaches nothing the declaration did not already say and is one more thing to maintain. Those
 * topics get `none` and lean on the generated CSS, which is exact.
 */
export type PreviewKind =
  /** A colour swatch (background/border/text/fill/ring/shadow colours, gradient stops). */
  | 'color'
  /** A specimen line of text carrying the utility (size, weight, tracking, family, decoration). */
  | 'text'
  /** A small box carrying the utility (radius, shadow, opacity, blur, gradient, animation). */
  | 'box'
  /** A bar whose length is the value (padding, margin, width, gap, inset). */
  | 'size'
  /** A hoverable patch that adopts the cursor. */
  | 'cursor'
  /** No preview — the generated CSS is the documentation. */
  | 'none';

/** The authored prose + presentation for one CSS-property signature. */
export interface TopicDoc {
  category: Category;
  /** Human title, e.g. "Font Size". */
  title: string;
  /** One sentence: what the utilities in this topic control. */
  description: string;
  preview: PreviewKind;
}

/**
 * One generated CSS declaration, self-describing so it can never be misaligned against anything:
 *   `[prop, raw]`                          — a plain declaration
 *   `[prop, raw, resolved]`                — `raw` is a `var(…)` the generator resolved
 *   `[prop, raw, resolved, condition]`     — applies only inside `condition` (an `@media`/`@supports`)
 *
 * `resolved` is `''` when no theme variable backs the value. The fourth slot is what stops a
 * breakpoint-scoped declaration from being presented as though it always applied.
 */
export type ClassDecl =
  | readonly [prop: string, raw: string]
  | readonly [prop: string, raw: string, resolved: string]
  | readonly [prop: string, raw: string, resolved: string, condition: string];

/** A documented utility class: name, its own declarations, and 1 when it accepts modifiers. */
export type GeneratedClass = readonly [name: string, decls: readonly ClassDecl[], modifiers: 0 | 1];

/** The value a declaration should be shown as — the resolved theme value when there is one. */
export function declValue(decl: ClassDecl): string {
  return decl[2] || decl[1];
}

/** The `@media`/`@supports` a declaration is scoped to, or null when it applies unconditionally. */
export function declCondition(decl: ClassDecl): string | null {
  return decl.length === 4 ? decl[3] : null;
}

/** `font-size: 0.875rem`, with the condition appended when the declaration is scoped to one. */
export function formatDecl(decl: ClassDecl): string {
  const condition = declCondition(decl);
  const base = `${decl[0]}: ${declValue(decl)}`;
  return condition ? `${base} (${condition})` : base;
}

/** A group of classes that generate the same set of CSS properties. */
export interface GeneratedTopic {
  /** The property signature — the join key into the authored `TOPIC_DOCS`. */
  sig: string;
  props: readonly string[];
  classes: readonly GeneratedClass[];
}

/** A Tailwind variant (`hover:`, `sm:`, `group-*:`) as reported by the design system. */
export interface GeneratedVariant {
  name: string;
  hasDash: boolean;
  isArbitrary: boolean;
  values: readonly string[];
}

/** The generated half of the dataset, verbatim from the installed Tailwind. */
export interface GeneratedReference {
  tailwindVersion: string;
  classCount: number;
  topics: readonly GeneratedTopic[];
  variants: readonly GeneratedVariant[];
}

/** A topic with its prose joined on — what the API serves and the editor renders. */
export interface ReferenceTopic extends GeneratedTopic, TopicDoc {
  /** Stable id for deep-linking + React keys (the signature, slugified). */
  id: string;
}

/** The whole reference, ready to serve. */
export interface TailwindReference {
  tailwindVersion: string;
  classCount: number;
  topics: readonly ReferenceTopic[];
  variants: readonly GeneratedVariant[];
}
