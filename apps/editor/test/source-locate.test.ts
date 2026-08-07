import { describe, expect, it } from 'vitest';
import { findEachBlock, findElementRange } from '../src/lib/source-locate';

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

  // REGRESSION (reported as "works for some elements but not all"): v1 FILTERED on classes alone, so
  // every case where the class signal was absent or contradicted went silent. Each of these is common.
  describe('cases that used to go silent', () => {
    it('matches a source tag with NO class whose render carries runtime classes', () => {
      expect(pick('<div>hi</div>', { tag: 'div', classes: ['sw-enhanced', 'is-ready'] })).toBe('<div>hi</div>');
    });

    it('matches when the class is entirely a binding', () => {
      const src = '<div class="{{cls}}">hi</div>';
      expect(pick(src, { tag: 'div', classes: ['card', 'shadow'] })).toBe(src);
    });

    it('ignores an id the runtime invented rather than letting it veto every candidate', () => {
      const src = '<section class="a">x</section>';
      // no candidate carries id="sw-auto-1", so the id is dropped and the class still decides
      expect(pick(src, { tag: 'section', id: 'sw-auto-1', classes: ['a'] })).toBe(src);
    });

    it('uses TEXT to pick the right one of two loops sharing a class', () => {
      const src = '<ul class="one"><li class="row">Alpha</li></ul>\n<ul class="two"><li class="row">Beta</li></ul>';
      expect(pick(src, { tag: 'li', classes: ['row'], text: 'Beta', nth: 1 })).toBe('<li class="row">Beta</li>');
      expect(pick(src, { tag: 'li', classes: ['row'], text: 'Alpha', nth: 0 })).toBe('<li class="row">Alpha</li>');
    });

    it('text outranks position: the rendered text wins over a misleading nth', () => {
      const src = '<h2 class="t">First</h2>\n<h2 class="t">Second</h2>\n<h2 class="t">Third</h2>';
      expect(pick(src, { tag: 'h2', classes: ['t'], text: 'Third', nth: 0 })).toBe('<h2 class="t">Third</h2>');
    });

    it('does not penalise a loop body, which has no literal text of its own', () => {
      const src = '<ul>{{#each dataset.items}}<li class="item">{{title}}</li>{{/each}}</ul>';
      // the clicked row rendered "Whatever the entry said" — the source has only {{title}}
      expect(pick(src, { tag: 'li', classes: ['item'], text: 'Whatever the entry said', nth: 4 })).toBe(
        '<li class="item">{{title}}</li>',
      );
    });

    it('still declines when every candidate is CONTRADICTED (wrong element, not merely unknown)', () => {
      expect(findElementRange('<div class="a">x</div>', { tag: 'div', classes: ['b'] })).toBeNull();
    });

    it('lets a class match outrank differing text — a data-sw-text override changes the text legitimately', () => {
      // The authored default is "Hello"; page.data replaced it in the render. Same element.
      const src = '<p class="x" data-sw-text="page.data.k">Hello</p>';
      expect(pick(src, { tag: 'p', classes: ['x'], text: 'Replaced by the client' })).toBe(src);
    });
  });

  it('returns null for anything it cannot honestly place', () => {
    const src = '<div class="a">x</div>';
    expect(findElementRange(src, { tag: 'footer' })).toBeNull(); // chrome slot — not in this source
    expect(findElementRange('', { tag: 'div' })).toBeNull();
    expect(findElementRange(src, { tag: '' })).toBeNull();
    expect(findElementRange(src, { tag: 'di v' })).toBeNull(); // never build a regex from the signature
  });

  // A dataset row is wrapped in an injected <div data-sw-entry> that exists only in the render, and its
  // contents are bindings — so when no element inside the loop can be pinned down, the block that
  // rendered the row is the honest selection, and it is the code the author edits.
  describe('findEachBlock', () => {
    const src = '<ul class="l">\n  {{#each dataset.services}}<li class="s">{{title}}</li>{{/each}}\n</ul>';

    it('selects the whole {{#each}} block for a dataset', () => {
      const r = findEachBlock(src, 'services')!;
      expect(src.slice(r.from, r.to)).toBe('{{#each dataset.services}}<li class="s">{{title}}</li>{{/each}}');
    });

    it('walks NESTED each blocks to the matching {{/each}}', () => {
      const nested =
        '{{#each dataset.rooms}}<div>{{#each images}}<img src="{{url}}">{{/each}}</div>{{/each}}';
      const r = findEachBlock(nested, 'rooms')!;
      expect(nested.slice(r.from, r.to)).toBe(nested);
    });

    it('tolerates loop arguments and whitespace in the opener', () => {
      const withArgs = '{{#each dataset.team_members as |m|}}<p>{{m.name}}</p>{{/each}}';
      expect(findEachBlock(withArgs, 'team_members')).toEqual({ from: 0, to: withArgs.length });
    });

    it('returns null for an absent dataset, and never builds a regex from the slug', () => {
      expect(findEachBlock(src, 'nope')).toBeNull();
      expect(findEachBlock(src, 'a.*')).toBeNull();
      expect(findEachBlock(src, 'services|x')).toBeNull();
    });
  });

  it('selects only the opening tag when the element is never closed', () => {
    const src = '<div class="a">\n<p class="oops">unterminated';
    expect(pick(src, { tag: 'p', classes: ['oops'] })).toBe('<p class="oops">');
  });
});
