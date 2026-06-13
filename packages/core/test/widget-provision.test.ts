import { describe, it, expect } from 'vitest';
import { GLOBAL_SNIPPET_PARTIALS } from '../src/global-snippets.js';
import {
  widgetDatasetsForSources,
  WIDGET_MANIFESTS,
  WIDGET_PARTIALS,
  GLOBAL_WIDGETS,
  type WidgetProvides,
} from '../src/widgets.js';

describe('widgetDatasetsForSources', () => {
  it('returns the hero Widget dataset spec when a page composes {{> hero-slider}}', () => {
    const specs = widgetDatasetsForSources(['<section>{{> hero-slider}}</section>']);
    expect(specs.map((d) => d.slug)).toContain('hero');
    const hero = specs.find((d) => d.slug === 'hero')!;
    expect(hero.name).toBe('Hero Slider');
    expect(hero.fields.find((f) => f.name === 'slides')?.type).toBe('list');
    expect(hero.fields.find((f) => f.name === 'kenburns')?.type).toBe('boolean');
    // Captions are RICHTEXT so they support basic HTML (rendered via {{sw-rich}}).
    const slides = hero.fields.find((f) => f.name === 'slides');
    expect(slides?.fields?.find((f) => f.name === 'caption')?.type).toBe('richtext');
    expect(hero.seed?.[0]?.id).toBe('config');
  });

  it('returns nothing for a page with no Widget references', () => {
    expect(widgetDatasetsForSources(['<div class="hero">{{> features}}</div>'])).toEqual([]);
  });

  it('the built-in manifest registry exposes hero-slider', () => {
    expect(WIDGET_MANIFESTS['hero-slider']?.datasets[0]?.slug).toBe('hero');
  });

  // Synthetic widgets to exercise transitivity + dedupe without coupling to the built-ins.
  const manifests: Record<string, WidgetProvides> = {
    alpha: { datasets: [{ slug: 'a', name: 'A', fields: [{ name: 't', type: 'text', required: false, localized: false }] }] },
    beta: { datasets: [{ slug: 'b', name: 'B', fields: [{ name: 't', type: 'text', required: false, localized: false }] }] },
  };
  const partials = { alpha: '<div>{{> beta}}</div>', beta: '<div>b</div>' };

  it('follows {{> name}} transitively (a Widget composing another Widget provisions both)', () => {
    const specs = widgetDatasetsForSources(['{{> alpha}}'], partials, manifests);
    expect(specs.map((d) => d.slug).sort()).toEqual(['a', 'b']);
  });

  it('dedupes a dataset slug referenced from multiple places', () => {
    const specs = widgetDatasetsForSources(['{{> alpha}} {{> alpha}}'], partials, manifests);
    expect(specs.filter((d) => d.slug === 'a')).toHaveLength(1);
  });
});

describe('Widget / Snippet hard separation', () => {
  it('hero-slider is a Widget (in WIDGET_PARTIALS), NOT a global snippet', () => {
    expect(WIDGET_PARTIALS['hero-slider']).toBeTruthy();
    // Must NOT leak into the snippet registry (which seeds the editor Snippets rail).
    expect(GLOBAL_SNIPPET_PARTIALS['hero-slider']).toBeUndefined();
  });

  it('every Widget declares a config dataset and a data-sw-component', () => {
    for (const w of GLOBAL_WIDGETS) {
      expect(w.provides.datasets.length, `widget "${w.name}" must provide a dataset`).toBeGreaterThan(0);
      expect(w.component.length, `widget "${w.name}" must name its component`).toBeGreaterThan(0);
    }
  });

  it('the hero-slider body consumes its provisioned `hero` dataset (picks one config + loops slides)', () => {
    expect(WIDGET_PARTIALS['hero-slider']).toContain('sw-pick-entry data.hero');
    expect(WIDGET_PARTIALS['hero-slider']).toContain('{{#each slides}}');
  });
});
