/**
 * An address from OUTSIDE data (a search engine's page URL, a ranking result) as a link target: an absolute http(s)
 * URL, resolved against `base` when it is relative. Anything else (`javascript:`, `data:`, a malformed string) is no
 * link at all, because an `href` runs what its scheme says, and this text is not ours.
 */
export function httpHref(url: string, base?: string): string | null {
  // An absolute address stands on its own, so a base that is not a URL (a Search Console domain property is
  // `sc-domain:example.com`) only stops RELATIVE addresses from linking.
  const parsed = parse(url) ?? (base ? parse(url, base) : null);
  return parsed && (parsed.protocol === 'http:' || parsed.protocol === 'https:') ? parsed.href : null;
}

function parse(url: string, base?: string): URL | null {
  try {
    return new URL(url, base);
  } catch {
    return null;
  }
}
