import { describe, it, expect } from 'vitest';
import { registeredSwHelpers } from '@sitewright/blocks';
import { REFERENCE_GROUPS } from '../src/views/library/reference';

// The Template reference's HELPER docs are pinned to the engine's actually-registered sw-* helpers,
// so a new / renamed / removed helper can't silently leave the reference stale — the analog of the
// component-catalog drift test. Descriptions stay authored; only COVERAGE is enforced here. (The
// data-sw-* directives, bindings and loop variables are conceptual platform facts with no runtime
// registry to derive from, so they remain authored.)
function documentedSwHelperInvocations(): Set<string> {
  const text = REFERENCE_GROUPS.flatMap((g) => g.entries)
    .flatMap((e) => [e.syntax, e.example ?? '', e.description])
    .join('\n');
  const found = new Set<string>();
  // A helper INVOCATION: {{sw-x …}}, {{#sw-x …}}, {{/sw-x}} or a subexpression (sw-x …). Deliberately
  // NOT data-sw-x="…" (a directive) nor class="sw-x" (an effect class) — those aren't preceded by {{ or (.
  for (const m of text.matchAll(/(?:\{\{[#/]?\s*|\(\s*)(sw-[a-z][a-z-]*)/g)) if (m[1]) found.add(m[1]);
  return found;
}

describe('Template reference stays in sync with the engine’s helpers', () => {
  const registered = registeredSwHelpers();

  it('the engine registers a non-trivial set of sw-* helpers (sanity)', () => {
    expect(registered.length).toBeGreaterThan(5);
  });

  it('documents every registered sw-* helper', () => {
    const documented = documentedSwHelperInvocations();
    for (const h of registered) {
      expect(documented, `${h} is registered but not documented in the Template reference`).toContain(h);
    }
  });

  it('every documented sw-* helper invocation is a real registered helper', () => {
    const registeredSet = new Set(registered);
    for (const h of documentedSwHelperInvocations()) {
      expect(registeredSet, `${h} is documented but not a registered helper (rename/typo/removed?)`).toContain(h);
    }
  });
});
