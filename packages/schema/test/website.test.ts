import { describe, it, expect } from 'vitest';
import { WebsiteSettingsSchema } from '../src/website.js';

describe('WebsiteSettingsSchema', () => {
  it('accepts the raw owner-only fields (head / criticalCss / scripts)', () => {
    const w = {
      criticalCss: '.hero{color:red}',
      head: '<!-- analytics -->',
      scripts: '<script>/*plausible*/</script>',
    };
    expect(WebsiteSettingsSchema.parse(w)).toEqual(w);
  });

  it('migrates the retired field names (customHead→head, customFooter→scripts)', () => {
    // Settings stored under the old schema keep their content on the next read/write.
    const migrated = WebsiteSettingsSchema.parse({
      customHead: '<!-- legacy head -->',
      customFooter: '<script>legacy()</script>',
    });
    expect(migrated).toEqual({ head: '<!-- legacy head -->', scripts: '<script>legacy()</script>' });
    // The legacy keys are dropped (not carried alongside the new ones).
    expect('customHead' in migrated).toBe(false);
    expect('customFooter' in migrated).toBe(false);
  });

  it('prefers the new field name when both old and new are present (idempotent re-parse)', () => {
    const migrated = WebsiteSettingsSchema.parse({ head: 'new', customHead: 'old' });
    expect(migrated.head).toBe('new');
  });

  it('is entirely optional (empty object valid)', () => {
    expect(WebsiteSettingsSchema.parse({})).toEqual({});
  });

  it('accepts an https jsonDataUrl (with query) and rejects non-https / malformed', () => {
    const url = 'https://en.wikipedia.org/api/rest_v1/page/summary/Berlin?redirect=true';
    expect(WebsiteSettingsSchema.parse({ jsonDataUrl: url }).jsonDataUrl).toBe(url);
    expect(() => WebsiteSettingsSchema.parse({ jsonDataUrl: 'http://example.com/d.json' })).toThrow();
    expect(() => WebsiteSettingsSchema.parse({ jsonDataUrl: 'not-a-url' })).toThrow();
    expect(() => WebsiteSettingsSchema.parse({ jsonDataUrl: `https://x.test/${'a'.repeat(2048)}` })).toThrow();
  });

  it('accepts the full set of validated skeleton slots', () => {
    const w = {
      topNav: '<nav class="navbar">x</nav>',
      mobileNav: '<nav class="drawer">m</nav>',
      sidebarLeft: '<aside class="menu">l</aside>',
      sidebarRight: '<aside class="menu">r</aside>',
      footer: '<footer class="footer">f</footer>',
      bottom: '<div class="modal">b</div>',
    };
    expect(WebsiteSettingsSchema.parse(w)).toEqual(w);
  });

  it('caps each validated slot at the HTML size limit', () => {
    expect(() => WebsiteSettingsSchema.parse({ topNav: 'a'.repeat(20_001) })).toThrow();
    expect(() => WebsiteSettingsSchema.parse({ footer: 'a'.repeat(20_001) })).toThrow();
    expect(() => WebsiteSettingsSchema.parse({ mobileNav: 'a'.repeat(20_001) })).toThrow();
    expect(() => WebsiteSettingsSchema.parse({ sidebarLeft: 'a'.repeat(20_001) })).toThrow();
    expect(() => WebsiteSettingsSchema.parse({ sidebarRight: 'a'.repeat(20_001) })).toThrow();
    expect(() => WebsiteSettingsSchema.parse({ bottom: 'a'.repeat(20_001) })).toThrow();
  });

  it('rejects fields beyond the size caps', () => {
    expect(() => WebsiteSettingsSchema.parse({ criticalCss: 'a'.repeat(10_001) })).toThrow();
    expect(() => WebsiteSettingsSchema.parse({ head: 'a'.repeat(20_001) })).toThrow();
    expect(() => WebsiteSettingsSchema.parse({ scripts: 'a'.repeat(20_001) })).toThrow();
  });

  it('rejects a </style> breakout in criticalCss (it is inlined inside <style>)', () => {
    expect(() => WebsiteSettingsSchema.parse({ criticalCss: 'x{}</style><script>1</script>' })).toThrow();
    expect(() => WebsiteSettingsSchema.parse({ criticalCss: 'a</STYLE >b' })).toThrow();
    // head/scripts are raw HTML by design — a </style>-like string is fine there.
    expect(WebsiteSettingsSchema.parse({ head: '</style>' }).head).toBe('</style>');
  });

  describe('website.data (editable JSON store)', () => {
    it('accepts a nested object/array/scalar tree', () => {
      const data = {
        hero: { headline: 'Hello', subline: 'World', published: true, rank: 3, note: null },
        highlights: ['fast', 'safe', 'simple'],
        nested: { a: { b: { c: [1, 2, { d: 'deep' }] } } },
      };
      expect(WebsiteSettingsSchema.parse({ data }).data).toEqual(data);
    });

    it('requires a root OBJECT — rejects an array or bare scalar; is optional', () => {
      expect(() => WebsiteSettingsSchema.parse({ data: [1, 'two', false] })).toThrow();
      expect(() => WebsiteSettingsSchema.parse({ data: 'just a string' })).toThrow();
      expect(WebsiteSettingsSchema.parse({ data: { nested: ['ok', 1] } }).data).toEqual({ nested: ['ok', 1] }); // arrays fine as VALUES
      expect(WebsiteSettingsSchema.parse({}).data).toBeUndefined();
    });

    it('rejects prototype-pollution keys at any depth', () => {
      // The realistic path is the JSON-source view: JSON.parse creates an OWN "__proto__" data
      // property (a literal { __proto__: … } would set the prototype instead, which Object.entries
      // can't see). Validation must reject the own key.
      const polluted = JSON.parse('{"__proto__":{"polluted":true}}');
      expect(() => WebsiteSettingsSchema.parse({ data: polluted })).toThrow();
      expect(() => WebsiteSettingsSchema.parse({ data: JSON.parse('{"a":{"__proto__":1}}') })).toThrow();
      expect(() => WebsiteSettingsSchema.parse({ data: { ok: { constructor: 1 } } })).toThrow();
      expect(() => WebsiteSettingsSchema.parse({ data: { nested: { prototype: {} } } })).toThrow();
    });

    it('rejects non-JSON values (undefined, functions, NaN/Infinity)', () => {
      expect(() => WebsiteSettingsSchema.parse({ data: { fn: () => 1 } })).toThrow();
      expect(() => WebsiteSettingsSchema.parse({ data: { x: NaN } })).toThrow();
      expect(() => WebsiteSettingsSchema.parse({ data: { x: Infinity } })).toThrow();
      expect(WebsiteSettingsSchema.parse({ data: undefined }).data).toBeUndefined();
    });

    it('accepts a tree at the maximum allowed depth', () => {
      // Depth 0..12 (13 levels) is the bound; build exactly 12 nested objects + a leaf.
      let deep: unknown = 'leaf';
      for (let i = 0; i < 12; i++) deep = { next: deep };
      expect(() => WebsiteSettingsSchema.parse({ data: deep })).not.toThrow();
    });

    it('rejects an over-deep tree without overflowing the validator stack', () => {
      // Build a 60-deep nest (over the depth bound) — iterative validation must reject, not crash.
      let deep: unknown = 'leaf';
      for (let i = 0; i < 60; i++) deep = { next: deep };
      expect(() => WebsiteSettingsSchema.parse({ data: deep })).toThrow();
    });

    it('rejects an over-long string value and over-long keys', () => {
      expect(() => WebsiteSettingsSchema.parse({ data: { big: 'a'.repeat(64_001) } })).toThrow();
      expect(() => WebsiteSettingsSchema.parse({ data: { ['k'.repeat(201)]: 1 } })).toThrow();
    });
  });

  describe('shop config (MINI SHOP)', () => {
    it('accepts a currency + the three deep-link channels', () => {
      const shop = {
        currency: { code: 'EUR', symbol: '€', position: 'after' as const, decimals: 2 },
        channels: [
          { kind: 'whatsapp' as const, number: '+14155550123', label: 'Order on WhatsApp' },
          { kind: 'mailto' as const, email: 'sales@acme.test', subject: 'New order' },
          { kind: 'payment' as const, urlTemplate: 'https://paypal.me/acme/{total}', provider: 'paypal' as const },
        ],
      };
      const parsed = WebsiteSettingsSchema.parse({ shop });
      expect(parsed.shop?.currency?.code).toBe('EUR');
      expect(parsed.shop?.channels).toHaveLength(3);
    });

    it('defaults currency position (before) and decimals (2)', () => {
      const parsed = WebsiteSettingsSchema.parse({ shop: { currency: { code: 'USD', symbol: '$' } } });
      expect(parsed.shop?.currency).toMatchObject({ position: 'before', decimals: 2 });
    });

    it('rejects a non-ISO-4217 currency code', () => {
      expect(() => WebsiteSettingsSchema.parse({ shop: { currency: { code: 'Euro', symbol: '€' } } })).toThrow();
      expect(() => WebsiteSettingsSchema.parse({ shop: { currency: { code: 'us', symbol: '$' } } })).toThrow();
      expect(() => WebsiteSettingsSchema.parse({ shop: { currency: { code: 'USD', symbol: '$', decimals: 9 } } })).toThrow();
    });

    it('rejects a non-E.164 whatsapp number, accepts a valid one', () => {
      expect(() => WebsiteSettingsSchema.parse({ shop: { channels: [{ kind: 'whatsapp', number: '0155 1234' }] } })).toThrow();
      expect(() => WebsiteSettingsSchema.parse({ shop: { channels: [{ kind: 'whatsapp', number: '+0155123' }] } })).toThrow();
      expect(
        WebsiteSettingsSchema.parse({ shop: { channels: [{ kind: 'whatsapp', number: '+14155550123' }] } }).shop?.channels,
      ).toHaveLength(1);
    });

    it('payment urlTemplate: https-only, known placeholders only, fixed link allowed', () => {
      expect(() =>
        WebsiteSettingsSchema.parse({ shop: { channels: [{ kind: 'payment', urlTemplate: 'http://paypal.me/acme/{total}' }] } }),
      ).toThrow();
      // an unknown placeholder is a likely typo → rejected
      expect(() =>
        WebsiteSettingsSchema.parse({ shop: { channels: [{ kind: 'payment', urlTemplate: 'https://paypal.me/acme/{amount}' }] } }),
      ).toThrow();
      // a Stripe-style fixed link (no placeholder) is valid
      expect(
        WebsiteSettingsSchema.parse({ shop: { channels: [{ kind: 'payment', urlTemplate: 'https://buy.stripe.com/test_fixed' }] } }).shop
          ?.channels,
      ).toHaveLength(1);
    });

    it('rejects control chars in a mailto subject (header-injection hygiene)', () => {
      expect(() =>
        WebsiteSettingsSchema.parse({ shop: { channels: [{ kind: 'mailto', email: 'a@b.test', subject: 'x\r\nBcc: e@v.test' }] } }),
      ).toThrow();
    });

    it('rejects an unknown channel kind and caps the channel count', () => {
      expect(() => WebsiteSettingsSchema.parse({ shop: { channels: [{ kind: 'sms', number: '+14155550123' }] } })).toThrow();
      const many = Array.from({ length: 9 }, () => ({ kind: 'mailto' as const, email: 'a@b.test' }));
      expect(() => WebsiteSettingsSchema.parse({ shop: { channels: many } })).toThrow();
    });

    it('shop is optional', () => {
      expect(WebsiteSettingsSchema.parse({}).shop).toBeUndefined();
    });
  });
});
