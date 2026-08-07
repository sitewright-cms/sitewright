import { describe, expect, it } from 'vitest';
import { buildPreviewUrl, fullRouteFor, parsePreviewTarget } from '../src/lib/preview-target';

describe('fullRouteFor', () => {
  // REGRESSION: the "open this page in a new tab" button passed the page's OWN path segment, but a
  // served route is `{parent slugs}/{slug}` (publish/build.ts composes it from the parent chain). A
  // nested page therefore opened the preview on a route that does not exist.
  const pages = [
    { id: 'home', path: '', parent: undefined },
    { id: 'services', path: 'services', parent: 'home' },
    { id: 'seo', path: 'seo', parent: 'services' },
  ];

  it('prefixes every ancestor segment', () => {
    expect(fullRouteFor({ path: 'seo', parent: 'services' }, pages)).toBe('services/seo');
  });

  it('drops the empty home segment so a top-level page keeps its bare slug', () => {
    expect(fullRouteFor({ path: 'services', parent: 'home' }, pages)).toBe('services');
    expect(fullRouteFor({ path: '', parent: undefined }, pages)).toBe('');
  });

  it('honours UNSAVED edits to the current page (own path/parent win over the stored list)', () => {
    // the page is stored under `services` but the open editor has re-parented it to the root
    expect(fullRouteFor({ path: 'seo', parent: 'home' }, pages)).toBe('seo');
    expect(fullRouteFor({ path: 'renamed', parent: 'services' }, pages)).toBe('services/renamed');
  });

  it('survives a broken chain: a missing or CYCLIC parent never hangs or throws', () => {
    expect(fullRouteFor({ path: 'orphan', parent: 'gone' }, pages)).toBe('orphan');
    const cycle = [
      { id: 'a', path: 'a', parent: 'b' },
      { id: 'b', path: 'b', parent: 'a' },
    ];
    expect(fullRouteFor({ path: 'x', parent: 'a' }, cycle)).toBe('b/a/x');
  });
});

describe('buildPreviewUrl + parsePreviewTarget round-trip', () => {
  it('carries a nested route through the ?preview= value', () => {
    const url = buildPreviewUrl('https://app.test', '/', 'proj123', 'services/seo');
    expect(url).toBe('https://app.test/?preview=proj123/services/seo');
    expect(parsePreviewTarget(new URL(url).search)).toEqual({ projectId: 'proj123', path: 'services/seo' });
  });

  it('opens the home page when there is no route', () => {
    const url = buildPreviewUrl('https://app.test', '/', 'proj123');
    expect(parsePreviewTarget(new URL(url).search)).toEqual({ projectId: 'proj123', path: '' });
  });
});
