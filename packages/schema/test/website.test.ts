import { describe, it, expect } from 'vitest';
import { WebsiteSettingsSchema } from '../src/website.js';

describe('WebsiteSettingsSchema', () => {
  it('accepts critical CSS + custom head/footer', () => {
    const w = {
      criticalCss: '.hero{color:red}',
      customHead: '<!-- analytics -->',
      customFooter: '<script>/*plausible*/</script>',
    };
    expect(WebsiteSettingsSchema.parse(w)).toEqual(w);
  });

  it('is entirely optional (empty object valid)', () => {
    expect(WebsiteSettingsSchema.parse({})).toEqual({});
  });

  it('rejects fields beyond the size caps', () => {
    expect(() => WebsiteSettingsSchema.parse({ criticalCss: 'a'.repeat(10_001) })).toThrow();
    expect(() => WebsiteSettingsSchema.parse({ customHead: 'a'.repeat(20_001) })).toThrow();
    expect(() => WebsiteSettingsSchema.parse({ customFooter: 'a'.repeat(20_001) })).toThrow();
  });

  it('rejects a </style> breakout in criticalCss (it is inlined inside <style>)', () => {
    expect(() => WebsiteSettingsSchema.parse({ criticalCss: 'x{}</style><script>1</script>' })).toThrow();
    expect(() => WebsiteSettingsSchema.parse({ criticalCss: 'a</STYLE >b' })).toThrow();
    // customHead/customFooter are raw HTML by design — a </style>-like string is fine there.
    expect(WebsiteSettingsSchema.parse({ customHead: '</style>' }).customHead).toBe('</style>');
  });
});
