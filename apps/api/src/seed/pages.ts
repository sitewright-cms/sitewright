import type { Page } from '@sitewright/schema';
import { pagesEn, pagesEnContentOnly } from './pages-en.js';
import { pagesDe } from './pages-de.js';

// ---------------------------------------------------------------- pages
export function examplePages(assetMap: Record<string, string>): Page[] {
  // Missing keys → '' so an unreferenced image never renders as `src="undefined"`.
  const assets = new Proxy(assetMap, {
    // Named string keys → the URL or '' (so a missing image is never the literal "undefined");
    // symbol keys (coercion/inspection) pass straight through to the target.
    get: (t, k) => (typeof k === 'symbol' ? Reflect.get(t, k) : k in t ? Reflect.get(t, k) : ''),
  }) as Record<string, string>;
  return [...pagesEn(assets), ...pagesDe(assets), ...pagesEnContentOnly(assets)];
}
