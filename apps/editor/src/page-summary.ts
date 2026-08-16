import type { Page } from '@sitewright/schema';

/**
 * One row of the SUMMARISED content list: every light field verbatim, with the heavy body fields
 * (`source`, `data`) omitted and described under `_summary.omitted` instead.
 *
 * ★ A summary is NOT a page. Writing one back would delete the very fields it omits, so it is only ever
 * a list row — anything that needs a body calls `getPage` first.
 *
 * Lives outside `api.ts` deliberately: {@link hasOwnSource} is a pure predicate that tests should run for
 * real, and every screen test mocks the api module wholesale.
 */
export type PageSummary = Omit<Page, 'source' | 'data'> & {
  source?: never;
  data?: never;
  _summary?: { omitted?: { source?: { bytes: number }; data?: { keys: string[] } }; hint?: string };
  /** Signed draft-preview URL for this page (added by the list route, not stored on the page). */
  previewUrl?: string;
};

/**
 * Does this page carry its OWN Handlebars code (as opposed to inheriting a template or its locale
 * owner's layout)?
 *
 * ★ Reads the summary descriptor when the body was omitted. The naive `!!p.source` is correct only on a
 * FULL page: against a summarised list every page reads as source-less, which would (a) classify FORKED
 * locale variants as inherit-mode followers — the very list `removePage` cascade-deletes — and (b) make
 * "save as template" a silent no-op.
 */
export function hasOwnSource(p: Page | PageSummary): boolean {
  const source = (p as Page).source;
  if (source !== undefined) return Boolean(source);
  return ((p as PageSummary)._summary?.omitted?.source?.bytes ?? 0) > 0;
}
