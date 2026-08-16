import { describe, it, expect } from 'vitest';
import type { Page } from '@sitewright/schema';
import { hasOwnSource, type PageSummary } from '../src/page-summary';

// The pages list is SUMMARISED: `source` and `data` are omitted and described under `_summary`. Every
// screen predicate that used to ask `!!page.source` therefore had to move to `hasOwnSource`, and one of
// them is destructive — `removePage` splits a page's locale variants into followers (deleted with the
// page) and kept (survive) on exactly this question. Read naively against a summary, every variant
// looks source-less, so a FORKED translation would be classified as a follower and deleted.

const page = (over: Partial<Page>): Page => ({ id: 'p', path: 'p', title: 'T', ...over }) as Page;

describe('hasOwnSource', () => {
  it('is true for a full page carrying its own code', () => {
    expect(hasOwnSource(page({ source: '<h1>hi</h1>' }))).toBe(true);
  });

  it('is false for a full page with no code (an inherit-mode locale variant)', () => {
    expect(hasOwnSource(page({}))).toBe(false);
    expect(hasOwnSource(page({ source: '' }))).toBe(false);
  });

  it('★ is true for a SUMMARISED page whose omitted source had bytes', () => {
    const summary: PageSummary = {
      id: 'de-about',
      path: 'ueber-uns',
      title: 'Über uns',
      locale: 'de',
      _summary: { omitted: { source: { bytes: 512 } }, hint: 'body fields omitted from this LIST' },
    } as PageSummary;

    // The naive `!!summary.source` is `false` here — that is the bug this guards.
    expect((summary as { source?: string }).source).toBeUndefined();
    expect(hasOwnSource(summary)).toBe(true);
  });

  it('is false for a summarised page that genuinely has no source (no descriptor emitted)', () => {
    const summary: PageSummary = { id: 'de-home', path: 'de', title: 'Start', locale: 'de' } as PageSummary;
    expect(hasOwnSource(summary)).toBe(false);
  });

  it('is false when the descriptor reports an empty body', () => {
    const summary: PageSummary = {
      id: 'x',
      path: 'x',
      title: 'X',
      _summary: { omitted: { source: { bytes: 0 } } },
    } as PageSummary;
    expect(hasOwnSource(summary)).toBe(false);
  });
});
