/**
 * The PLATFORM's own robots.txt (a published site's robots.txt is the publisher's, see publish/seo.ts).
 *
 * The platform's hosts (the editor, its API, previews and share links, media) are kept out of search by
 * this `Disallow` and by `X-Robots-Tag: noindex` on every response.
 *
 * ★ `/sites/` is ALWAYS allowed, whatever the admin's `sitesDomainNoindex` switch says. With the switch
 * off, the path form is a hosted site's address (with no sites domain) or a 301 to it (with one), which a
 * crawler must fetch to follow. With the switch on, those pages answer noindex, and a crawler that may not
 * fetch a page never SEES its noindex: a URL it already knows, or finds linked elsewhere, would linger as a
 * bare listing instead of dropping out. The longest matching rule wins in every major crawler (RFC 9309
 * §2.2.2), so `Allow: /sites/` beats `Disallow: /` for exactly that prefix.
 */
export const PLATFORM_ROBOTS_TXT = 'User-agent: *\nAllow: /sites/\nDisallow: /\n';
