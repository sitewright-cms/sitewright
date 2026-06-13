// "SiteWright Components" library reference content — DERIVED from the canonical registries so it
// can NEVER drift from what actually ships:
//   • components ← COMPONENT_CATALOG (@sitewright/schema) — the same data behind the MCP get_components
//     tool + GET /authoring/components, and drift-test-guarded (packages/blocks/component-catalog.test).
//   • widgets    ← GLOBAL_WIDGETS (@sitewright/core).
// One tab (ReferenceGroup) per component + a "Widgets" tab. Add a component to the catalog (or a
// widget to the registry) and it appears here automatically — there is nothing to hand-maintain.
import { COMPONENT_CATALOG, type ComponentCatalogEntry } from '@sitewright/schema';
import { GLOBAL_WIDGETS, type Widget } from '@sitewright/core';
import type { ReferenceEntry, ReferenceGroup } from './reference';

/** One component → a tab: skeleton + worked examples + parts + options + no-JS + notes. */
function componentToGroup(c: ComponentCatalogEntry): ReferenceGroup {
  const kw = `${c.type} ${c.marker} component data-sw-component`.toLowerCase();
  const entries: ReferenceEntry[] = [];

  // Canonical insert (the validator-safe skeleton). For `embed` components (Form) it's the result of
  // a helper / render pass, not hand-authored.
  entries.push({
    id: `${c.type}-skeleton`,
    name: `${c.type} markup`,
    syntax: `data-sw-component="${c.marker}"`,
    keywords: kw,
    description:
      c.authoring === 'embed'
        ? 'Inserted by a helper / render pass — you don’t hand-author this markup; it’s the result.'
        : 'Copy-paste starting point.',
    example: c.skeleton,
  });

  // Optional worked examples (alternate authoring forms / layouts).
  (c.examples ?? []).forEach((ex, i) => {
    entries.push({ id: `${c.type}-ex-${i}`, name: ex.label, syntax: ex.label, keywords: kw, description: '', example: ex.code, note: ex.note });
  });

  // The data-sw-part structural roles.
  if (c.parts.length) {
    entries.push({
      id: `${c.type}-parts`,
      name: `${c.type} parts`,
      syntax: 'Parts (data-sw-part)',
      keywords: `${kw} parts roles`,
      description: 'The structural roles inside the component.',
      args: c.parts.map((p) => ({ name: `${p.part}${p.required ? '' : ' (optional)'} · <${p.element}>`, desc: p.description })),
      noCopy: true,
    });
  }

  // Configuration attributes / options.
  if (c.attributes.length) {
    entries.push({
      id: `${c.type}-attrs`,
      name: `${c.type} options`,
      syntax: 'Options & attributes (data-*)',
      keywords: `${kw} options attributes switches`,
      description: 'Configure the component with these attributes.',
      args: c.attributes.map((a) => ({ name: a.name, desc: `(${a.on}) ${a.description}` })),
      noCopy: true,
    });
  }

  entries.push({ id: `${c.type}-nojs`, name: `${c.type} without JavaScript`, syntax: 'Without JavaScript', keywords: `${kw} no-js progressive enhancement`, description: c.noJs, noCopy: true });
  entries.push({ id: `${c.type}-notes`, name: `${c.type} notes`, syntax: 'Notes', keywords: `${kw} notes guidance`, description: c.notes, noCopy: true });

  return { id: c.type.toLowerCase(), title: c.type, blurb: c.summary, entries };
}

/** All widgets → one "Widgets" tab. Each widget is composed with {{> name}} and provisions a dataset. */
function widgetsToGroup(widgets: readonly Widget[]): ReferenceGroup {
  const entries: ReferenceEntry[] = widgets.map((w) => ({
    id: `widget-${w.name}`,
    name: w.label,
    syntax: `{{> ${w.name}}}`,
    keywords: `widget ${w.name} ${w.label} ${w.component}`.toLowerCase(),
    description: w.description,
    example: `{{> ${w.name}}}`,
    args: w.provides.datasets.map((d) => ({ name: d.slug, desc: `${d.name} — config dataset, auto-provisioned on first use (then edited as data, no code).` })),
    note: `Built on the “${w.component}” component. Compose it with {{> ${w.name}}}; configure it through its dataset (no code).`,
  }));
  return {
    id: 'widgets',
    title: 'Widgets',
    blurb:
      'Managed building blocks composed with {{> name}} — they ship behaviour + styling and auto-provision a config dataset on first use, which you then edit as data (no code).',
    entries,
  };
}

/** Component tabs (from the catalog) + a Widgets tab (from the registry). Derived → never drifts. */
export const SW_COMPONENT_GROUPS: ReferenceGroup[] = [
  ...COMPONENT_CATALOG.map(componentToGroup),
  widgetsToGroup(GLOBAL_WIDGETS),
];
