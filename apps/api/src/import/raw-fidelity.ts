import type { Page } from '@sitewright/schema';

/**
 * A page is an UN-NATIVIZED IMPORT when it still carries the importer's `swImport` marker AND has not
 * been nativized yet (`rewritten === false`) — the (dormant) nativize step filters on this to find pages
 * to convert. NOTE: this no longer drives RENDERING. Whether a page renders free-form (no platform CSS/JS)
 * is now the explicit `page.rawHtml` setting — set by a LITERAL import (which keeps the foreign CSS) and
 * NOT by a foundation import (which discards it, so imported pages render native + styled at once).
 */
export function isUnnativizedImport(page: Pick<Page, 'data'>): boolean {
  const sw = (page.data as { swImport?: { rewritten?: boolean } } | undefined)?.swImport;
  return !!sw && sw.rewritten === false;
}
