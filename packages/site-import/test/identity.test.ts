import { describe, expect, it } from 'vitest';
import { parse } from '../src/dom.js';
import { extractIdentity, extractPageSeo } from '../src/transform/identity.js';

const assetMap = new Map([
  ['https://ex.com/logo.png', '/media/x/logo.jpg'],
  ['https://ex.com/og.jpg', '/media/x/og.jpg'],
  ['https://ex.com/favicon.png', '/media/x/fav.png'],
]);

describe('extractIdentity', () => {
  it('pulls name, description, assets, contact, colors and social', () => {
    const html = `<html><head>
      <title>Acme Studio | Home</title>
      <meta name="description" content="We build sites">
      <meta property="og:site_name" content="Acme Studio">
      <meta property="og:image" content="https://ex.com/og.jpg">
      <meta name="theme-color" content="#ff8800">
      <link rel="icon" href="/favicon.png">
      <script type="application/ld+json">{"@type":"Organization","email":"hi@acme.com","telephone":"+1 555","sameAs":["https://twitter.com/acme","https://www.linkedin.com/company/acme"]}</script>
      </head><body><header><img src="/logo.png" alt="Acme logo"></header></body></html>`;
    const id = extractIdentity(parse(html), { baseUrl: 'https://ex.com/', assetMap, fallbackName: 'X' });
    expect(id.name).toBe('Acme Studio');
    expect(id.description).toBe('We build sites');
    expect(id.logo).toBe('/media/x/logo.jpg');
    expect(id.icon).toBe('/media/x/fav.png');
    expect(id.image).toBe('/media/x/og.jpg');
    expect(id.email).toBe('hi@acme.com');
    expect(id.telephone).toBe('+1 555');
    expect(id.colors.primary).toBe('#ff8800');
    expect(id.social?.map((s) => s.link)).toEqual(['https://twitter.com/acme', 'https://www.linkedin.com/company/acme']);
  });

  it('extracts postal address + geo from JSON-LD', () => {
    const html = `<html><head><title>Acme</title>
      <script type="application/ld+json">{"@type":"LocalBusiness","address":{"@type":"PostalAddress","streetAddress":"1 Main St","addressLocality":"Windhoek","addressRegion":"Khomas","postalCode":"9000","addressCountry":{"name":"Namibia"}},"geo":{"@type":"GeoCoordinates","latitude":-22.55,"longitude":17.08}}</script>
      </head><body></body></html>`;
    const id = extractIdentity(parse(html), { baseUrl: 'https://ex.com/', assetMap: new Map(), fallbackName: 'X' });
    expect(id.address).toEqual({ street: '1 Main St', locality: 'Windhoek', region: 'Khomas', postalCode: '9000', country: 'Namibia' });
    expect(id.geo).toEqual({ latitude: '-22.55', longitude: '17.08' });
  });

  it('accepts a LocalBusiness SUBTYPE (@type) + captures businessType, legalName/shortName, geo from the map URL', () => {
    // burmeister-style: @type is a LocalBusiness subtype the old literal filter dropped (losing the address);
    // no legalName/alternateName/geo in JSON-LD, but the NAME carries a legal suffix + a map iframe has GPS.
    const html = `<html><head><title>Burmeister & Partners</title>
      <script type="application/ld+json">{"@type":"HomeAndConstructionBusiness","name":"Burmeister & Partners (PTY) Ltd","address":{"@type":"PostalAddress","streetAddress":"Cnr X & Y","addressLocality":"Windhoek","addressRegion":"Khomas","addressCountry":"Namibia"}}</script>
      </head><body><iframe src="https://www.google.com/maps/embed?pb=!1m14!2d17.0977039!3d-22.5920485!2sBP"></iframe></body></html>`;
    const id = extractIdentity(parse(html), { baseUrl: 'https://ex.com/', assetMap: new Map(), fallbackName: 'X' });
    expect(id.address).toEqual({ street: 'Cnr X & Y', locality: 'Windhoek', region: 'Khomas', country: 'Namibia' }); // subtype no longer dropped
    expect(id.businessType).toBe('Home And Construction Business');
    expect(id.legalName).toBe('Burmeister & Partners (PTY) Ltd'); // name carries a legal suffix → it IS the legal name
    expect(id.shortName).toBe('Burmeister & Partners'); // suffix stripped
    expect(id.geo).toEqual({ latitude: '-22.5920485', longitude: '17.0977039' }); // from the map embed (!3d=lat, !2d=lon)
  });

  it('prefers explicit JSON-LD legalName/alternateName over extrapolation', () => {
    const html = `<html><head><title>Acme</title>
      <script type="application/ld+json">{"@type":"Organization","name":"Acme","legalName":"Acme Holdings Inc.","alternateName":"ACME"}</script>
      </head><body></body></html>`;
    const id = extractIdentity(parse(html), { baseUrl: 'https://ex.com/', assetMap: new Map(), fallbackName: 'X' });
    expect(id.legalName).toBe('Acme Holdings Inc.');
    expect(id.shortName).toBe('ACME');
  });

  it('scans the DOM for tel:/mailto:, footer social links, and a maps embed (when JSON-LD lacks them)', () => {
    const html = `<html><head><title>Acme</title></head><body><footer>
      <a href="tel:+264 61 379 000">Call</a>
      <a href="mailto:hi@acme.com.na">Email</a>
      <a href="https://www.facebook.com/acme">FB</a>
      <a href="https://www.instagram.com/acme">IG</a>
      <a href="https://example.com/not-social">Other</a>
      <iframe src="https://www.google.com/maps/embed?pb=xyz"></iframe>
    </footer></body></html>`;
    const id = extractIdentity(parse(html), { baseUrl: 'https://ex.com/', assetMap: new Map(), fallbackName: 'X' });
    expect(id.telephone).toBe('+264 61 379 000');
    expect(id.email).toBe('hi@acme.com.na');
    expect(id.mapUrl).toBe('https://www.google.com/maps/embed?pb=xyz');
    const names = (id.social ?? []).map((s) => s.name);
    expect(names).toContain('Facebook');
    expect(names).toContain('Instagram');
    expect(names).not.toContain('Example'); // a non-social link (icon 'globe') is excluded
  });

  it('extracts a LAZY (data-src) map iframe + a Facebook page-plugin profile (no <a> social)', () => {
    const html = `<html><head><title>Acme</title></head><body><footer>
      <iframe class="lazy" data-src="https://www.google.com/maps/embed?pb=!1m14!abc"></iframe>
      <iframe src="https://www.facebook.com/plugins/page.php?href=https%3A%2F%2Fwww.facebook.com%2Facmeco%2F&tabs=timeline"></iframe>
    </footer></body></html>`;
    const id = extractIdentity(parse(html), { baseUrl: 'https://ex.com/', assetMap: new Map(), fallbackName: 'X' });
    expect(id.mapUrl).toContain('google.com/maps/embed'); // read from data-src, not src
    expect(id.social?.[0]).toMatchObject({ name: 'Facebook', link: 'https://www.facebook.com/acmeco/' });
  });

  it('extracts a free-text address from a location-icon footer block (no JSON-LD/microdata)', () => {
    const html = `<html><body><footer>
      <div class="d-flex"><i class="fa fa-home"></i><span>Corner of A &amp; B Streets, Suiderhof</span></div>
    </footer></body></html>`;
    const id = extractIdentity(parse(html), { baseUrl: 'https://ex.com/', assetMap: new Map(), fallbackName: 'X' });
    expect(id.address).toEqual({ street: 'Corner of A & B Streets', locality: 'Suiderhof' });
  });

  it('extracts a postal address from schema.org microdata', () => {
    const html = `<html><body><div itemtype="http://schema.org/PostalAddress">
      <span itemprop="streetAddress">1 Main St</span><span itemprop="addressLocality">Windhoek</span><span itemprop="postalCode">9000</span>
    </div></body></html>`;
    const id = extractIdentity(parse(html), { baseUrl: 'https://ex.com/', assetMap: new Map(), fallbackName: 'X' });
    expect(id.address).toMatchObject({ street: '1 Main St', locality: 'Windhoek', postalCode: '9000' });
  });

  it('does NOT mistake a nav "Home" link (fa-home) for an address', () => {
    const html = `<html><body><nav><a href="/"><i class="fa fa-home"></i> Home</a></nav></body></html>`;
    const id = extractIdentity(parse(html), { baseUrl: 'https://ex.com/', assetMap: new Map(), fallbackName: 'X' });
    expect(id.address).toBeUndefined();
  });

  it('derives the name from <title> then host when og:site_name is absent', () => {
    const fromTitle = extractIdentity(parse('<html><head><title>Beta Co — Welcome</title></head><body></body></html>'), {
      baseUrl: 'https://beta.example/',
      assetMap: new Map(),
      fallbackName: 'X',
    });
    expect(fromTitle.name).toBe('Beta Co');
    const fromHost = extractIdentity(parse('<html><body></body></html>'), { baseUrl: 'https://www.gamma.io/', assetMap: new Map(), fallbackName: 'X' });
    expect(fromHost.name).toBe('Gamma');
  });

  it('uses a single-segment title and an https hotlink when assets are not hosted', () => {
    const id = extractIdentity(
      parse('<html><head><title>SoloName</title></head><body><header><img src="https://cdn.x/logo.png" alt="logo"></header></body></html>'),
      { baseUrl: 'https://ex.com/', assetMap: new Map(), fallbackName: 'X' },
    );
    expect(id.name).toBe('SoloName');
    expect(id.logo).toBe('https://cdn.x/logo.png');
  });

  it('drops a non-https icon that cannot be self-hosted', () => {
    const id = extractIdentity(
      parse('<html><head><link rel="icon" href="http://cdn.x/fav.ico"></head><body></body></html>'),
      { baseUrl: 'https://ex.com/', assetMap: new Map(), fallbackName: 'X' },
    );
    expect(id.icon).toBeUndefined();
  });

  it('ignores invalid theme-color and malformed JSON-LD', () => {
    const id = extractIdentity(parse('<html><head><meta name="theme-color" content="not-a-color"><script type="application/ld+json">{bad json</script></head><body></body></html>'), {
      baseUrl: 'https://ex.com/',
      assetMap: new Map(),
      fallbackName: 'Fallback',
    });
    // primary falls back to the mandatory default, not "not-a-color"
    expect(id.colors.primary).not.toBe('not-a-color');
    expect(id.email).toBeUndefined();
  });
});

describe('extractPageSeo', () => {
  it('reads title, description, image, canonical and noindex', () => {
    const html = `<html><head>
      <title>About — Acme</title>
      <meta name="description" content="about us">
      <link rel="canonical" href="https://ex.com/about">
      <meta name="robots" content="noindex,follow">
      <meta property="og:image" content="https://ex.com/og.jpg">
      </head><body></body></html>`;
    const seo = extractPageSeo(parse(html), { baseUrl: 'https://ex.com/about', assetMap });
    expect(seo.title).toBe('About — Acme');
    expect(seo.description).toBe('about us');
    expect(seo.canonical).toBe('https://ex.com/about');
    expect(seo.noindex).toBe(true);
    expect(seo.image).toBe('/media/x/og.jpg');
  });

  it('falls back to the full title when it starts with a separator, and ignores a canonical without href', () => {
    const id = extractIdentity(parse('<html><head><title> | Acme</title></head><body></body></html>'), { baseUrl: 'https://ex.com/', assetMap: new Map(), fallbackName: 'X' });
    expect(id.name.length).toBeGreaterThan(0);
    const seo = extractPageSeo(parse('<html><head><link rel="canonical"></head><body></body></html>'), { baseUrl: 'https://ex.com/', assetMap: new Map() });
    expect(seo.canonical).toBeUndefined();
  });

  it('omits a non-https canonical', () => {
    const seo = extractPageSeo(parse('<html><head><link rel="canonical" href="http://ex.com/x"></head><body></body></html>'), { baseUrl: 'https://ex.com/x', assetMap: new Map() });
    expect(seo.canonical).toBeUndefined();
  });
});
