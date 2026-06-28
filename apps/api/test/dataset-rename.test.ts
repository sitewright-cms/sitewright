import { describe, it, expect } from 'vitest';
import { rewriteDatasetRefsInSource, sourceReferencesDataset, rewriteReferenceTargets } from '../src/repo/dataset-rename.js';

describe('rewriteDatasetRefsInSource', () => {
  it('rewrites each/pick-entry paths + the sw-control picker arg, preserving quote style', () => {
    const src = `{{#each dataset.items}}{{title}}{{/each}} {{#sw-pick-entry dataset.items @root.x}}{{/sw-pick-entry}} {{sw-control dataset="items"}} {{sw-control dataset='items'}}`;
    const out = rewriteDatasetRefsInSource(src, 'items', 'features');
    expect(out).toBe(`{{#each dataset.features}}{{title}}{{/each}} {{#sw-pick-entry dataset.features @root.x}}{{/sw-pick-entry}} {{sw-control dataset="features"}} {{sw-control dataset='features'}}`);
  });

  it('rewrites a property-access path but does NOT touch a different slug with the same prefix', () => {
    expect(rewriteDatasetRefsInSource('{{dataset.items.length}}', 'items', 'features')).toBe('{{dataset.features.length}}');
    // sibling slugs that merely share the prefix must be left alone
    expect(rewriteDatasetRefsInSource('{{#each dataset.items2}}x{{/each}}', 'items', 'features')).toBe('{{#each dataset.items2}}x{{/each}}');
    expect(rewriteDatasetRefsInSource('{{#each dataset.items-archive}}x{{/each}}', 'items', 'features')).toBe('{{#each dataset.items-archive}}x{{/each}}');
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
    expect(sourceReferencesDataset('{{#each dataset.items2}}{{/each}}', 'items')).toBe(false);
    expect(sourceReferencesDataset('<p>x</p>', 'items')).toBe(false);
  });
});

describe('rewriteReferenceTargets', () => {
  it('rewrites a reference field target at any depth + reports changed', () => {
    const fields = [
      { name: 'a', type: 'text' },
      { name: 'rel', type: 'reference', config: { target: 'items' } },
      { name: 'grp', type: 'object', fields: [{ name: 'inner', type: 'reference', config: { target: 'items' } }] },
    ];
    const { fields: out, changed } = rewriteReferenceTargets(fields, 'items', 'features');
    expect(changed).toBe(true);
    expect((out[1] as { config: { target: string } }).config.target).toBe('features');
    expect((out[2] as { fields: { config: { target: string } }[] }).fields[0]!.config.target).toBe('features');
    expect(out[0]).toBe(fields[0]); // untouched field reused (immutable)
  });

  it('reports no change when no reference points at the slug', () => {
    const fields = [{ name: 'rel', type: 'reference', config: { target: 'other' } }];
    expect(rewriteReferenceTargets(fields, 'items', 'features').changed).toBe(false);
  });
});
