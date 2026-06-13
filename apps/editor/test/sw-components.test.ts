import { describe, it, expect } from 'vitest';
import { COMPONENT_CATALOG } from '@sitewright/schema';
import { GLOBAL_WIDGETS } from '@sitewright/core';
import { SW_COMPONENT_GROUPS } from '../src/views/library/sw-components';

// The "SiteWright Components" library reference is DERIVED from COMPONENT_CATALOG + GLOBAL_WIDGETS,
// so it can't drift. These tests pin that invariant: every component + widget is covered, and the
// skeleton shown is the catalog's own — so a future component/widget shows up here automatically.
describe('SiteWright Components reference stays in sync with the registries', () => {
  it('has one tab per catalog component, in catalog order', () => {
    const componentTabs = SW_COMPONENT_GROUPS.filter((g) => g.id !== 'widgets');
    expect(componentTabs.map((g) => g.title)).toEqual(COMPONENT_CATALOG.map((c) => c.type));
  });

  it('each component tab documents skeleton + parts/options (when present) + no-JS + notes + examples', () => {
    for (const c of COMPONENT_CATALOG) {
      const g = SW_COMPONENT_GROUPS.find((x) => x.id === c.type.toLowerCase());
      expect(g, c.type).toBeTruthy();
      const ids = g!.entries.map((e) => e.id);
      expect(ids, c.type).toContain(`${c.type}-skeleton`);
      expect(ids, c.type).toContain(`${c.type}-nojs`);
      expect(ids, c.type).toContain(`${c.type}-notes`);
      if (c.parts.length) expect(ids, c.type).toContain(`${c.type}-parts`);
      if (c.attributes.length) expect(ids, c.type).toContain(`${c.type}-attrs`);
      (c.examples ?? []).forEach((_, i) => expect(ids, c.type).toContain(`${c.type}-ex-${i}`));
      // the skeleton card carries the catalog's own skeleton verbatim
      expect(g!.entries.find((e) => e.id === `${c.type}-skeleton`)?.example).toBe(c.skeleton);
      // the blurb is the catalog summary
      expect(g!.blurb).toBe(c.summary);
    }
  });

  it('has a Widgets tab with an entry per registered widget (composed via {{> name}})', () => {
    const widgets = SW_COMPONENT_GROUPS.find((g) => g.id === 'widgets');
    expect(widgets).toBeTruthy();
    for (const w of GLOBAL_WIDGETS) {
      const e = widgets!.entries.find((x) => x.id === `widget-${w.name}`);
      expect(e, w.name).toBeTruthy();
      expect(e!.syntax).toBe(`{{> ${w.name}}}`);
      expect(e!.example).toBe(`{{> ${w.name}}}`);
    }
  });
});
