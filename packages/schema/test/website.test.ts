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
});
