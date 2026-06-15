import { describe, it, expect } from 'vitest';
import type { Entry } from '@sitewright/schema';
import { compareEntryOrder, keyedDatasets } from '../src/index.js';

describe('compareEntryOrder', () => {
  it('sorts by order ascending, absent last, with an id tie-break', () => {
    const mk = (id: string, order?: number): Entry => ({ id, dataset: 'd', status: 'published', values: {}, ...(order !== undefined ? { order } : {}) });
    const sorted = [mk('b', 2), mk('a', 1), mk('z'), mk('y'), mk('c', 1)].slice().sort(compareEntryOrder).map((e) => e.id);
    expect(sorted).toEqual(['a', 'c', 'b', 'y', 'z']);
  });
});

describe('keyedDatasets', () => {
  const data: Record<string, Entry[]> = {
    services: [
      { id: 'web', dataset: 'services', status: 'published', values: { title: 'Web' } },
      { id: 'app', dataset: 'services', status: 'published', values: { title: 'App' } },
    ],
    team: [{ id: 'mara', dataset: 'team', status: 'published', values: { name: 'Mara' } }],
  };

  it('builds keyed maps ONLY for datasets the source addresses by key (flat values)', () => {
    const out = keyedDatasets('<h1>{{item.services.web.title}}</h1>', data);
    expect(Object.keys(out)).toEqual(['services']); // team is not referenced → not built
    expect(out.services!.web).toEqual({ title: 'Web' });
    expect(out.services!.app).toEqual({ title: 'App' });
  });

  it('returns {} when the source never uses item.', () => {
    expect(keyedDatasets('{{#each dataset.services}}{{title}}{{/each}}', data)).toEqual({});
  });

  it('skips an unknown or prototype-named dataset slug', () => {
    expect(keyedDatasets('{{item.nope.x}} {{item.__proto__.x}}', data)).toEqual({});
  });

  it('does not false-match `item` after a hyphen, word char, or dot', () => {
    expect(keyedDatasets('<div class="nav-item.services">x</div>', data)).toEqual({});
    expect(keyedDatasets('{{dataset.item.services}}', data)).toEqual({});
  });

  it('builds the map for the explicit @root.item.<dataset> form (keyed lookups inside {{#each}} scopes)', () => {
    const out = keyedDatasets("{{#each dataset.roles}}{{#with (lookup @root.item.services manager)}}{{title}}{{/with}}{{/each}}", data);
    expect(Object.keys(out)).toEqual(['services']);
    expect(keyedDatasets('{{dataset.item.services}}', data)).toEqual({});
    expect(keyedDatasets('xitem.services', data)).toEqual({});
  });
});
