/**
 * The "pop-out live preview" surface is addressed by a `?live=org/project/page`
 * query param so it can be opened in its own window/tab (it renders SAVED content
 * and auto-reloads on any change, rather than the editor's local draft).
 */
export interface LiveTarget {
  orgId: string;
  projectId: string;
  pageId: string;
}

/** Parses `?live=orgId/projectId/pageId`; returns null when absent or malformed. */
export function parseLiveTarget(search: string): LiveTarget | null {
  const value = new URLSearchParams(search).get('live');
  if (!value) return null;
  const parts = value.split('/');
  if (parts.length !== 3) return null;
  const [orgId, projectId, pageId] = parts;
  if (!orgId || !projectId || !pageId) return null;
  return { orgId, projectId, pageId };
}

/** Builds the `?live=…` URL for a page, preserving the current origin + path. */
export function buildLiveUrl(origin: string, pathname: string, target: LiveTarget): string {
  const value = `${target.orgId}/${target.projectId}/${target.pageId}`;
  return `${origin}${pathname}?live=${encodeURIComponent(value)}`;
}
