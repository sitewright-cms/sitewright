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

  it('rejects fields beyond the size cap', () => {
    expect(() => WebsiteSettingsSchema.parse({ criticalCss: 'a'.repeat(50_001) })).toThrow();
  });
});
