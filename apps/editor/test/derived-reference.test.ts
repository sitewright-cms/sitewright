import { describe, it, expect } from 'vitest';
import { SW_DIRECTIVES, BINDING_NAMESPACES, LOOP_VARIABLES } from '@sitewright/schema';
import { REFERENCE_GROUPS } from '../src/views/library/reference';

// The Template reference's Directives / Bindings / Variables tabs are DERIVED from the canonical
// registries in @sitewright/schema (which authoring-reference.test.ts in @sitewright/blocks pins to
// the engine's real behavior). These tests pin the DERIVATION: each tab carries exactly the registry
// items, in order, with their content verbatim — so a registry change shows up in the library with
// nothing to hand-edit, and a hand-edit that breaks the mapping is caught here.
const group = (id: string) => REFERENCE_GROUPS.find((g) => g.id === id);

describe('Template reference tabs stay derived from the authoring-reference registries', () => {
  it('the Directives tab is exactly SW_DIRECTIVES (same ids, order, syntax + example verbatim)', () => {
    const g = group('directives');
    expect(g).toBeTruthy();
    expect(g!.entries.map((e) => e.id)).toEqual(SW_DIRECTIVES.map((d) => d.id));
    for (const d of SW_DIRECTIVES) {
      const e = g!.entries.find((x) => x.id === d.id)!;
      expect(e.syntax, d.id).toBe(d.syntax);
      expect(e.description, d.id).toBe(d.description);
      expect(e.example, d.id).toBe(d.example);
    }
  });

  it('the Bindings tab is exactly BINDING_NAMESPACES (same ids, order, content verbatim)', () => {
    const g = group('bindings');
    expect(g).toBeTruthy();
    expect(g!.entries.map((e) => e.id)).toEqual(BINDING_NAMESPACES.map((b) => b.id));
    for (const b of BINDING_NAMESPACES) {
      const e = g!.entries.find((x) => x.id === b.id)!;
      expect(e.syntax, b.id).toBe(b.syntax);
      expect(e.description, b.id).toBe(b.description);
      expect(e.example, b.id).toBe(b.example);
    }
  });

  it('the Variables tab is exactly LOOP_VARIABLES (same ids, order, content verbatim)', () => {
    const g = group('variables');
    expect(g).toBeTruthy();
    expect(g!.entries.map((e) => e.id)).toEqual(LOOP_VARIABLES.map((v) => v.id));
    for (const v of LOOP_VARIABLES) {
      const e = g!.entries.find((x) => x.id === v.id)!;
      expect(e.syntax, v.id).toBe(v.syntax);
      expect(e.description, v.id).toBe(v.description);
      expect(e.example, v.id).toBe(v.example);
    }
  });
});
