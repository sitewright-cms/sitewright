import { describe, it, expect } from 'vitest';
import { COUNTRY_CODES } from '@sitewright/schema';
import { FLAG_CODES } from '../src/flag-icons.js';

// The ship-to country list (packages/schema/src/countries.ts) and the flag set describe the same
// world: every country a market can ship to has a flag, and every country flag is a country a market
// can ship to. Only the two-letter flags that are NOT countries are left out.
describe('COUNTRY_CODES and the flag set agree', () => {
  const NOT_COUNTRIES = new Set(['eu', 'pc']); // the European Union, the Pacific Community
  const flagCountries = FLAG_CODES.filter((c) => /^[a-z]{2}$/.test(c) && !NOT_COUNTRIES.has(c)).map((c) => c.toUpperCase());

  it('every two-letter country flag is a ship-to country', () => {
    expect(flagCountries.filter((c) => !COUNTRY_CODES.includes(c))).toEqual([]);
  });

  it('every ship-to country has a flag — except Kosovo, which the flag set does not draw yet', () => {
    expect(COUNTRY_CODES.filter((c) => !flagCountries.includes(c))).toEqual(['XK']);
  });
});
