import { describe, it, expect } from 'vitest';
import { widgetDatasetsForSources, GLOBAL_SNIPPET_MANIFESTS, type WidgetProvides } from '../src/global-snippets.js';

describe('widgetDatasetsForSources', () => {
  it('returns the hero Widget dataset spec when a page composes {{> hero-slider}}', () => {
    const specs = widgetDatasetsForSources(['<section>{{> hero-slider}}</section>']);
    expect(specs.map((d) => d.slug)).toContain('hero');
    const hero = specs.find((d) => d.slug === 'hero')!;
    expect(hero.fields.find((f) => f.name === 'slides')?.type).toBe('list');
    expect(hero.seed?.[0]?.id).toBe('config');
  });

  it('returns nothing for a page with no Widget references', () => {
    expect(widgetDatasetsForSources(['<div class="hero">{{> features}}</div>'])).toEqual([]);
  });

  it('the built-in manifest registry exposes hero-slider', () => {
    expect(GLOBAL_SNIPPET_MANIFESTS['hero-slider']?.datasets[0]?.slug).toBe('hero');
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
