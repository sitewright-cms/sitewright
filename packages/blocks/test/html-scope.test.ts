import { describe, it, expect } from 'vitest';
import { scopeHtml, parseSelector, SelectorError, MAX_SCOPE_MATCHES } from '../src/html-scope.js';

const DOC =
  '<!doctype html><html><head><style>' + '.x{color:red}'.repeat(4000) + '</style>' +
  '<script>window.a = 1;</script></head><body>' +
  '<header id="top" class="bar"><nav><a href="/">Home</a></nav></header>' +
  '<main><section class="hero dark" data-sw-text="h"><h1>Hi</h1></section>' +
  '<section class="cards"><div class="card"><p>One</p></div><div class="card"><p>Two</p></div></section></main>' +
  '<footer><p>f</p></footer></body></html>';

describe('scopeHtml', () => {
  it('elides inline <style>/<script> BODIES by default, keeping the markup and saying how much went', () => {
    const { html, truncated } = scopeHtml(DOC);
    expect(html).toContain('/* 51 KB of inline CSS omitted */');
    expect(html).toContain('/* 1 KB of inline script omitted */');
    expect(html).not.toContain('.x{color:red}');
    expect(html).toContain('<main><section class="hero dark"');
    expect(truncated).toBe(false);
  });

  it('keeps everything with keepAssets', () => {
    expect(scopeHtml(DOC, { keepAssets: true }).html).toContain('.x{color:red}.x{color:red}');
  });

  it('narrows to the elements a selector matches — tag, id, class, attribute, compound', () => {
    expect(scopeHtml(DOC, { selector: 'main' }).html.startsWith('<main>')).toBe(true);
    expect(scopeHtml(DOC, { selector: '#top' }).html).toBe('<header id="top" class="bar"><nav><a href="/">Home</a></nav></header>');
    const cards = scopeHtml(DOC, { selector: '.card' });
    expect(cards.matches).toBe(2);
    expect(cards.html).toBe('<div class="card"><p>One</p></div>\n<div class="card"><p>Two</p></div>');
    expect(scopeHtml(DOC, { selector: 'section.hero.dark[data-sw-text="h"]' }).matches).toBe(1);
    expect(scopeHtml(DOC, { selector: '[data-sw-text]' }).matches).toBe(1);
  });

  it('supports descendant and child combinators and selector lists', () => {
    expect(scopeHtml(DOC, { selector: 'main p' }).matches).toBe(2);
    expect(scopeHtml(DOC, { selector: 'section > p' }).matches).toBe(0); // the <p>s sit inside .card
    expect(scopeHtml(DOC, { selector: '.cards > .card > p' }).matches).toBe(2);
    expect(scopeHtml(DOC, { selector: 'header, footer' }).matches).toBe(2);
  });

  it('returns the OUTERMOST match only, never a match inside another one twice', () => {
    expect(scopeHtml('<div class="a"><div class="a">x</div></div>', { selector: '.a' })).toMatchObject({ matches: 1 });
  });

  it('caps the matches it returns and says so', () => {
    const many = '<ul>' + '<li>x</li>'.repeat(MAX_SCOPE_MATCHES + 5) + '</ul>';
    const res = scopeHtml(many, { selector: 'li' });
    expect(res.matches).toBe(MAX_SCOPE_MATCHES + 5);
    expect(res.html.split('\n')).toHaveLength(MAX_SCOPE_MATCHES);
    expect(res.truncated).toBe(true);
  });

  it('stays fast on a deep tree with a long descendant chain (memoised matching)', () => {
    const deep = '<div>'.repeat(300) + 'x' + '</div>'.repeat(300);
    const t0 = Date.now();
    scopeHtml(deep, { selector: 'div div div div div div div div div div div span' });
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('parseSelector', () => {
  it('names what it does not support instead of guessing', () => {
    expect(() => parseSelector('a:hover')).toThrow(SelectorError);
    expect(() => parseSelector('a ~ b')).toThrow(/unsupported/);
    expect(() => parseSelector('> a')).toThrow(/misplaced/);
    expect(() => parseSelector('a >')).toThrow(/ends with/);
    expect(() => parseSelector('x'.repeat(201))).toThrow(/longer than/);
    expect(() => parseSelector(Array.from({ length: 13 }, () => 'a').join(' '))).toThrow(/more than 12 steps/);
  });
});
