/**
 * The robots.txt files the PLATFORM answers itself (a published site's own robots.txt is the
 * publisher's, see publish/seo.ts).
 *
 * ★ Search engines are kept off the platform by BOTH a `Disallow` here and `X-Robots-Tag: noindex` on
 * every response (the admin asked for both). The trade-off is known: a crawler that may not fetch a page
 * never sees its noindex, so a URL already indexed, or linked from elsewhere, can linger as a bare entry
 * until it is removed by hand (Search Console → Removals).
 */

/** Shuts every crawler out: the platform's own hosts, and a site's platform address when hidden. */
export const DISALLOW_ALL_ROBOTS_TXT = 'User-agent: *\nDisallow: /\n';

/**
 * robots.txt for the platform's own hosts (the editor, its API, previews and share links, media).
 *
 * `sitesIndexable` keeps the `/sites/` path form crawlable. Without a sites domain that path IS a hosted
 * site's address; with one, it only 301s to the site's real host, and a crawler must fetch it to follow
 * the redirect. The longest matching rule wins in every major crawler, so `Allow: /sites/` beats
 * `Disallow: /` for exactly that prefix.
 */
export function platformRobotsTxt(sitesIndexable: boolean): string {
  return sitesIndexable ? 'User-agent: *\nAllow: /sites/\nDisallow: /\n' : DISALLOW_ALL_ROBOTS_TXT;
}
