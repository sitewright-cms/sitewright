// A static `{{> name}}` / `{{#> name}}` partial include, the name bare or quoted (`{{> "name"}}` renders the same; snippet
// names are identifier-safe). Module-scoped +
// `g` flag, but used ONLY via String.matchAll (which resets lastIndex per call), so the shared lastIndex
// state is not a hazard. Linear; no ReDoS.
const PARTIAL_REF = /\{\{~?\s*#?>\s*["']?([a-zA-Z][a-zA-Z0-9_-]*)/g;

/**
 * The subset of `partials` a render of `rootSources` can reach: every `{{> name}}` they include, expanded
 * transitively (a snippet may compose another). Each partial is visited ONCE, so a cycle (a → b → a) or a
 * diamond terminates and the walk is bounded by `partials` itself — never more text than the map holds,
 * which every render already validates whole. A name the map does not define is skipped (the render fails
 * on it with its own clear error), and so is a dynamic `{{> (lookup …)}}`, which no scan can resolve.
 *
 * Two jobs: only-used-ships (a defined-but-unused snippet adds no utilities or runtimes to a build), and the
 * REFERENCED-ONLY binding gates (`page.parent`, `page.children`, `pages.*`, …). ★ A gate must read what the
 * render will actually run — the page AND what it composes. Reading the page's own text alone built nothing
 * for a binding named only inside a snippet, and the snippet then rendered it as empty, with no error.
 */
export function reachablePartials(
  rootSources: readonly (string | null | undefined)[],
  partials: Readonly<Record<string, string>>,
): Record<string, string> {
  const used = new Set<string>();
  const queue: string[] = [];
  const scan = (src: string | null | undefined): void => {
    if (!src) return;
    for (const m of src.matchAll(PARTIAL_REF)) {
      const name = m[1]!;
      // Own keys only: `{{> constructor}}` must not walk into Object.prototype.
      if (Object.hasOwn(partials, name) && !used.has(name)) {
        used.add(name);
        queue.push(name); // a reached partial may itself compose others
      }
    }
  };
  for (const s of rootSources) scan(s);
  while (queue.length) scan(partials[queue.shift()!]);
  return Object.fromEntries(Object.entries(partials).filter(([n]) => used.has(n)));
}
