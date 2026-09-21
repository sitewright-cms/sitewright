// The draft build renders exactly the pages a PUBLISHED build would, so a `draft` page has no route on
// the whole-site preview surface. Without this it answered the only way a missing file can — a bare 404
// with an empty body, which is indistinguishable from a broken build, a stale build, or a typo'd URL.
// An author who marked a page `draft` and then opened it in the preview pane would read that blank as
// "the preview is broken", which is precisely the silent-wrong-answer class the draft build exists to
// avoid elsewhere (see `previewErrorPage` in publish/build.ts).
//
// So the route asks HERE whether the path it could not serve belongs to a draft, and if it does, says so
// and names the way to see the page anyway.
import { escapeHtml } from '@sitewright/blocks';
import { pagePath, pagesById } from '@sitewright/core';
import type { Page } from '@sitewright/schema';

/** Strip both ends so a request path (`secret`, `/secret/`) compares against a route (`/secret/`). */
const normalize = (value: string): string => value.replace(/^\/+/, '').replace(/\/+$/, '');

/**
 * The DRAFT page owning `path`, if one does — i.e. the page that WOULD be served here had it been
 * published. `undefined` for any other miss (a real 404), so the caller keeps its empty-body answer
 * for paths that are simply not part of this site.
 */
export function draftPageForPath(pages: readonly Page[], path: string): Page | undefined {
  const wanted = normalize(path);
  const byId = pagesById(pages);
  return pages.find((page) => page.status === 'draft' && normalize(pagePath(page, byId)) === wanted);
}

/**
 * The document served in place of a draft page. Self-contained and inert — no styles, scripts or assets
 * from the site, which is not built for this route at all — and it renders inside the editor's sandboxed
 * iframe as readily as in a tab.
 */
export function draftPageNotice(page: Page): string {
  const title = escapeHtml(page.title);
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>Draft — ${title}</title>` +
    '<style>' +
    'body{margin:0;padding:48px 24px;font:16px/1.6 system-ui,sans-serif;color:#1e293b;background:#f8fafc}' +
    'main{max-width:44rem;margin:0 auto}' +
    'h1{margin:0 0 8px;font-size:22px}' +
    'p{margin:0 0 16px;color:#475569}' +
    'code{background:#e2e8f0;border-radius:4px;padding:1px 5px;font-size:14px}' +
    'div{background:#fff;border:1px solid #e2e8f0;border-left:4px solid #d97706;border-radius:8px;padding:14px 16px}' +
    '</style></head><body><main>' +
    `<h1>“${title}” is a draft</h1>` +
    '<div><p>This preview browses the site as it would be published, and a draft page is not part of it — ' +
    'no route, no menu entry, no search result. Marking the page <code>published</code> puts it here.</p>' +
    '<p>To see the page as it stands now, open it in the editor and use <strong>Preview</strong> ' +
    '(or <strong>Live preview</strong>), which renders any page whatever its status.</p></div>' +
    '</main></body></html>'
  );
}
