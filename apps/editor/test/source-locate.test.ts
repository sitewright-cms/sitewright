import { describe, expect, it } from 'vitest';
import { findElementRange } from '../src/lib/source-locate';

/** The located text, so an assertion reads as what the editor would SELECT. */
const pick = (src: string, sig: Parameters<typeof findElementRange>[1]) => {
  const r = findElementRange(src, sig);
  return r ? src.slice(r.from, r.to) : null;
};

describe('findElementRange', () => {
  it('selects the WHOLE element, opening tag through closing tag, across lines', () => {
    const src = ['<section class="hero">', '  <h1 class="title">Hi</h1>', '  <p>Body</p>', '</section>'].join('\n');
    expect(pick(src, { tag: 'section', classes: ['hero'] })).toBe(src);
    expect(pick(src, { tag: 'h1', classes: ['title'] })).toBe('<h1 class="title">Hi</h1>');
  });

  it('walks NESTED same-name tags to the right closing tag', () => {
    const src = '<div class="outer">\n  <div class="inner">x</div>\n</div>';
    expect(pick(src, { tag: 'div', classes: ['outer'] })).toBe(src);
    expect(pick(src, { tag: 'div', classes: ['inner'] })).toBe('<div class="inner">x</div>');
  });

  it('matches on id when the element has one', () => {
    const src = '<section class="a">one</section>\n<section id="kontakt" class="a">two</section>';
    expect(pick(src, { tag: 'section', id: 'kontakt', classes: ['a'] })).toBe('<section id="kontakt" class="a">two</section>');
  });

  it('tolerates runtime-added classes: authored must be a SUBSET of rendered', () => {
    const src = '<div class="slider">s</div>';
    // the carousel runtime adds its own classes to the live element
    expect(pick(src, { tag: 'div', classes: ['slider', 'sw-enhanced', 'is-ready'] })).toBe('<div class="slider">s</div>');
    // a class the source requires but the render lacks is NOT a match
    expect(pick(src, { tag: 'div', classes: ['other'] })).toBeNull();
  });

  it('uses nth to pick between identical candidates, and clamps a stale index', () => {
    const src = '<li class="row">1</li>\n<li class="row">2</li>\n<li class="row">3</li>';
    expect(pick(src, { tag: 'li', classes: ['row'], nth: 0 })).toBe('<li class="row">1</li>');
    expect(pick(src, { tag: 'li', classes: ['row'], nth: 2 })).toBe('<li class="row">3</li>');
    // a loop renders more rows than the source has — clamp to the authored block, never crash
    expect(pick(src, { tag: 'li', classes: ['row'], nth: 99 })).toBe('<li class="row">3</li>');
  });

  it('handles a void element and a self-closing tag (no closing tag to find)', () => {
    const src = '<div class="m">\n  <img class="pic" src="/a.png">\n  <br/>\n</div>';
    expect(pick(src, { tag: 'img', classes: ['pic'] })).toBe('<img class="pic" src="/a.png">');
    expect(pick(src, { tag: 'br' })).toBe('<br/>');
  });

  it('is not fooled by a > inside an attribute value', () => {
    const src = '<div class="a" data-tip="a > b"><span class="s">x</span></div>';
    expect(pick(src, { tag: 'div', classes: ['a'] })).toBe(src);
  });

  it('skips commented-out markup so it never matches or unbalances the scan', () => {
    const src = '<!-- <div class="card">ghost</div> -->\n<div class="card">real</div>';
    expect(pick(src, { tag: 'div', classes: ['card'] })).toBe('<div class="card">real</div>');
    const hb = '{{!-- <section class="x">c</section> --}}\n<section class="x">real</section>';
    expect(pick(hb, { tag: 'section', classes: ['x'] })).toBe('<section class="x">real</section>');
  });

  it('ignores a Handlebars expression among the class tokens', () => {
    const src = '<a class="btn {{#if on}}active{{/if}}" href="#">go</a>';
    expect(pick(src, { tag: 'a', classes: ['btn', 'active'] })).toBe(src);
  });

  it('locates an element INSIDE a loop body from any rendered row', () => {
    const src = '<ul class="list">\n  {{#each dataset.items}}<li class="item"><span>{{title}}</span></li>{{/each}}\n</ul>';
    // rows 1..N all render from the one authored <li>
    expect(pick(src, { tag: 'li', classes: ['item'], nth: 0 })).toBe('<li class="item"><span>{{title}}</span></li>');
    expect(pick(src, { tag: 'li', classes: ['item'], nth: 5 })).toBe('<li class="item"><span>{{title}}</span></li>');
  });

  it('returns null for anything it cannot honestly place', () => {
    const src = '<div class="a">x</div>';
    expect(findElementRange(src, { tag: 'footer' })).toBeNull(); // chrome slot — not in this source
    expect(findElementRange('', { tag: 'div' })).toBeNull();
    expect(findElementRange(src, { tag: '' })).toBeNull();
    expect(findElementRange(src, { tag: 'di v' })).toBeNull(); // never build a regex from the signature
  });

  it('selects only the opening tag when the element is never closed', () => {
    const src = '<div class="a">\n<p class="oops">unterminated';
    expect(pick(src, { tag: 'p', classes: ['oops'] })).toBe('<p class="oops">');
  });
});
