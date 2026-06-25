// Extract a CorporateIdentity from a site's home document, and flat SEO from each page. Best-effort:
// every field is optional except `name`, which always resolves to something. Asset references prefer a
// self-hosted ref (from the asset map) and fall back to an absolute https hotlink.
import { CorporateIdentitySchema, detectSocial, type CorporateIdentity } from '@sitewright/schema';
import { allByName, type Document, type Element } from '../dom.js';
import { textContent } from 'domutils';
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

/** The first <title>'s leading segment (split on common separators). */
function titleName(doc: Document): string | undefined {
  const title = allByName(doc.children, 'title')[0];
  if (!title) return undefined;
  const text = textContent([title]).trim();
  if (!text) return undefined;
  return (text.split(/\s*[|–—\-:]\s*/)[0] ?? text).trim() || text;
}

function hostName(baseUrl: string): string {
  try {
    const h = new URL(baseUrl).hostname.replace(/^www\./, '');
    const label = h.split('.')[0] ?? h;
    return label ? label.charAt(0).toUpperCase() + label.slice(1) : h;
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
  for (const a of allByName(doc.children, 'a')) {
    const href = (a.attribs.href ?? '').trim();
    if (!href) continue;
    if (!phone && /^tel:/i.test(href)) { const p = decodeURIComponent(href.slice(4)).replace(/\s+/g, ' ').trim(); if (p) phone = p.slice(0, 60); continue; }
    if (!email && /^mailto:/i.test(href)) { const e = href.slice(7).split('?')[0]!.trim(); if (isEmail(e)) email = e; continue; }
    if (/^https:\/\//i.test(href)) {
      const det = detectSocial(href);
      // detectSocial falls back to icon 'globe' for UNKNOWN hosts — only KNOWN providers are real social.
      if (det.icon && det.icon !== 'globe') {
        const key = det.name ?? href;
        if (!seen.has(key) && social.length < 12) { seen.add(key); social.push({ link: href, ...det }); }
      }
    }
  }
  // A Google Maps EMBED iframe (a plain maps link can't be framed) → mapUrl, rendered as the footer map.
  for (const f of allByName(doc.children, 'iframe')) {
    const src = (f.attribs.src ?? '').trim();
    if (/^https:\/\//i.test(src) && MAP_EMBED_RE.test(src)) { mapUrl = src.slice(0, 2000); break; }
  }
  return { phone, email, social, mapUrl };
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

  const input: Record<string, unknown> = {
    name: name.slice(0, 200),
    description: meta.get('description')?.slice(0, 4000),
    slogan: meta.get('og:description')?.slice(0, 300),
    logo: assetRef(findLogo(homeDoc), ctx),
    icon: assetRef(findIcon(homeDoc), ctx),
    image: assetRef(meta.get('og:image'), ctx),
    email,
    telephone,
    address: ld.address, // postal address (JSON-LD PostalAddress) — schema AddressSchema
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
