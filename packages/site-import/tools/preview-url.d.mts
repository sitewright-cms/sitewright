/** Join a signed preview `base` (ends in '/') + a page `route` into an absolute clone URL, never doubling slashes. */
export function cloneUrlFor(origin: string, base: string, route: string): string;
