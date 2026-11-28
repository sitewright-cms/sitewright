import { describe, it, expect } from 'vitest';
import type { Dataset, Page } from '@sitewright/schema';
import { GLOBAL_SNIPPET_PARTIALS, WIDGET_PARTIALS } from '@sitewright/core';
import {
  datasetControlTargets,
  localeCopyRenames,
  rewriteDataLeaf,
  rewriteDatasetRefsInSource,
  rewriteReferenceTargets,
  rewriteWebsiteDatasetRefs,
  sourceReferencesDataset,
  widgetUsages,
} from '../src/repo/dataset-rename.js';
import { planDatasetRename } from '../src/repo/dataset-rename-plan.js';

describe('rewriteDatasetRefsInSource', () => {
  it('rewrites each/pick-entry paths + the sw-control picker arg, preserving quote style', () => {
    const src = `{{#each dataset.items}}{{title}}{{/each}} {{#sw-pick-entry dataset.items @root.x}}{{/sw-pick-entry}} {{sw-control dataset="items"}} {{sw-control dataset='items'}}`;
    const out = rewriteDatasetRefsInSource(src, 'items', 'features');
    expect(out).toBe(`{{#each dataset.features}}{{title}}{{/each}} {{#sw-pick-entry dataset.features @root.x}}{{/sw-pick-entry}} {{sw-control dataset="features"}} {{sw-control dataset='features'}}`);
  });

  it('rewrites a property-access path but does NOT touch a different slug with the same prefix', () => {
    expect(rewriteDatasetRefsInSource('{{dataset.items.length}}', 'items', 'features')).toBe('{{dataset.features.length}}');
    // sibling slugs that merely share the prefix must be left alone (underscore + hyphen boundaries)
    expect(rewriteDatasetRefsInSource('{{#each dataset.items2}}x{{/each}}', 'items', 'features')).toBe('{{#each dataset.items2}}x{{/each}}');
    expect(rewriteDatasetRefsInSource('{{#each dataset.items_archive}}x{{/each}}', 'items', 'features')).toBe('{{#each dataset.items_archive}}x{{/each}}');
    expect(rewriteDatasetRefsInSource('{{#each dataset.items-archive}}x{{/each}}', 'items', 'features')).toBe('{{#each dataset.items-archive}}x{{/each}}');
  });

  it('normalizes the legacy bracket form `dataset.[old]` to the dotted underscore form (migration)', () => {
    // a hyphenated slug had to be bracketed to survive Handlebars; migrating to underscore drops the brackets
    expect(rewriteDatasetRefsInSource('{{#each dataset.[faq-passengers]}}x{{/each}}', 'faq-passengers', 'faq_passengers')).toBe(
      '{{#each dataset.faq_passengers}}x{{/each}}',
    );
    // both the bracket form AND a stray broken dotted form get normalized in one pass
    expect(rewriteDatasetRefsInSource('{{#each dataset.[a-b]}}{{/each}}{{sw-control dataset="a-b"}}', 'a-b', 'a_b')).toBe(
      '{{#each dataset.a_b}}{{/each}}{{sw-control dataset="a_b"}}',
    );
  });

  it('does not match `dataset` embedded in a longer identifier', () => {
    expect(rewriteDatasetRefsInSource('{{mydataset.items}}', 'items', 'features')).toBe('{{mydataset.items}}');
  });

  it('is a no-op when the slug is unchanged or absent', () => {
    expect(rewriteDatasetRefsInSource('{{#each dataset.items}}{{/each}}', 'items', 'items')).toBe('{{#each dataset.items}}{{/each}}');
    expect(rewriteDatasetRefsInSource('<p>no datasets here</p>', 'items', 'features')).toBe('<p>no datasets here</p>');
  });
});

describe('sourceReferencesDataset', () => {
  it('detects path + picker-arg references, and ignores prefix-siblings', () => {
    expect(sourceReferencesDataset('{{#each dataset.items}}{{/each}}', 'items')).toBe(true);
    expect(sourceReferencesDataset('{{sw-control dataset="items"}}', 'items')).toBe(true);
    expect(sourceReferencesDataset('{{#each dataset.[faq-passengers]}}{{/each}}', 'faq-passengers')).toBe(true); // legacy bracket form
    expect(sourceReferencesDataset('{{#each dataset.items2}}{{/each}}', 'items')).toBe(false);
    expect(sourceReferencesDataset('{{#each dataset.items_archive}}{{/each}}', 'items')).toBe(false);
    expect(sourceReferencesDataset('<p>x</p>', 'items')).toBe(false);
  });
});

describe('rewriteDatasetRefsInSource — keyed item.<slug> lookups', () => {
  it('rewrites item.<old> at a root boundary and @root.item.<old> inside a loop', () => {
    expect(rewriteDatasetRefsInSource('{{item.items.e1.title}}', 'items', 'features')).toBe('{{item.features.e1.title}}');
    expect(rewriteDatasetRefsInSource('{{lookup @root.item.items manager}}', 'items', 'features')).toBe('{{lookup @root.item.features manager}}');
    expect(rewriteDatasetRefsInSource('{{#with item.items}}{{e1.title}}{{/with}}', 'items', 'features')).toBe('{{#with item.features}}{{e1.title}}{{/with}}');
  });

  it('leaves what the engine does not read as the item namespace, and prefix-siblings, alone', () => {
    // `nav-item.x` / `this.item.x` / `dataset.item.x` are not the keyed namespace (same rule as ITEM_REF_RE)
    for (const src of ['{{nav-item.items.x}}', '{{this.item.items.x}}', '{{dataset.item.items}}', '{{myitem.items.x}}', '{{item.items2.x}}', '{{item.items_archive.x}}']) {
      expect(rewriteDatasetRefsInSource(src, 'items', 'features')).toBe(src);
    }
  });

  it('is detected by sourceReferencesDataset', () => {
    expect(sourceReferencesDataset('{{item.items.e1.title}}', 'items')).toBe(true);
    expect(sourceReferencesDataset('{{lookup @root.item.items x}}', 'items')).toBe(true);
    expect(sourceReferencesDataset('{{item.items2.e1}}', 'items')).toBe(false);
  });

  it('migrates a legacy hyphenated slug in an item lookup too', () => {
    expect(rewriteDatasetRefsInSource('{{item.faq-passengers.q1.answer}}', 'faq-passengers', 'faq_passengers')).toBe('{{item.faq_passengers.q1.answer}}');
  });

  it('never touches a loop variable or row field called `item` — inside a block a bare item.x is not the keyed namespace', () => {
    const loop = '{{#each dataset.members as |item|}}{{item.team}}{{/each}}';
    expect(rewriteDatasetRefsInSource(loop, 'team', 'staff')).toBe(loop);
    expect(rewriteDatasetRefsInSource('{{#each dataset.orders}}{{item.team}}{{/each}}', 'team', 'staff')).toBe('{{#each dataset.orders}}{{item.team}}{{/each}}');
    expect(sourceReferencesDataset(loop, 'team')).toBe(false);
  });

  it('inside a block, rewrites only what reaches the root: @root.item and enough ../', () => {
    expect(rewriteDatasetRefsInSource('{{#each dataset.x}}{{@root.item.team.a.name}} {{../item.team.a.name}} {{item.team.a}}{{/each}}', 'team', 'staff')).toBe(
      '{{#each dataset.x}}{{@root.item.staff.a.name}} {{../item.staff.a.name}} {{item.team.a}}{{/each}}',
    );
    expect(rewriteDatasetRefsInSource('{{#each a}}{{#each b}}{{../item.team.x}}{{../../item.team.x}}{{/each}}{{/each}}', 'team', 'staff')).toBe(
      '{{#each a}}{{#each b}}{{../item.team.x}}{{../../item.staff.x}}{{/each}}{{/each}}',
    );
  });

  it('treats if/unless as transparent, reads a block opener in the OUTER context, and pops on the close', () => {
    expect(rewriteDatasetRefsInSource('{{#if x}}{{item.team.a.n}}{{/if}}', 'team', 'staff')).toBe('{{#if x}}{{item.staff.a.n}}{{/if}}');
    expect(rewriteDatasetRefsInSource('{{#with item.team.a as |m|}}{{m.n}}{{/with}}{{item.team.b.n}}', 'team', 'staff')).toBe(
      '{{#with item.staff.a as |m|}}{{m.n}}{{/with}}{{item.staff.b.n}}',
    );
    // a `}}` inside a quoted argument does not end the tag (the block still opens)
    expect(rewriteDatasetRefsInSource('{{#each dataset.x label="}}"}}{{item.team.a}}{{/each}}', 'team', 'staff')).toBe('{{#each dataset.x label="}}"}}{{item.team.a}}{{/each}}');
  });

  it("renders a context-changing block's {{else}} in the OUTER context, and restores the depth at its close", () => {
    const r = (s: string) => rewriteDatasetRefsInSource(s, 'team', 'staff');
    expect(r('{{#each x}}{{item.team.a}}{{else}}{{item.team.q}}{{/each}}')).toBe('{{#each x}}{{item.team.a}}{{else}}{{item.staff.q}}{{/each}}');
    expect(r('{{#with y}}{{item.team.a}}{{^}}{{item.team.q}}{{/with}}')).toBe('{{#with y}}{{item.team.a}}{{^}}{{item.staff.q}}{{/with}}');
    expect(r('{{#each x}}{{else if c}}{{item.team.q}}{{/each}}')).toBe('{{#each x}}{{else if c}}{{item.staff.q}}{{/each}}'); // chained if keeps the outer context
    expect(r('{{#if c}}{{else each x}}{{item.team.q}}{{/if}}')).toBe('{{#if c}}{{else each x}}{{item.team.q}}{{/if}}'); // chained each enters one
    expect(r('{{#if c}}{{item.team.a}}{{else}}{{item.team.b}}{{/if}}')).toBe('{{#if c}}{{item.staff.a}}{{else}}{{item.staff.b}}{{/if}}');
    expect(r('{{#each x}}{{else}}{{/each}}{{item.team.c}}')).toBe('{{#each x}}{{else}}{{/each}}{{item.staff.c}}');
    // the inner block's else is in the OUTER block's context — still not the root
    expect(r('{{#each a}}{{#each b}}{{else}}{{item.team.q}}{{/each}}{{/each}}')).toBe('{{#each a}}{{#each b}}{{else}}{{item.team.q}}{{/each}}{{/each}}');
  });

  it("reads a chained else's own arguments in the OUTER context, and knows else followed by any whitespace", () => {
    const r = (s: string) => rewriteDatasetRefsInSource(s, 'team', 'staff');
    expect(r('{{#each x}}{{else if item.team.b}}{{item.team.q}}{{/each}}')).toBe('{{#each x}}{{else if item.staff.b}}{{item.staff.q}}{{/each}}');
    expect(r('{{#each x}}{{else\tif c}}{{item.team.q}}{{/each}}')).toBe('{{#each x}}{{else\tif c}}{{item.staff.q}}{{/each}}');
    expect(r('{{#each x}}{{else\n}}{{item.team.q}}{{/each}}')).toBe('{{#each x}}{{else\n}}{{item.staff.q}}{{/each}}');
    expect(r('{{#each x}}{{elsewhere}}{{item.team.q}}{{/each}}')).toBe('{{#each x}}{{elsewhere}}{{item.team.q}}{{/each}}'); // a helper, not an else
  });

  it('stays linear on adversarial input — 20k openers then 20k stray closers (≈240 KB)', () => {
    const src = `${'{{#a}}'.repeat(20_000)}${'{{/b}}'.repeat(20_000)}{{item.team.x}}`;
    const t0 = performance.now();
    rewriteDatasetRefsInSource(src, 'team', 'staff');
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it('honours escaped quotes in string literals — a \\" does not end the string', () => {
    const src = '{{t "a\\"b"}}{{#each dataset.members as |item|}}{{item.team}}{{/each}}';
    expect(rewriteDatasetRefsInSource(src, 'team', 'staff')).toBe(src);
    expect(rewriteDatasetRefsInSource("{{t 'it\\'s'}}{{#each x}}{{item.team.a}}{{/each}}", 'team', 'staff')).toBe("{{t 'it\\'s'}}{{#each x}}{{item.team.a}}{{/each}}");
  });

  it('ends a comment opened with ~ at its own closer, so a quote in it hides nothing after it', () => {
    expect(rewriteDatasetRefsInSource("{{~!-- don't --~}}{{item.team.a}}", 'team', 'staff')).toBe("{{~!-- don't --~}}{{item.staff.a}}");
    expect(rewriteDatasetRefsInSource("{{~! don't ~}}{{item.team.a}}", 'team', 'staff')).toBe("{{~! don't ~}}{{item.staff.a}}");
    expect(datasetControlTargets(["{{~!-- it's a picker --~}}{{sw-control target=\"x\" as=\"dataset\"}}"])).toEqual([{ store: 'page', path: 'x' }]);
    expect(datasetControlTargets(["{{~! it's a picker ~}}{{sw-control target=\"x\" as=\"dataset\"}}"])).toEqual([{ store: 'page', path: 'x' }]);
  });

  it('treats a {{{{raw}}}} body and a \\{{ escaped mustache as text, not as blocks', () => {
    expect(rewriteDatasetRefsInSource('{{{{raw}}}}{{#each x}}{{{{/raw}}}}{{item.team.a}}', 'team', 'staff')).toBe('{{{{raw}}}}{{#each x}}{{{{/raw}}}}{{item.staff.a}}');
    expect(rewriteDatasetRefsInSource('\\{{#each x}} {{item.team.a}}', 'team', 'staff')).toBe('\\{{#each x}} {{item.staff.a}}');
    // `\\{{` is an escaped BACKSLASH followed by a real mustache
    expect(rewriteDatasetRefsInSource('\\\\{{#each x}}{{item.team.a}}{{/each}}', 'team', 'staff')).toBe('\\\\{{#each x}}{{item.team.a}}{{/each}}');
  });
});

describe('rewriteReferenceTargets', () => {
  it('rewrites a reference field target (config.dataset) at any depth + reports changed', () => {
    const fields = [
      { name: 'a', type: 'text' },
      { name: 'rel', type: 'reference', config: { dataset: 'items' } },
      { name: 'grp', type: 'object', fields: [{ name: 'inner', type: 'reference', config: { dataset: 'items', label: 'x' } }] },
    ];
    const { fields: out, changed } = rewriteReferenceTargets(fields, 'items', 'features');
    expect(changed).toBe(true);
    expect(out[1]).toEqual({ name: 'rel', type: 'reference', config: { dataset: 'features' } });
    expect((out[2] as { fields: unknown[] }).fields[0]).toEqual({ name: 'inner', type: 'reference', config: { dataset: 'features', label: 'x' } });
    expect(out[0]).toBe(fields[0]); // untouched field reused (immutable)
    expect(fields[1]!.config).toEqual({ dataset: 'items' }); // input not mutated
  });

  it('also repoints the legacy config.target the old cascade wrote', () => {
    const fields = [{ name: 'rel', type: 'reference', config: { target: 'items' } }];
    expect(rewriteReferenceTargets(fields, 'items', 'features').fields[0]!.config).toEqual({ target: 'features' });
  });

  it('reports no change when no reference points at the slug, or a non-reference field merely holds it', () => {
    expect(rewriteReferenceTargets([{ name: 'rel', type: 'reference', config: { dataset: 'other' } }], 'items', 'features').changed).toBe(false);
    expect(rewriteReferenceTargets([{ name: 'kind', type: 'select', config: { dataset: 'items' } }], 'items', 'features').changed).toBe(false);
  });
});

describe('datasetControlTargets', () => {
  it('collects where each as="dataset" control stores its pick — page.data (bare or nested) and website.data', () => {
    const src = [
      `{{sw-control target="list_dataset" as="dataset"}}`,
      `{{ sw-control as='dataset' target='page.data.blocks.source' label="Source"}}`,
      `{{~sw-control target="website.data.footer_list" as="dataset"}}`,
      `{{sw-control target="hero_config" as="dataset-item" dataset="hero"}}`, // stores an entry id, not a slug
      `{{sw-control target="page.title" as="dataset"}}`, // not a data target
      `{{sw-control target="list_dataset" as="dataset"}}`, // duplicate
    ].join('\n');
    expect(datasetControlTargets([src, undefined])).toEqual([
      { store: 'page', path: 'list_dataset' },
      { store: 'page', path: 'blocks.source' },
      { store: 'website', path: 'footer_list' },
    ]);
  });

  it('reads the whole tag even with a `}` inside a quoted argument, and never mistakes data-as= / data-target=', () => {
    expect(datasetControlTargets(['{{sw-control label="a } b" target="list_dataset" as="dataset"}}'])).toEqual([{ store: 'page', path: 'list_dataset' }]);
    expect(datasetControlTargets(['{{sw-control target="x" as="text" data-as="dataset"}}'])).toEqual([]);
    expect(datasetControlTargets(['{{sw-control data-target="y" target="x" as="dataset"}}'])).toEqual([{ store: 'page', path: 'x' }]);
    expect(datasetControlTargets(['<span data-as="dataset" data-target="x">{{sw-icon "x"}}</span>'])).toEqual([]);
  });

  it('ignores targets the control itself would refuse', () => {
    expect(datasetControlTargets(['{{sw-control target="page.data.__proto__.x" as="dataset"}}', '{{sw-control target="data.x" as="dataset"}}'])).toEqual([]);
  });
});

describe('rewriteDataLeaf', () => {
  it('rewrites the string leaf at a dotted path only when it equals the old slug (immutably)', () => {
    const data = { a: { b: 'items', c: 'items' }, d: 1 };
    const r = rewriteDataLeaf(data, 'a.b', 'items', 'features');
    expect(r).toEqual({ data: { a: { b: 'features', c: 'items' }, d: 1 }, changed: true });
    expect(data.a.b).toBe('items');
    expect(rewriteDataLeaf(data, 'a.c', 'other', 'x')).toEqual({ data, changed: false });
    expect(rewriteDataLeaf(data, 'a.missing', 'items', 'x').data).toBe(data);
    expect(rewriteDataLeaf(undefined, 'a', 'items', 'x')).toEqual({ data: undefined, changed: false });
    expect(rewriteDataLeaf({ a: ['items'] }, 'a.0', 'items', 'x').changed).toBe(false); // arrays are not walked
    expect(rewriteDataLeaf({ constructor: 'items' }, 'constructor', 'items', 'x').changed).toBe(false);
  });
});

describe('rewriteWebsiteDatasetRefs', () => {
  it('rewrites chrome slots, data files and picked website.data values, and reports unchanged as the same object', () => {
    const website = {
      mainNav: '<div>{{#each dataset.items}}x{{/each}}</div>',
      footer: '<div>no data</div>',
      dataFiles: [{ path: 'a.json', dataset: 'items' }, { path: 'b.json', folder: 'gallery' }],
      data: { footer_list: 'items', other: 'items' },
      siteUrl: 'https://x.example',
    };
    const { website: out, changed } = rewriteWebsiteDatasetRefs(website, 'items', 'features', ['footer_list']);
    expect(changed).toBe(true);
    expect(out).toEqual({
      mainNav: '<div>{{#each dataset.features}}x{{/each}}</div>',
      footer: '<div>no data</div>',
      dataFiles: [{ path: 'a.json', dataset: 'features' }, { path: 'b.json', folder: 'gallery' }],
      data: { footer_list: 'features', other: 'items' },
      siteUrl: 'https://x.example',
    });
    expect(out.dataFiles[1]).toBe(website.dataFiles[1]);
    expect(rewriteWebsiteDatasetRefs(website, 'posts', 'articles', ['footer_list'])).toEqual({ website, changed: false });
  });
});

describe('localeCopyRenames', () => {
  const datasets = [
    { id: 'a', slug: 'team' },
    { id: 'b', slug: 'team_de' },
    { id: 'c', slug: 'team_pt_br' },
    { id: 'd', slug: 'team_fr' },
  ];
  it('finds the copy for each configured locale (the same suffix rule a page resolves with)', () => {
    expect(localeCopyRenames(datasets, ['en', 'de', 'pt-BR'], 'team', 'staff')).toEqual([
      { id: 'b', locale: 'de', oldSlug: 'team_de', newSlug: 'staff_de' },
      { id: 'c', locale: 'pt-BR', oldSlug: 'team_pt_br', newSlug: 'staff_pt_br' },
    ]);
  });
  it('leaves a <slug>_<x> alone when the site has no such language', () => {
    expect(localeCopyRenames(datasets, ['en'], 'team', 'staff')).toEqual([]);
  });
});

describe('widgetUsages', () => {
  const partials = { ...GLOBAL_SNIPPET_PARTIALS, ...WIDGET_PARTIALS, wrapper: '<div>{{> hero-slider}}</div>' };
  const rows = [
    { label: 'page "home"', source: '<div>{{> hero-slider}}</div>' },
    { label: 'page "about"', source: '<div>{{> wrapper}}</div>' },
    { label: 'page "list"', source: '<div>{{#each dataset.hero}}x{{/each}}</div>' },
  ];
  it('names where a widget that reads the slug is composed, directly or through a snippet', () => {
    expect(widgetUsages(rows, partials, 'hero', [])).toEqual([{ widget: 'hero-slider', usedBy: ['page "home"', 'page "about"'] }]);
  });
  it("counts the widget dataset's copy for a language the site has", () => {
    expect(widgetUsages(rows, partials, 'hero_de', ['en', 'de'])).toEqual([{ widget: 'hero-slider', usedBy: ['page "home"', 'page "about"'] }]);
    expect(widgetUsages(rows, partials, 'hero_de', ['en'])).toEqual([]);
  });
  it('is empty when no source composes it, or for a slug no widget reads', () => {
    expect(widgetUsages([rows[2]!], partials, 'hero', [])).toEqual([]);
    expect(widgetUsages(rows, partials, 'team', [])).toEqual([]);
  });
});

describe('planDatasetRename', () => {
  const ds = (id: string, slug: string, fields: Dataset['fields'] = []): Dataset => ({ id, name: id, slug, fields });
  const base = (over: Partial<Parameters<typeof planDatasetRename>[0]> = {}) => ({
    renamed: ds('team', 'staff', [{ name: 'manager', type: 'reference', required: false, localized: false, config: { dataset: 'team' } }]),
    oldSlug: 'team',
    cascade: true,
    datasets: [ds('team', 'team', [{ name: 'manager', type: 'reference', required: false, localized: false, config: { dataset: 'team' } }])],
    entries: [],
    pages: [],
    templates: [],
    snippets: [],
    library: { templates: [], snippets: [] },
    ...over,
  });

  it("repoints the dataset's reference to itself even without cascade", () => {
    const plan = planDatasetRename(base({ cascade: false }));
    expect(plan.datasets).toHaveLength(1);
    expect(plan.datasets[0]!.fields[0]!.config).toEqual({ dataset: 'staff' });
    expect(plan.referencesUpdated).toBe(0);
  });

  it('names the language and both slugs when a copy would collide', () => {
    const input = base({
      datasets: [ds('team', 'team'), ds('team_de', 'team_de'), ds('x', 'staff_de')],
      settings: { settings: { locales: ['en', 'de'] } },
    });
    expect(() => planDatasetRename(input)).toThrow(/"staff_de" already exists — renaming "team" also renames its "de" language copy "team_de"/);
  });

  it('leaves an untouched page row exactly as it was (no keys added)', () => {
    const page = { id: 'p', path: 'p', title: 'P', source: '<div>{{#each dataset.team}}x{{/each}}</div>' } as unknown as Page;
    const plan = planDatasetRename(base({ pages: [page, { id: 'q', path: 'q', title: 'Q' } as unknown as Page] }));
    expect(plan.pages).toEqual([{ id: 'p', path: 'p', title: 'P', source: '<div>{{#each dataset.staff}}x{{/each}}</div>' }]);
  });
});
