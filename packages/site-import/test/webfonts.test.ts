import { describe, expect, it } from 'vitest';
import { parseGoogleFontRefs } from '../src/transform/webfonts.js';

describe('parseGoogleFontRefs', () => {
  it('parses a css2 <link> with multiple families + weights', () => {
    const html = `<head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;700;800&family=Inter:wght@400;500;600;700&display=swap"></head>`;
    expect(parseGoogleFontRefs(html)).toEqual([
      { family: 'Sora', weights: [400, 500, 700, 800] },
      { family: 'Inter', weights: [400, 500, 600, 700] },
    ]);
  });

  it('handles ital,wght tuples (takes the weight) and "+"-encoded family names', () => {
    const html = `<link href="https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,400;1,700&display=swap">`;
    expect(parseGoogleFontRefs(html)).toEqual([{ family: 'Open Sans', weights: [400, 700] }]);
  });

  it('defaults to weight 400 when none is specified, and merges duplicate families', () => {
    const html = `<link href="https://fonts.googleapis.com/css2?family=Roboto"><style>@import url('https://fonts.googleapis.com/css2?family=Roboto:wght@700');</style>`;
    expect(parseGoogleFontRefs(html)).toEqual([{ family: 'Roboto', weights: [400, 700] }]);
  });

  it('parses an @import in a <style> block and &amp;-escaped hrefs', () => {
    const html = `<style>@import url("https://fonts.googleapis.com/css2?family=Lato:wght@300;400&amp;family=Merriweather:wght@700&amp;display=swap");</style>`;
    expect(parseGoogleFontRefs(html)).toEqual([
      { family: 'Lato', weights: [300, 400] },
      { family: 'Merriweather', weights: [700] },
    ]);
  });

  it('returns [] for pages with no Google Fonts', () => {
    expect(parseGoogleFontRefs('<html><body><h1>hi</h1></body></html>')).toEqual([]);
    expect(parseGoogleFontRefs('')).toEqual([]);
  });
});
