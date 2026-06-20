import type { Page } from '@sitewright/schema';

/**
 * A page is a RAW-FIDELITY replica when it still carries the importer's `swImport` marker AND has not
 * been nativized yet (`rewritten === false`). Such pages render WITHOUT the platform's own base CSS
 * (renderDocument `rawFidelity`) so the imported site's stylesheet renders exactly as on the original.
 * Once a page is nativized (the agent/user sets `rewritten: true`, or removes the marker), it returns
 * to normal platform rendering. Pure + dependency-free so both publish and preview share one rule.
 */
export function isRawFidelityPage(page: Pick<Page, 'data'>): boolean {
  const sw = (page.data as { swImport?: { rewritten?: boolean } } | undefined)?.swImport;
  return !!sw && sw.rewritten === false;
}
