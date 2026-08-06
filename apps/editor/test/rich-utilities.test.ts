// The rich-text toolbars emit Tailwind utilities into author content at RUNTIME, so this SPA's source
// scan never sees them — they reach the stylesheet only because styles.css lists them in `@source
// inline(...)`. That list is a hand-written mirror of `RICH_CONTENT_SAFELIST`, and a mirror drifts: add a
// swatch to the shared spec and the new class ships DEAD (applied to the DOM, no rule, nothing on screen)
// with nothing failing. This test is the thing that fails.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RICH_CONTENT_SAFELIST } from '@sitewright/blocks';

// Vitest's root is the editor package, and `import.meta.url` is not a file: URL under its transform.
const cssPath = resolve(process.cwd(), 'src/styles.css');

/** Every class token listed in any `@source inline("…")` directive in the editor stylesheet. */
function inlinedClasses(css: string): Set<string> {
  const out = new Set<string>();
  for (const m of css.matchAll(/@source\s+inline\(\s*"([^"]*)"\s*\)/g)) {
    for (const token of m[1]!.split(/\s+/)) if (token) out.add(token);
  }
  return out;
}

describe('editor stylesheet compiles the rich-text toolbar vocabulary', () => {
  const inlined = inlinedClasses(readFileSync(cssPath, 'utf8'));

  it('inlines every class the toolbars can emit', () => {
    const missing = RICH_CONTENT_SAFELIST.filter((c) => !inlined.has(c));
    expect(missing, `add these to an @source inline(...) in styles.css: ${missing.join(' ')}`).toEqual([]);
  });

  it('inlines nothing the toolbars cannot emit (no stale entries)', () => {
    const safelist = new Set<string>(RICH_CONTENT_SAFELIST);
    const stale = [...inlined].filter((c) => !safelist.has(c));
    expect(stale, `remove these from styles.css @source inline(...): ${stale.join(' ')}`).toEqual([]);
  });

  it('covers the full emittable set, not a subset that happens to match', () => {
    // Guards the degenerate pass where both sides are empty (e.g. a bad regex silently matching nothing).
    expect(inlined.size).toBe(RICH_CONTENT_SAFELIST.length);
    expect(inlined.size).toBeGreaterThan(30);
  });
});
