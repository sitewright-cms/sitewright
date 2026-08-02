import { describe, it, expect } from 'vitest';
import { renderIconSvg, isPhosphorName, aliasToPhosphor, phosphorBody, PHOSPHOR_WEIGHTS } from '../src/index.js';
import { SocialLinkSchema } from '@sitewright/schema';

describe('renderIconSvg — Phosphor icon resolution', () => {
  it('renders a Phosphor FILL glyph by default (256 viewBox, fill, name+weight hooks)', () => {
    const out = renderIconSvg('gear');
    expect(out).toContain('viewBox="0 0 256 256"');
    expect(out).toContain('fill="currentColor"');
    expect(out).not.toContain('stroke="currentColor"');
    expect(out).toContain('class="sw-icon sw-icon-gear sw-icon-fill h-5 w-5"'); // default class = h-5 w-5
    expect(out).toContain('<path');
  });

  it('a ":weight" suffix picks the weight (and only a REAL weight suffix is treated as one)', () => {
    for (const w of PHOSPHOR_WEIGHTS) {
      expect(renderIconSvg(`gear:${w}`)).toContain(`sw-icon-gear sw-icon-${w}`);
    }
    // A hyphenated name whose trailing token is NOT a weight is treated as the whole name.
    expect(renderIconSvg('caret-double-left')).toContain('sw-icon-caret-double-left sw-icon-fill');
    // ":bold" on a hyphenated name splits correctly.
    expect(renderIconSvg('caret-double-left:bold')).toContain('sw-icon-caret-double-left sw-icon-bold');
  });

  it('resolves a Lucide name to its Phosphor twin via the alias', () => {
    expect(aliasToPhosphor('settings')).toBe('gear');
    expect(renderIconSvg('settings')).toContain('sw-icon-gear sw-icon-fill');
    expect(renderIconSvg('chevron-left')).toContain('sw-icon-caret-left');
    expect(renderIconSvg('search')).toContain('sw-icon-magnifying-glass');
  });

  it('falls back to a Lucide OUTLINE for a Lucide-only name (never invisible)', () => {
    const out = renderIconSvg('align-horizontal-space-around');
    expect(out).toContain('viewBox="0 0 24 24"');
    expect(out).toContain('stroke="currentColor"');
    expect(out).toContain('sw-icon-lucide');
  });

  it('empty class → base CSS owns the size (no h-5 w-5); a truly unknown name → empty string', () => {
    expect(renderIconSvg('gear', '')).toContain('class="sw-icon sw-icon-gear sw-icon-fill"');
    expect(renderIconSvg('gear', '')).not.toContain('h-5 w-5');
    expect(renderIconSvg('totally-made-up-xyz')).toBe('');
  });

  it('duotone keeps its secondary path (opacity 0.2) for a single-colour duotone', () => {
    const out = renderIconSvg('heart:duotone');
    expect(out).toContain('sw-icon-heart sw-icon-duotone');
    expect(out).toContain('opacity="0.2"'); // the secondary layer survives
  });

  it('brand:<slug> renders a simple-icons filled logo; brand:linkedin falls back to the FILLED Phosphor logo', () => {
    expect(renderIconSvg('brand:github')).toContain('sw-icon-brand-github');
    expect(renderIconSvg('brand:github')).toContain('viewBox="0 0 24 24"');
    const li = renderIconSvg('brand:linkedin');
    expect(li).toContain('sw-icon-linkedin-logo sw-icon-fill'); // filled Phosphor fallback (simple-icons lacks it)
    expect(li).toContain('fill="currentColor"');
    expect(li).not.toContain('stroke="currentColor"');
  });

  it('the class is attribute-escaped (no breakout)', () => {
    expect(renderIconSvg('gear', 'a"onerror=x')).not.toContain('"onerror=x');
  });

  it('phosphorBody + isPhosphorName agree with the data', () => {
    expect(isPhosphorName('gear')).toBe(true);
    expect(isPhosphorName('settings')).toBe(false); // Lucide name, not a Phosphor name
    expect(phosphorBody('gear', 'fill')).toBeTruthy();
    expect(phosphorBody('nope-xyz', 'fill')).toBeUndefined();
  });
});

describe('searchIcons — multi-term icon search', () => {
  it('splits on commas AND whitespace, returns a group per term', async () => {
    const { searchIcons } = await import('../src/index.js');
    const groups = searchIcons('settings,  trash gear');
    expect(groups.map((g) => g.term)).toEqual(['settings', 'trash', 'gear']);
    expect(groups[0]!.matches[0]).toBe('gear'); // "settings" → gear (alias) ranks first
    expect(groups[1]!.matches).toContain('trash');
  });
  it('finds a Phosphor icon from a Lucide keyword synonym', async () => {
    const { searchIcons } = await import('../src/index.js');
    expect(searchIcons('cog')[0]!.matches).toContain('gear'); // lucide "settings" tag "cog" → gear
    expect(searchIcons('magnify')[0]!.matches.some((m) => m.includes('magnifying-glass'))).toBe(true);
  });
  it('finds BRAND logos, so brand:<slug> stops being a blind guess', async () => {
    // `brand:<slug>` renders a simple-icons logo, but the slugs were unsearchable AND an unknown slug
    // renders NOTHING — no error, no fallback. A clone author guessed `brand:dinersclub`, got silence,
    // and only noticed by counting <svg> elements against the spans that should have held them.
    const { searchIcons, BRAND_ICON_NAMES, renderIconSvg } = await import('../src/index.js');
    const known = BRAND_ICON_NAMES[0]!;
    const hits = searchIcons(known)[0]!.matches;
    expect(hits).toContain(`brand:${known}`);
    // the result is the LITERAL string {{sw-icon}} takes, so it can be pasted straight in and renders
    expect(renderIconSvg(`brand:${known}`)).toContain('<svg');

    // a well-known logo is findable by its plain name
    const fb = searchIcons('facebook')[0]!.matches;
    expect(fb.some((m) => m.startsWith('brand:'))).toBe(true);

    // …and brand results never crowd out an exact Phosphor match for an ordinary word
    expect(searchIcons('gear')[0]!.matches[0]).toBe('gear');
  });

  it('matches tags as WHOLE words, not substrings (no cross-word false positives)', async () => {
    const { searchIcons } = await import('../src/index.js');
    // 'onito' is a mid-word fragment of the tag 'monitor' — must NOT surface tag-sourced matches.
    const m = searchIcons('onito')[0]!.matches;
    expect(m).not.toContain('pulse');
    expect(m).not.toContain('airplay');
  });
  it('empty/blank query → no groups; caps per term', async () => {
    const { searchIcons } = await import('../src/index.js');
    expect(searchIcons('   ')).toEqual([]);
    expect(searchIcons('arrow', 3)[0]!.matches.length).toBeLessThanOrEqual(3);
  });
  it('caps the number of terms (DoS guard) — a huge query is bounded', async () => {
    const { searchIcons, iconSearchTerms, MAX_ICON_SEARCH_TERMS } = await import('../src/index.js');
    const many = Array.from({ length: 5000 }, () => 'a').join(',');
    expect(iconSearchTerms(many).length).toBe(MAX_ICON_SEARCH_TERMS);
    expect(searchIcons(many).length).toBe(MAX_ICON_SEARCH_TERMS);
  });
});


describe('social icon weights stay in step with the icon system', () => {
  const parse = (icon: string) => SocialLinkSchema.safeParse({ link: 'https://example.com', icon }).success;

  it('the schema accepts exactly the weights Phosphor ships', () => {
    // `identity.social[].icon` feeds `{{sw-icon}}`, so its pattern has to accept the same
    // `name:weight` syntax — it used to reject it outright, which is why a clone of a site with
    // hairline glyphs shipped filled marks: the author tried `envelope:light` and got
    // `400: invalid icon name`. The weight list is duplicated in @sitewright/schema (which cannot
    // import this package), so this is the guard against the two drifting apart.
    for (const weight of PHOSPHOR_WEIGHTS) expect(parse(`envelope:${weight}`), weight).toBe(true);
    expect(parse('envelope')).toBe(true);
    expect(parse('brand:whatsapp')).toBe(true);
    // A made-up weight stays a typo rather than silently becoming the default.
    expect(parse('envelope:hairline')).toBe(false);
    // A brand logo has ONE form — accepting a weight there would quietly do nothing.
    expect(parse('brand:x:bold')).toBe(false);
  });

  it('a weighted social icon renders that weight, not the default fill', () => {
    const thin = renderIconSvg('envelope:thin');
    expect(thin).toContain('sw-icon-thin');
    expect(thin).not.toBe(renderIconSvg('envelope'));
  });
});
