/**
 * Where a LOCALLY-HOSTED site actually serves — the mirror of the API's `servedSiteUrl`.
 *
 * With a sites domain configured the site runs on its own isolated `<slug>.<sitesDomain>` origin and
 * `/sites/<slug>/` merely 301-redirects there, so that is the address to advertise. With no sites
 * domain the path form is the real one. The deploy UI used to hardcode `/sites/…` in three places,
 * which named a URL the author never sees in the address bar on any instance with subdomains on.
 *
 * `loc` is injectable so this is testable without a DOM.
 */
export function localSiteUrl(
  slug: string,
  sitesDomain?: string,
  loc: { protocol: string; port: string } = window.location,
): string {
  if (!sitesDomain) return `/sites/${slug}/`;
  return `${loc.protocol}//${slug}.${sitesDomain}${loc.port ? `:${loc.port}` : ''}/`;
}

/** The same thing as a short label for a dropdown row: the host alone, or the path form. */
export function localSiteLabel(slug: string, sitesDomain?: string): string {
  return sitesDomain ? `${slug}.${sitesDomain}` : `/sites/${slug}/`;
}
