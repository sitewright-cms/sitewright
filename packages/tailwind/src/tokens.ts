import type { TailwindTheme } from './theme.js';

// A theme variable NAME must be a safe CSS identifier — defense-in-depth so a brand key cannot
// smuggle characters into the generated `@theme { … }` block. The authoritative constraint is the
// schema's ColorTokenKeySchema, which is STRICTER (rejects a trailing hyphen, caps length); this
// is a looser superset over the same `-`/`_` alphabet, so any schema-valid color key passes here
// and is never silently dropped.
// Caveat: Tailwind treats `_` as a space inside class candidates, so an underscore key (e.g.
// `nav_bg`) emits the `--color-nav_bg` var but is not reachable as a bare `bg-nav_bg` utility —
// use it via `bg-[var(--color-nav_bg)]`, or prefer single-word / camelCase brand token names.
export const SAFE_TOKEN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

// A theme variable VALUE must not contain CSS structural characters — a brand color/font value
// cannot break out of its declaration to inject arbitrary rules. Real colors (hex/oklch/rgb)
// and font stacks (`"Inter", sans-serif`) never contain these.
const SAFE_VALUE = /^[^;{}<>\n\r]+$/;

/** Brand colors/fonts as Tailwind theme vars (`--color-<token>`, `--font-<token>`); unsafe keys dropped. */
export function brandVars(theme: TailwindTheme): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(theme.colors ?? {})) if (SAFE_TOKEN.test(k)) vars[`--color-${k}`] = v;
  for (const [k, v] of Object.entries(theme.fonts ?? {})) if (SAFE_TOKEN.test(k)) vars[`--font-${k}`] = v;
  return vars;
}

/** Emit an `@theme { … }` block from a var map. Vars with structurally-unsafe values are dropped. */
export function renderThemeBlock(vars: Record<string, string>): string {
  const lines = Object.entries(vars)
    .filter(([, v]) => SAFE_VALUE.test(v))
    .map(([k, v]) => `  ${k}: ${v};`);
  return lines.length ? `\n@theme {\n${lines.join('\n')}\n}` : '';
}
