/**
 * Google's own links among a results page's results, as the scraping providers pass them on (Apify, Bright Data).
 *
 * - A link to Google Search or Maps itself — the "Map" entry of a local search, a related search — is no site's
 *   result, and is not counted ({@link isGoogleSearchLink}).
 * - A RESULT whose link Google wrapped in its own redirect is a site's result all the same: `/url?q=<address>`, or
 *   `/goto?url=<opaque>`. Measured 2026-11-17 on Bright Data: some requests had every organic result of a page wrapped
 *   in `/goto`, which names the site nowhere but in the displayed address. Read as it came, the site would never be
 *   found ({@link resultUrl}). Its page is asked of Google for the site's own result ({@link opaqueRedirect}).
 */

const GOOGLE_HOST_RE = /^(www\.|maps\.)?google(\.[a-z]{2,3}){1,2}$/i;
/** The hosts searches are sent to (`www.google.com`): a redirect on any other is not asked. */
const GOOGLE_SEARCH_HOSTS = new Set(['www.google.com', 'google.com']);
const WEB_URL_RE = /^https?:\/\//i;

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * A link to Google Search or Maps itself: no site's result. Google's own sites (support.google.com and the like) are
 * real results for some searches, and are counted.
 */
export function isGoogleSearchLink(url: string): boolean {
  const u = parse(url);
  if (!u || !GOOGLE_HOST_RE.test(u.hostname)) return false;
  return u.hostname.toLowerCase().startsWith('maps.') || /^\/(search|maps)(\/|$)/.test(u.pathname);
}

/**
 * The displayed address as a URL: what comes before Google's breadcrumb ("https://site.na › services › web-de…"), with
 * `https://` when Google left the scheme off. A breadcrumb stands for a path cut short, so only the site is kept then.
 */
function displayedUrl(displayed: string): string | null {
  const [head = '', ...crumbs] = displayed.split('›');
  const cut = /(\.\.\.|…)$/.test(head.trim());
  const text = head.trim().replace(/(\.\.\.|…)$/, '');
  if (!text) return null;
  const withScheme = WEB_URL_RE.test(text) ? text : `https://${text}`;
  // Cut short inside the host itself ("https://www.some-long-domain-na…"): the host is not the site's.
  if (cut && !/^https?:\/\/[^/]+\//i.test(withScheme)) return null;
  const u = parse(withScheme);
  if (!u || !u.hostname.includes('.') || u.username || GOOGLE_HOST_RE.test(u.hostname)) return null;
  return crumbs.length > 0 || cut ? `${u.origin}/` : u.href;
}

/**
 * The address a result links to, given its link and, when the provider has it, its displayed address. A link that is
 * not Google's comes back as it is; Google's `/url?q=` redirect gives the address it wraps; anything else of Google's
 * (`/goto`, whose target is opaque) gives the displayed address. Null when the result names no site at all.
 */
export function resultUrl(link: string, displayed?: string): string | null {
  const u = parse(link);
  if (!u || !GOOGLE_HOST_RE.test(u.hostname)) return link;
  if (u.pathname === '/url') {
    const target = u.searchParams.get('q') ?? u.searchParams.get('url');
    if (target && WEB_URL_RE.test(target) && parse(target)) return target;
  }
  return displayed ? displayedUrl(displayed) : null;
}

/**
 * Google's `/goto` redirect, which names its page nowhere: the displayed address gives the site, and its breadcrumb
 * the site's own labels ("phoenix-tech.net › ... › E-Learning"), not the path. Google answers the link itself with a
 * redirect to the page (measured 2026-11-20: 302 in under a second, whatever the user agent), which the tracker asks
 * for the site's own result (`../resolve-link.ts`). The link, when it is one; undefined otherwise.
 */
export function opaqueRedirect(link: string): string | undefined {
  const u = parse(link);
  if (!u || u.protocol !== 'https:' || u.port || u.username || u.password) return undefined;
  return GOOGLE_SEARCH_HOSTS.has(u.hostname.toLowerCase()) && u.pathname === '/goto' ? link : undefined;
}
