import { describe, it, expect } from 'vitest';
import { applyCriticalCssPatch, listCriticalCssBlocks, CSS_BLOCK_NAME } from '../src/repo/critical-css.js';

describe('applyCriticalCssPatch', () => {
  it('appends when no block name is given', () => {
    expect(applyCriticalCssPatch('.a{color:red}', '.b{color:blue}')).toBe('.a{color:red}\n.b{color:blue}');
    expect(applyCriticalCssPatch('', '.b{}')).toBe('.b{}');
    expect(applyCriticalCssPatch(null, '.b{}')).toBe('.b{}');
    // an empty append changes nothing rather than adding whitespace
    expect(applyCriticalCssPatch('.a{}', '   ')).toBe('.a{}');
  });

  it('a NAMED write is an upsert — the second write replaces, it does not duplicate', () => {
    // This is the whole point. An agent tweaking one rule five times would otherwise leave five
    // copies in the sheet: the last still wins in CSS, so it looks fine while the field grows
    // without bound. One agent re-sent a ~19KB stylesheet eleven times for exactly this reason.
    let sheet = applyCriticalCssPatch('.base{}', '.nav{height:80px}', 'nav');
    expect(sheet).toContain('/* sw:block nav */');
    expect(sheet).toContain('.nav{height:80px}');

    sheet = applyCriticalCssPatch(sheet, '.nav{height:92px}', 'nav');
    expect(sheet).toContain('.nav{height:92px}');
    expect(sheet).not.toContain('80px');
    expect(sheet.match(/\/\* sw:block nav \*\//g)).toHaveLength(1); // exactly one OPENER (the closer is `/* /sw:block …`)
    expect(sheet).toContain('.base{}'); // …and the rest of the sheet is untouched
  });

  it('replaces IN PLACE, so block order is stable across edits', () => {
    let sheet = applyCriticalCssPatch('', '.a{}', 'alpha');
    sheet = applyCriticalCssPatch(sheet, '.b{}', 'beta');
    sheet = applyCriticalCssPatch(sheet, '.a2{}', 'alpha'); // edit the FIRST block
    expect(listCriticalCssBlocks(sheet)).toEqual(['alpha', 'beta']);
    expect(sheet.indexOf('.a2{}')).toBeLessThan(sheet.indexOf('.b{}')); // order preserved
  });

  it('an empty body REMOVES a named block, and removing an absent one is a no-op', () => {
    const sheet = applyCriticalCssPatch('.keep{}', '.gone{}', 'temp');
    const pruned = applyCriticalCssPatch(sheet, '', 'temp');
    expect(pruned).toBe('.keep{}');
    expect(applyCriticalCssPatch('.keep{}', '', 'never-existed')).toBe('.keep{}');
  });

  it('repeated upserts do not accumulate blank lines', () => {
    let sheet = applyCriticalCssPatch('.a{}', '.n{}', 'nav');
    for (let i = 0; i < 5; i++) sheet = applyCriticalCssPatch(sheet, `.n{--i:${i}}`, 'nav');
    expect(sheet).not.toMatch(/\n\s*\n/);
  });

  it('an unterminated opener does not swallow the rest of the sheet', () => {
    // A hand-edited/corrupted field must degrade to "append", never to "delete everything after here".
    const broken = '/* sw:block nav */\n.nav{}\n.other{color:red}';
    const out = applyCriticalCssPatch(broken, '.nav{height:9px}', 'nav');
    expect(out).toContain('.other{color:red}');
    expect(out).toContain('.nav{height:9px}');
  });

  it('lists blocks in document order, without duplicates', () => {
    let sheet = applyCriticalCssPatch('', '.a{}', 'header');
    sheet = applyCriticalCssPatch(sheet, '.b{}', 'footer');
    expect(listCriticalCssBlocks(sheet)).toEqual(['header', 'footer']);
    expect(listCriticalCssBlocks('.plain{}')).toEqual([]);
    expect(listCriticalCssBlocks(null)).toEqual([]);
  });

  it('block names are constrained — they end up inside a CSS comment delimiter', () => {
    for (const ok of ['nav', 'page-hero', 'a_b1']) expect(CSS_BLOCK_NAME.test(ok)).toBe(true);
    // a name containing */ would close the delimiter early and corrupt the sheet
    for (const bad of ['*/', 'a */ b', '1lead', '', 'a'.repeat(60), 'has space']) {
      expect(CSS_BLOCK_NAME.test(bad)).toBe(false);
    }
  });
});
