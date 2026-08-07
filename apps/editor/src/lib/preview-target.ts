/**
 * The always-on whole-site PREVIEW surface is addressed by a `?preview=projectId[/route]` query
 * param so it opens in its own tab. Unlike `?live=` (a single page's preview), this browses the
 * project's CURRENT saved content as a real, navigable site — drafts included, no publish required —
 * and auto-reloads / auto-navigates on any change. `path` is the route to open first ('' = home).
 */
export interface PreviewTarget {
  projectId: string;
  path: string;
}

/** Parses `?preview=projectId[/route/segments]`; returns null when absent or malformed. */
export function parsePreviewTarget(search: string): PreviewTarget | null {
  const value = new URLSearchParams(search).get('preview');
  if (!value) return null;
  const slash = value.indexOf('/');
  const projectId = slash === -1 ? value : value.slice(0, slash);
  if (!projectId) return null;
  const path = slash === -1 ? '' : value.slice(slash + 1);
  return { projectId, path };
}

/** The minimum a page contributes to a route — its own segment and who it hangs under. */
export interface RouteNode {
  id: string;
  path: string;
  parent?: string | undefined;
}

/**
 * A page's FULL route (`{ancestor slugs}/{own slug}`), walking the parent chain.
 *
 * A page's `path` is only its LAST segment — publish composes the served route from the whole chain
 * (`{root}/{parent slugs}/{slug}`). Handing a bare segment to the preview therefore addressed a route
 * that does not exist for any nested page, so "open this page in a new tab" opened the preview but
 * could not land on the page. `own` is passed separately from `pages` so UNSAVED edits to the current
 * page's path/parent are honoured. Empty segments (the home page) drop out; the walk is bounded and
 * cycle-safe, since `parent` is author-editable data.
 */
export function fullRouteFor(own: { path: string; parent?: string | undefined }, pages: readonly RouteNode[]): string {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const segments = [own.path];
  const seen = new Set<string>();
  let cursor = own.parent;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const node = byId.get(cursor);
    if (!node) break;
    segments.unshift(node.path);
    cursor = node.parent;
  }
  return segments
    .map((s) => s.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
}

/**
 * Builds the `?preview=…` URL (preserving the current origin + path) to open the preview tab.
 * `route` (optional) opens the preview ON that page instead of the home page — the parser splits the
 * value at its FIRST slash, so the id is encoded whole and each route segment separately, leaving the
 * separators intact.
 */
export function buildPreviewUrl(origin: string, pathname: string, projectId: string, route = ''): string {
  const clean = route.replace(/^\/+|\/+$/g, '');
  const suffix = clean ? `/${clean.split('/').map(encodeURIComponent).join('/')}` : '';
  return `${origin}${pathname}?preview=${encodeURIComponent(projectId)}${suffix}`;
}
