import { describe, it, expect } from 'vitest';
import { registeredSwHelpers } from '@sitewright/blocks';
import { SW_HELPERS } from '@sitewright/schema';
import { REFERENCE_GROUPS } from '../src/views/library/reference';

// The Template reference's HELPER docs are pinned to the engine's actually-registered sw-* helpers,
// so a new / renamed / removed helper can't silently leave the reference stale — the analog of the
// component-catalog drift test. Descriptions stay authored; only COVERAGE is enforced here. (The
// data-sw-* directives, bindings and loop variables now DERIVE from canonical registries in
// @sitewright/schema — see derived-reference.test.ts here + authoring-reference.test.ts in
// @sitewright/blocks; the Expressions / Block-helpers / Partials / Effects tabs stay authored.)
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

  it('documents every registered sw-* helper (except the deprecated ones)', () => {
    // A DEPRECATED helper gets no entry of its own on purpose: an entry is a thing to copy, and the
    // point of deprecating it is that nobody should copy it. It is mentioned in its REPLACEMENT's note
    // instead — enough for someone who meets the old spelling in existing code to look it up, without
    // offering it as a current option. The exemption is sourced from SW_HELPERS (the canonical registry)
    // rather than an allowlist here, so it can't be used to quietly drop a live helper from the docs.
    const deprecated = new Set(SW_HELPERS.filter((h) => h.deprecated).map((h) => h.name));
    const documented = documentedSwHelperInvocations();
    for (const h of registered) {
      if (deprecated.has(h)) {
        expect(documented, `${h} is DEPRECATED — it must NOT have a reference entry of its own`).not.toContain(h);
        continue;
      }
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
