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
