// Allowlist of trusted third-party EMBED providers. An imported `<iframe>` is kept only if its host
// matches one of these domains (exact host or any subdomain); every other iframe is dropped, so the
// rebuilt site never carries an arbitrary foreign frame. Covers the common real-world embeds: video,
// maps, social (incl. Facebook page plugins), audio/podcasts, forms/scheduling, code, commerce, docs
// & data-viz. Add a base domain here to support a new provider (subdomains are matched automatically,
// e.g. `player.vimeo.com` ⊂ `vimeo.com`, `www.facebook.com` ⊂ `facebook.com`, `docs.google.com` ⊂
// `google.com`).
export const EMBED_HOSTS: readonly string[] = [
  // ── video ──
  'youtube.com', 'youtube-nocookie.com', 'youtu.be', 'vimeo.com', 'dailymotion.com', 'wistia.com',
  'wistia.net', 'loom.com', 'twitch.tv', 'brightcove.net', 'vidyard.com', 'streamable.com', 'ted.com',
  'bilibili.com', 'rumble.com', 'kaltura.com', 'jwplayer.com', 'cloudflarestream.com',
  // ── maps ──
  'google.com', 'openstreetmap.org', 'mapbox.com', 'bing.com', 'waze.com', 'arcgis.com', 'here.com',
  // ── social ──
  'facebook.com', 'fb.com', 'instagram.com', 'twitter.com', 'x.com', 'linkedin.com', 'tiktok.com',
  'pinterest.com', 'reddit.com', 'threads.net', 'snapchat.com', 'tumblr.com', 'mastodon.social',
  // ── audio / podcasts ──
  'spotify.com', 'soundcloud.com', 'anchor.fm', 'podbean.com', 'mixcloud.com', 'bandcamp.com',
  'audiomack.com', 'buzzsprout.com', 'transistor.fm',
  // ── forms / scheduling / surveys ──
  'calendly.com', 'typeform.com', 'airtable.com', 'notion.so', 'notion.site', 'jotform.com', 'cal.com',
  'acuityscheduling.com', 'surveymonkey.com', 'hsforms.com', 'hsforms.net', 'wufoo.com', 'formstack.com',
  // ── code / docs / data-viz ──
  'codepen.io', 'codesandbox.io', 'jsfiddle.net', 'stackblitz.com', 'replit.com', 'observablehq.com',
  'glitch.me', 'github.com', 'gist.github.com', 'figma.com', 'canva.com', 'slideshare.net', 'scribd.com',
  'issuu.com', 'flourish.studio', 'datawrapper.de', 'dwcdn.net', 'tableau.com', 'powerbi.com', 'giphy.com',
  // ── commerce / events / reviews ──
  'gumroad.com', 'eventbrite.com', 'opentable.com', 'shopify.com', 'stripe.com', 'paypal.com',
  'square.site', 'trustpilot.com', 'tripadvisor.com',
];

/** Is `absUrl` an https iframe from an allowlisted embed provider? (exact host or a subdomain). */
export function isAllowedEmbed(absUrl: string): boolean {
  let host: string;
  try {
    const u = new URL(absUrl);
    if (u.protocol !== 'https:') return false;
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  return EMBED_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}
