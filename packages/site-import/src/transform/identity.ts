// Extract a CorporateIdentity from a site's home document, and flat SEO from each page. Best-effort:
// every field is optional except `name`, which always resolves to something. Asset references prefer a
// self-hosted ref (from the asset map) and fall back to an absolute https hotlink.
import { CorporateIdentitySchema, detectSocial, type CorporateIdentity } from '@sitewright/schema';
import { allByName, type Document, type Element } from '../dom.js';
import { textContent, findAll } from 'domutils';
import { assetKey, resolveUrl } from '../url-util.js';

export interface IdentityCtx {
  baseUrl: string;
  assetMap: ReadonlyMap<string, string>;
  fallbackName: string;
}

/** Resolve a raw URL to a hostable AssetRef: a self-hosted ref if available, else an absolute https URL. */
function assetRef(raw: string | undefined, ctx: { baseUrl: string; assetMap: ReadonlyMap<string, string> }): string | undefined {
  if (!raw) return undefined;
  const key = assetKey(raw, ctx.baseUrl);
  if (key && ctx.assetMap.has(key)) return ctx.assetMap.get(key);
  const abs = resolveUrl(raw, ctx.baseUrl);
  return abs && /^https:\/\//i.test(abs) ? abs : undefined;
}

/** A lowercased `name|property` → content map of all <meta> tags. */
function metaMap(doc: Document): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of allByName(doc.children, 'meta')) {
    const key = (m.attribs.property ?? m.attribs.name ?? '').toLowerCase();
    const content = m.attribs.content;
    if (key && content && !map.has(key)) map.set(key, content);
  }
  return map;
}

/** The first <title>'s leading segment (split on common separators). Returns undefined for a GENERIC
 *  page title ("Home", "Homepage", "Welcome", …) — that's a page label, not the brand name, so `name`
 *  should fall through to the next source rather than mislabel the whole site. */
function titleName(doc: Document): string | undefined {
  const title = allByName(doc.children, 'title')[0];
  if (!title) return undefined;
  const text = textContent([title]).trim();
  if (!text) return undefined;
  const lead = (text.split(/\s*[|–—\-:]\s*/)[0] ?? text).trim() || text;
  if (/^(?:home|homepage|welcome|index|untitled|start|startseite|inicio|accueil)$/i.test(lead)) return undefined;
  return lead;
}

function hostName(baseUrl: string): string {
  try {
    const h = new URL(baseUrl).hostname.replace(/^www\./, '');
    const label = h.split('.')[0] ?? h;
    // Title-case each hyphen-separated word so a multi-word domain reads as a brand (etaxi-worldwide → "Etaxi Worldwide").
    return label.split('-').map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ').trim() || h;
  } catch {
    return 'Website';
  }
}

/** A logo image: the first <img> whose alt/class/src/id hints at a logo (header-ish), else the first image. */
function findLogo(doc: Document): string | undefined {
  const imgs = allByName(doc.children, 'img');
  const hinted = imgs.find((img) => /logo|brand/i.test(`${img.attribs.alt ?? ''} ${img.attribs.class ?? ''} ${img.attribs.id ?? ''} ${img.attribs.src ?? ''}`));
  return (hinted ?? imgs[0])?.attribs.src;
}

/** A favicon/icon href: prefer a rel containing "icon". */
function findIcon(doc: Document): string | undefined {
  const links = allByName(doc.children, 'link');
  const icon = links.find((l) => /\bicon\b/i.test(l.attribs.rel ?? '')); // icon / shortcut icon / apple-touch-icon
  return icon?.attribs.href;
}

interface LdAddress { street?: string; locality?: string; region?: string; country?: string; postalCode?: string }
interface JsonLdOrg {
  email?: string;
  telephone?: string;
  sameAs?: string[];
  type?: string;
  address?: LdAddress;
  geo?: { latitude: string; longitude: string };
}

/** A JSON-LD value that's a string OR a typed object with a `name` (e.g. addressCountry: {name}). */
function ldStr(v: unknown): string | undefined {
  if (typeof v === 'string') return v.trim() || undefined;
  if (v && typeof v === 'object') { const n = (v as Record<string, unknown>).name; if (typeof n === 'string') return n.trim() || undefined; }
  return undefined;
}
/** A JSON-LD number (number or numeric string) → its string form (GeoSchema stores lat/long as strings). */
function ldNum(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'string' && /^-?\d+(?:\.\d+)?$/.test(v.trim())) return v.trim();
  return undefined;
}

/** Pull Organization-ish fields (incl. postal address + geo) from JSON-LD `application/ld+json` blocks. */
function parseJsonLd(doc: Document): JsonLdOrg {
  const out: JsonLdOrg = {};
  for (const script of allByName(doc.children, 'script')) {
    if ((script.attribs.type ?? '').toLowerCase() !== 'application/ld+json') continue;
    let data: unknown;
    try {
      data = JSON.parse(textContent([script]));
    } catch {
      continue;
    }
    for (const node of flattenLd(data)) {
      const type = String((node['@type'] ?? '') as string);
      if (!/Organization|LocalBusiness|WebSite/i.test(type)) continue;
      if (!out.type && /Organization|LocalBusiness/i.test(type)) out.type = type;
      if (!out.email && typeof node.email === 'string') out.email = node.email;
      if (!out.telephone && typeof node.telephone === 'string') out.telephone = node.telephone;
      const sameAs = node.sameAs;
      if (!out.sameAs && Array.isArray(sameAs)) out.sameAs = sameAs.filter((s): s is string => typeof s === 'string');
      if (!out.address && node.address) {
        const a = (Array.isArray(node.address) ? node.address[0] : node.address) as Record<string, unknown> | undefined;
        if (a && typeof a === 'object') {
          const addr: LdAddress = { street: ldStr(a.streetAddress), locality: ldStr(a.addressLocality), region: ldStr(a.addressRegion), country: ldStr(a.addressCountry), postalCode: ldStr(a.postalCode) };
          if (Object.values(addr).some((x) => x !== undefined)) out.address = addr;
        }
      }
      if (!out.geo && node.geo && typeof node.geo === 'object') {
        const g = node.geo as Record<string, unknown>;
        const lat = ldNum(g.latitude), lon = ldNum(g.longitude);
        if (lat !== undefined && lon !== undefined) out.geo = { latitude: lat, longitude: lon };
      }
    }
  }
  return out;
}

const MAP_EMBED_RE = /google\.[a-z.]+\/maps\/embed|maps\.google\.[a-z.]+\/.*embed|\/maps\/embed/i;

/** Scan the home DOM for contact signals JSON-LD often omits: tel:/mailto:, footer social links, a map. */
function scanContacts(doc: Document): { phone?: string; email?: string; social: { link: string; name?: string; icon?: string }[]; mapUrl?: string } {
  let phone: string | undefined, email: string | undefined, mapUrl: string | undefined;
  const social: { link: string; name?: string; icon?: string }[] = [];
  const seen = new Set<string>();
  const addSocial = (url: string): void => {
    if (!/^https?:\/\//i.test(url)) return;
    const det = detectSocial(url);
    // detectSocial falls back to icon 'globe' for UNKNOWN hosts — only KNOWN providers are real social.
    if (!det.icon || det.icon === 'globe') return;
    const key = det.name ?? url;
    if (!seen.has(key) && social.length < 12) { seen.add(key); social.push({ link: url, ...det }); }
  };
  for (const a of allByName(doc.children, 'a')) {
    const href = (a.attribs.href ?? '').trim();
    if (!href) continue;
    if (!phone && /^tel:/i.test(href)) { const p = decodeURIComponent(href.slice(4)).replace(/\s+/g, ' ').trim(); if (p) phone = p.slice(0, 60); continue; }
    if (!email && /^mailto:/i.test(href)) { const e = href.slice(7).split('?')[0]!.trim(); if (isEmail(e)) email = e; continue; }
    if (/^https:\/\//i.test(href)) addSocial(href);
  }
  // Iframes (incl. LAZY ones whose real URL is in data-src): a Google Maps EMBED → mapUrl; a Facebook/X
  // page-plugin → the embedded profile URL becomes a social link (a common "no <a> social" pattern).
  for (const f of allByName(doc.children, 'iframe')) {
    const src = (f.attribs.src || f.attribs['data-src'] || f.attribs['data-lazy-src'] || f.attribs['data-original'] || '').trim();
    if (!/^https:\/\//i.test(src)) continue;
    if (!mapUrl && MAP_EMBED_RE.test(src)) mapUrl = src.slice(0, 2000);
    const plugin = src.match(/(?:facebook|twitter|x)\.com\/plugins\/[^?]*\?[^"']*\bhref=([^&"']+)/i);
    if (plugin) { try { addSocial(decodeURIComponent(plugin[1]!)); } catch { /* malformed href param */ } }
  }
  return { phone, email, social, mapUrl };
}

const ADDR_ICON = /\b(?:fa-)?(?:map-marker(?:-alt)?|map-pin|location(?:-dot|-arrow)?|geo-alt|geo)\b|\bfa-home\b|\bbi-geo(?:-alt)?(?:-fill)?\b/i;
const STREET_HINT = /\b(?:street|str\.?|st\.|stra(?:ss|ß)e|avenue|ave\.?|road|rd\.?|lane|ln\.?|drive|dr\.?|boulevard|blvd\.?|suite|floor|p\.?\s?o\.?\s?box|postbus|corner|rue|calle|plaza|highway|hwy)\b/i;

/** Does `t` read like a postal-address line (not a phone/url/single word)? Conservative, to avoid junk. */
function isAddressLike(t: string): boolean {
  if (t.length < 8 || t.length > 200 || /@/.test(t) || /^(?:https?:|tel:|mailto:|www\.)/i.test(t)) return false;
  return /,/.test(t) || STREET_HINT.test(t) || t.split(/\s+/).length >= 4;
}

/** Split a free-text address into street (+ a short trailing ", City" as locality when present). */
function parseAddress(text: string): LdAddress {
  const parts = text.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1]!;
    if (last.split(/\s+/).length <= 3 && !STREET_HINT.test(last)) {
      return { street: parts.slice(0, -1).join(', ').slice(0, 300), locality: last.slice(0, 160) };
    }
  }
  return { street: text.slice(0, 300) };
}

/**
 * A postal address from the home DOM (what JSON-LD usually omits): schema.org microdata → an `<address>`
 * element → the text next to a location/home/map icon (the common footer pattern, e.g. burmeister's
 * `<i class="fa fa-home"><span>Corner of … Suiderhof</span>`). Conservative — `isAddressLike` rejects nav
 * "Home" links and the like so junk never lands in the CI.
 */
function extractAddress(doc: Document): LdAddress | undefined {
  const els = findAll(() => true, doc.children) as Element[];
  const prop = (p: string): string | undefined => {
    const el = els.find((e) => (e.attribs.itemprop ?? '') === p);
    return el ? (textContent([el]).replace(/\s+/g, ' ').trim() || undefined) : undefined;
  };
  const md: LdAddress = { street: prop('streetAddress'), locality: prop('addressLocality'), region: prop('addressRegion'), country: prop('addressCountry'), postalCode: prop('postalCode') };
  if (Object.values(md).some((x) => x !== undefined)) return md;
  const addrEl = allByName(doc.children, 'address')[0];
  if (addrEl) { const t = textContent([addrEl]).replace(/\s+/g, ' ').trim(); if (isAddressLike(t)) return parseAddress(t); }
  for (const el of els) {
    if (!ADDR_ICON.test(el.attribs.class ?? '')) continue;
    const parent = el.parent as Element | null;
    if (!parent || !parent.attribs) continue;
    const t = textContent([parent]).replace(/\s+/g, ' ').trim();
    if (isAddressLike(t)) return parseAddress(t);
  }
  return undefined;
}

function flattenLd(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.flatMap(flattenLd);
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const graph = obj['@graph'];
    if (Array.isArray(graph)) return graph.flatMap(flattenLd);
    return [obj];
  }
  return [];
}

/** Validate a string is a usable CSS color for a brand token (reuses the schema regex indirectly). */
function cssColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  return /^#[0-9a-fA-F]{3,8}$|^(?:rgb|hsl)a?\([0-9\s%,./deg-]+\)$/.test(v) ? v : undefined;
}

/** A SHORT brand tagline for the nav/CI slogan: a `.slogan`/`.tagline`/`.subtitle` element's text with a
 *  leading company name (+ legal suffix) stripped, else a short og:description. NOT the long meta
 *  description (which belongs in `description`). */
function extractSlogan(doc: Document, meta: Map<string, string>, name: string): string | undefined {
  const el = findAll((n) => /\b(?:slogan|tagline|sub-?title|motto)\b/i.test(`${(n as Element).attribs?.class ?? ''} ${(n as Element).attribs?.id ?? ''}`), doc.children)[0] as Element | undefined;
  let s = el ? textContent([el]).replace(/\s+/g, ' ').trim() : '';
  if (s && name) { const re = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?:\\(?(?:pty|ltd|limited|inc|llc|gmbh|co)\\)?[.\\s]*)*`, 'i'); s = s.replace(re, '').trim(); }
  if (s.length >= 3 && s.length <= 90) return s;
  const og = meta.get('og:description');
  return og && og.length <= 90 ? og : undefined; // a long meta description is NOT a slogan
}

/** Build a CorporateIdentity from the home document. Parsed through the schema so it's always valid. */
export function extractIdentity(homeDoc: Document, ctx: IdentityCtx): CorporateIdentity {
  const meta = metaMap(homeDoc);
  const name = meta.get('og:site_name') ?? meta.get('application-name') ?? titleName(homeDoc) ?? hostName(ctx.baseUrl) ?? ctx.fallbackName;
  const ld = parseJsonLd(homeDoc);
  const dom = scanContacts(homeDoc); // tel:/mailto:/social/map signals JSON-LD usually lacks
  const primary = cssColor(meta.get('theme-color'));

  // JSON-LD sameAs is the cleanest social source; fall back to scanned footer links when it's absent.
  const ldSocial = (ld.sameAs ?? [])
    .filter((url) => /^https?:\/\//i.test(url))
    .slice(0, 50)
    .map((url) => ({ link: url, ...detectSocial(url) }));
  const social = ldSocial.length > 0 ? ldSocial : dom.social;
  const email = isEmail(ld.email) ? ld.email : isEmail(dom.email) ? dom.email : undefined;
  const telephone = (ld.telephone ?? dom.phone)?.slice(0, 60);
  const address = ld.address ?? extractAddress(homeDoc); // JSON-LD wins; else scan the DOM (microdata/<address>/icon)

  const input: Record<string, unknown> = {
    name: name.slice(0, 200),
    description: meta.get('description')?.slice(0, 4000),
    slogan: extractSlogan(homeDoc, meta, name),
    logo: assetRef(findLogo(homeDoc), ctx),
    icon: assetRef(findIcon(homeDoc), ctx),
    image: assetRef(meta.get('og:image'), ctx),
    email,
    telephone,
    address, // postal address: JSON-LD PostalAddress, else scanned from the DOM — schema AddressSchema
    geo: ld.geo,
    mapUrl: dom.mapUrl,
    social: social.length > 0 ? social : undefined,
    ...(primary ? { colors: { primary } } : {}),
  };
  // Drop undefined so the schema's optionals stay absent.
  // eslint-disable-next-line security/detect-object-injection -- `k` iterates our own freshly-built object's keys
  for (const k of Object.keys(input)) if (input[k] === undefined) delete input[k];
  return CorporateIdentitySchema.parse(input);
}

function isEmail(v: string | undefined): v is string {
  return typeof v === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) && v.length <= 320;
}

export interface PageSeo {
  title?: string;
  description?: string;
  image?: string;
  canonical?: string;
  noindex?: boolean;
}

/** Flat per-page SEO from a page document. */
export function extractPageSeo(doc: Document, ctx: { baseUrl: string; assetMap: ReadonlyMap<string, string> }): PageSeo {
  const meta = metaMap(doc);
  const titleEl = allByName(doc.children, 'title')[0];
  const seo: PageSeo = {};
  const title = titleEl ? textContent([titleEl]).trim() : '';
  if (title) seo.title = title.slice(0, 300);
  const description = meta.get('description');
  if (description) seo.description = description.slice(0, 1000);
  const image = assetRef(meta.get('og:image'), ctx);
  if (image) seo.image = image;
  const canonical = canonicalHref(doc);
  if (canonical) seo.canonical = canonical;
  if (/\bnoindex\b/i.test(meta.get('robots') ?? '')) seo.noindex = true;
  return seo;
}

function canonicalHref(doc: Document): string | undefined {
  const link: Element | undefined = allByName(doc.children, 'link').find((l) => /(^|\s)canonical($|\s)/i.test(l.attribs.rel ?? ''));
  const href = link?.attribs.href;
  return href && /^https:\/\//i.test(href) ? href : undefined;
}
