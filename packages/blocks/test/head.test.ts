import { describe, it, expect } from 'vitest';
import { metaTags, schemaOrgJsonLd, type SeoMeta, type SchemaOrgInfo } from '../src/head.js';

describe('metaTags', () => {
  const base: SeoMeta = { title: 'Home' };

  it('always emits og:title and a twitter card (summary without an image)', () => {
    const html = metaTags(base);
    expect(html).toContain('property="og:title" content="Home"');
    expect(html).toContain('name="twitter:card" content="summary"');
    expect(html).toContain('property="og:type" content="website"');
  });

  it('uses summary_large_image when an og image is present', () => {
    expect(metaTags({ title: 'T', ogImage: 'https://x.io/og.png' })).toContain(
      'name="twitter:card" content="summary_large_image"',
    );
  });

  it('emits description, og:description, image, url + canonical when provided', () => {
    const html = metaTags({
      title: 'T',
      description: 'A site',
      ogImage: 'https://x.io/og.png',
      url: 'https://x.io/',
    });
    expect(html).toContain('name="description" content="A site"');
    expect(html).toContain('property="og:description" content="A site"');
    expect(html).toContain('property="og:image" content="https://x.io/og.png"');
    expect(html).toContain('property="og:url" content="https://x.io/"');
    expect(html).toContain('rel="canonical" href="https://x.io/"');
  });

  it('emits theme-color and favicon when provided', () => {
    const html = metaTags({ title: 'T', themeColor: '#0a7', favicon: '/icon.png' });
    expect(html).toContain('name="theme-color" content="#0a7"');
    expect(html).toContain('rel="icon" href="/icon.png"');
  });

  it('emits robots noindex only when set', () => {
    expect(metaTags({ title: 'T', noindex: true })).toContain('name="robots" content="noindex"');
    expect(metaTags({ title: 'T' })).not.toContain('noindex');
  });

  it('escapes attribute values (no breakout)', () => {
    const html = metaTags({ title: '"><script>x', description: 'a "quote"' });
    expect(html).not.toContain('<script>x');
    expect(html).toContain('&quot;&gt;&lt;script&gt;x');
    expect(html).toContain('a &quot;quote&quot;');
  });

  it('renders hreflang alternate links and attribute-escapes them', () => {
    const html = metaTags({
      title: 'T',
      alternates: [
        { hreflang: 'en', href: 'https://acme.example/' },
        { hreflang: 'de', href: 'https://acme.example/de/' },
        { hreflang: 'x-default', href: 'https://acme.example/' },
      ],
    });
    expect(html).toContain('<link rel="alternate" hreflang="en" href="https://acme.example/" />');
    expect(html).toContain('<link rel="alternate" hreflang="de" href="https://acme.example/de/" />');
    expect(html).toContain('<link rel="alternate" hreflang="x-default" href="https://acme.example/" />');
    // No alternates → no alternate links.
    expect(metaTags({ title: 'T' })).not.toContain('hreflang');
    // A malicious href can't break out of the attribute — incl. a literal quote.
    const evil = metaTags({ title: 'T', alternates: [{ hreflang: 'en', href: '"><script>x</script>' }] });
    expect(evil).not.toContain('<script>x');
    expect(evil).toContain('&quot;&gt;&lt;script&gt;');
    const quoted = metaTags({ title: 'T', alternates: [{ hreflang: 'en', href: 'https://acme.example"evil' }] });
    expect(quoted).toContain('href="https://acme.example&quot;evil"');
    expect(quoted).not.toContain('"evil"');
  });
});

describe('schemaOrgJsonLd', () => {
  const org: SchemaOrgInfo = {
    name: 'Acme',
    url: 'https://acme.test/',
    logo: 'https://acme.test/logo.png',
    telephone: '+264-81-660-0188',
    email: 'info@acme.test',
    address: { street: '1 Main', locality: 'Windhoek', region: 'Khomas', country: 'NA' },
    geo: { latitude: '-22.5', longitude: '17.0' },
    sameAs: ['https://facebook.com/acme', 'https://twitter.com/acme'],
  };

  it('returns empty when undefined or type disabled', () => {
    expect(schemaOrgJsonLd(undefined)).toBe('');
    expect(schemaOrgJsonLd({ ...org, type: 'disabled' })).toBe('');
  });

  it('emits a valid JSON-LD Organization block', () => {
    const html = schemaOrgJsonLd(org);
    expect(html).toContain('<script type="application/ld+json">');
    const json = html.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
    const parsed = JSON.parse(json); // JSON.parse natively decodes the \uXXXX escapes
    expect(parsed['@context']).toBe('https://schema.org');
    expect(parsed['@type']).toBe('Organization');
    expect(parsed.name).toBe('Acme');
    expect(parsed.address['@type']).toBe('PostalAddress');
    expect(parsed.address.addressLocality).toBe('Windhoek');
    expect(parsed.geo.latitude).toBe('-22.5');
    expect(parsed.sameAs).toEqual(['https://facebook.com/acme', 'https://twitter.com/acme']);
  });

  it('honours a custom @type', () => {
    expect(schemaOrgJsonLd({ name: 'A', type: 'LocalBusiness' })).toContain('"@type":"LocalBusiness"');
  });

  it('escapes a </script> breakout in any value', () => {
    const html = schemaOrgJsonLd({ name: 'Evil</script><script>alert(1)' });
    expect(html).not.toContain('</script><script>alert(1)');
    expect(html).toContain('\\u003c/script');
  });

  it('escapes breakout attempts in every field (type, telephone, geo, address)', () => {
    const html = schemaOrgJsonLd({
      name: 'Acme',
      type: '</script><script>a',
      telephone: '</script>b',
      email: '</script>c',
      address: { locality: '</script>d' },
      geo: { latitude: '</script>e', longitude: '</script>f' },
      sameAs: ['https://x.io/</script>'],
    });
    expect(html).not.toContain('</script><script>');
    expect(html).not.toMatch(/<\/script>[a-f]/); // none of the field payloads leak literally
    expect(html).toContain('\\u003c/script');
  });
});
