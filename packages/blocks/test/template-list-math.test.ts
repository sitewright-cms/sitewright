import { describe, it, expect } from 'vitest';
import { renderTemplate, registeredSwHelpers, type TemplateContext } from '../src/template.js';

/**
 * LIST WINDOWING + ARITHMETIC.
 *
 * These exist for one concrete thing the engine could not express at all: a PAGINATED ARCHIVE. A news
 * section with 831 posts as child pages had no way to render "posts 10-19" — `{{#each page.children}}`
 * is all-or-nothing, there was no slice/limit, and there was no arithmetic to derive an offset from a
 * page number (`{{multiply @index 90}}` emitted `<!-- sw:unknown-helper multiply -->`, which inside an
 * attribute is invisible garbage).
 *
 * Two rules run through every case below, and both are about NEVER emitting junk into an attribute:
 *   1. Arithmetic returns a FINITE number or 0 — never NaN, never Infinity.
 *   2. A garbage COUNT leaves the list unchanged rather than emptying it. An over-long list is visible;
 *      an empty one reads as "no posts yet" and is silently wrong.
 */

const list = (n: number): TemplateContext => ({ page: { items: Array.from({ length: n }, (_, i) => `i${i}`) } });
const each = (tpl: string, ctx: TemplateContext): string => renderTemplate(`{{#each ${tpl}}}[{{this}}]{{/each}}`, ctx);

describe('list windowing', () => {
  describe('{{sw-slice}}', () => {
    it('takes a [start, end) window — Array.prototype.slice semantics, the one meaning the name has', () => {
      expect(each('(sw-slice page.items 2 5)', list(8))).toBe('[i2][i3][i4]');
      expect(each('(sw-slice page.items 6)', list(8))).toBe('[i6][i7]'); // no end → to the end
    });

    it('counts a NEGATIVE index from the end, so "the latest 3" is one call', () => {
      expect(each('(sw-slice page.items -3)', list(8))).toBe('[i5][i6][i7]');
      expect(each('(sw-slice page.items 0 -6)', list(8))).toBe('[i0][i1]');
    });

    it('is empty for an out-of-range or inverted window, not an error', () => {
      expect(each('(sw-slice page.items 50 60)', list(8))).toBe('');
      expect(each('(sw-slice page.items 5 2)', list(8))).toBe('');
    });

    it('yields nothing for a non-array — a missing binding must not throw mid-render', () => {
      for (const src of ['page.nope', 'page.title', 'page.obj']) {
        expect(each(`(sw-slice ${src} 0 2)`, { page: { title: 'Home', obj: { a: 1 } } })).toBe('');
      }
    });
  });

  describe('{{sw-limit}} / {{sw-offset}}', () => {
    it('takes the first N / drops the first N', () => {
      expect(each('(sw-limit page.items 3)', list(8))).toBe('[i0][i1][i2]');
      expect(each('(sw-offset page.items 6)', list(8))).toBe('[i6][i7]');
    });

    it('composes into a window: offset then limit', () => {
      expect(each('(sw-limit (sw-offset page.items 3) 2)', list(8))).toBe('[i3][i4]');
    });

    it('★ a MISSING count leaves the list intact rather than emptying it', () => {
      // The silent-wrong-answer guard. `{{sw-limit posts page.data.per_page}}` with per_page unset must
      // render an obviously-too-long list, not an empty archive that reads as "no posts".
      expect(each('(sw-limit page.items page.nope)', list(3))).toBe('[i0][i1][i2]');
      expect(each('(sw-offset page.items page.nope)', list(3))).toBe('[i0][i1][i2]');
      expect(each('(sw-limit page.items "junk")', list(3))).toBe('[i0][i1][i2]');
    });

    it('an EXPLICIT zero/negative limit is still zero — only garbage falls back', () => {
      expect(each('(sw-limit page.items 0)', list(3))).toBe('');
      expect(each('(sw-limit page.items -2)', list(3))).toBe('');
      expect(each('(sw-offset page.items 99)', list(3))).toBe('');
    });

    it('★ takes a COUNT, not a position: a negative offset is 0, unlike sw-slice', () => {
      // The two sit next to each other with opposite readings of a negative number, so pin it: N here
      // answers "how many", and (sw-slice list start) answers "from where". "All but the last three" is
      // therefore a SLICE — writing it as an offset silently renders the whole list.
      expect(each('(sw-offset page.items -3)', list(5))).toBe('[i0][i1][i2][i3][i4]');
      expect(each('(sw-slice page.items 0 -3)', list(5))).toBe('[i0][i1]');
    });

    it('reads a numeric STRING, because a control-bound page.data value arrives as text', () => {
      expect(each('(sw-limit page.items page.per)', { page: { items: ['a', 'b', 'c'], per: '2' } })).toBe('[a][b]');
    });
  });

  describe('{{sw-paginate}} — the pagination primitive', () => {
    it('takes the Nth window of `per` items, 1-based like the page number an author writes', () => {
      expect(each('(sw-paginate page.items 1 3)', list(8))).toBe('[i0][i1][i2]');
      expect(each('(sw-paginate page.items 2 3)', list(8))).toBe('[i3][i4][i5]');
      expect(each('(sw-paginate page.items 3 3)', list(8))).toBe('[i6][i7]'); // short last page
      expect(each('(sw-paginate page.items 4 3)', list(8))).toBe(''); // past the end
    });

    it('treats page 0 / a negative / a missing number as page 1', () => {
      for (const n of ['0', '-4', 'page.nope']) {
        expect(each(`(sw-paginate page.items ${n} 3)`, list(8))).toBe('[i0][i1][i2]');
      }
    });

    it('leaves the list intact when `per` is missing — never an empty archive', () => {
      expect(each('(sw-paginate page.items 1 page.nope)', list(3))).toBe('[i0][i1][i2]');
    });
  });

  describe('{{sw-length}}', () => {
    it('counts an array, a string, and an object’s keys', () => {
      expect(renderTemplate('{{sw-length page.items}}', list(8))).toBe('8');
      expect(renderTemplate('{{sw-length page.t}}', { page: { t: 'abcd' } })).toBe('4');
      expect(renderTemplate('{{sw-length page.o}}', { page: { o: { a: 1, b: 2 } } })).toBe('2');
    });

    it('is 0 for a missing value, so a "N of M" line never renders NaN', () => {
      expect(renderTemplate('{{sw-length page.nope}}', { page: {} })).toBe('0');
      expect(renderTemplate('{{sw-length}}', {})).toBe('0');
    });
  });

  it('★ keeps dataset ENTRIES flattening through the window', () => {
    // {{#each}} is dataset-aware: iterating entries binds their FIELDS, not the envelope. A windowed
    // array must stay a recognisable entry array or `{{title}}` silently renders empty.
    const entries = Array.from({ length: 4 }, (_, i) => ({
      id: `e${i}`,
      dataset: 'news',
      status: 'published',
      values: { title: `T${i}` },
    }));
    expect(renderTemplate('{{#each (sw-paginate dataset.news 2 2)}}[{{title}}@{{@index}}]{{/each}}', { dataset: { news: entries } })).toBe(
      '[T2@0][T3@1]',
    );
  });
});

describe('arithmetic', () => {
  const n = (tpl: string, ctx: TemplateContext = {}): string => renderTemplate(tpl, ctx);

  it('adds, subtracts, multiplies, divides and takes a remainder', () => {
    expect(n('{{sw-add 2 3}}')).toBe('5');
    expect(n('{{sw-sub 9 4}}')).toBe('5');
    expect(n('{{sw-mul 6 7}}')).toBe('42');
    expect(n('{{sw-div 84 2}}')).toBe('42');
    expect(n('{{sw-mod 17 5}}')).toBe('2');
  });

  it('rounds up, down, to nearest, and to a number of decimals', () => {
    expect(n('{{sw-ceil 2.1}}')).toBe('3');
    expect(n('{{sw-floor 2.9}}')).toBe('2');
    expect(n('{{sw-round 2.5}}')).toBe('3');
    expect(n('{{sw-round 2.345 2}}')).toBe('2.35');
  });

  it('takes a min/max across any number of arguments', () => {
    expect(n('{{sw-min 5 2 9}}')).toBe('2');
    expect(n('{{sw-max 5 2 9}}')).toBe('9');
    expect(n('{{sw-min 5}}')).toBe('5');
  });

  it('★ NEVER emits NaN or Infinity — an attribute would carry it as invisible garbage', () => {
    for (const tpl of [
      '{{sw-add page.nope 1}}',
      '{{sw-mul "x" 3}}',
      '{{sw-sub page.o 1}}',
      '{{sw-div 1 0}}',
      '{{sw-mod 1 0}}',
      '{{sw-round page.nope}}',
      '{{sw-min}}',
      '{{sw-max}}',
      '{{sw-ceil "abc"}}',
    ]) {
      const out = renderTemplate(tpl, { page: { o: { a: 1 } } });
      expect(out, tpl).toMatch(/^-?\d+(\.\d+)?$/);
      expect(Number.isFinite(Number(out)), tpl).toBe(true);
    }
    // A product that overflows the float range is 0, not the literal text "Infinity".
    expect(n('{{sw-mul 1e308 1e308}}')).toBe('0');
  });

  it('reads numeric STRINGS, because page.data and control-bound values arrive as text', () => {
    expect(renderTemplate('{{sw-add page.a page.b}}', { page: { a: '10', b: '5' } })).toBe('15');
    expect(renderTemplate('{{sw-mul page.a 2}}', { page: { a: ' 3 ' } })).toBe('6');
    // …but an EMPTY string is a missing value, not 0 dressed up — it must not silently become 0 + x.
    expect(renderTemplate('{{sw-add page.a 5}}', { page: { a: '' } })).toBe('5');
  });

  it('computes a page count and an item number — the two sums a paginated archive needs', () => {
    // ceil(total / per)
    expect(renderTemplate('{{sw-ceil (sw-div page.total page.per)}}', { page: { total: 831, per: 10 } })).toBe('84');
    // The absolute item number inside a windowed loop. @index restarts at 0 in every window, so the
    // running number is (pageNo - 1) x per + @index + 1 — here page 3 of 2 starts at item 5.
    expect(renderTemplate('{{#each (sw-paginate page.items 3 2)}}[{{sw-add 4 (sw-add @index 1)}}]{{/each}}', list(8))).toBe('[5][6]');
  });
});

describe('comparison', () => {
  it('compares numbers so a prev/next link can be conditional', () => {
    const ctx = { page: { at: 3, last: 8 } };
    expect(renderTemplate('{{#if (sw-lt page.at page.last)}}next{{/if}}', ctx)).toBe('next');
    expect(renderTemplate('{{#if (sw-gt page.at 1)}}prev{{/if}}', ctx)).toBe('prev');
    expect(renderTemplate('{{#if (sw-gte page.at 3)}}y{{/if}}', ctx)).toBe('y');
    expect(renderTemplate('{{#if (sw-lte page.at 3)}}y{{/if}}', ctx)).toBe('y');
    expect(renderTemplate('{{#if (sw-gt page.at page.last)}}no{{/if}}', ctx)).toBe('');
  });

  it('is FALSE when either side is not a number, rather than comparing as text', () => {
    // "10" < "9" is true for strings and false for numbers. These are numeric comparators; a
    // non-numeric operand yields false instead of an answer that depends on how it was typed.
    for (const tpl of ['(sw-lt page.nope 3)', '(sw-gt "abc" 3)', '(sw-lte page.o 3)']) {
      expect(renderTemplate(`{{#if ${tpl}}}y{{else}}n{{/if}}`, { page: { o: {} } })).toBe('n');
    }
    // A numeric string still compares NUMERICALLY.
    expect(renderTemplate('{{#if (sw-lt page.a page.b)}}y{{else}}n{{/if}}', { page: { a: '9', b: '10' } })).toBe('y');
  });
});

describe('the reference stays pinned to what ships', () => {
  it('registers every new helper under the sw- namespace', () => {
    const names = registeredSwHelpers();
    for (const h of [
      'sw-slice',
      'sw-limit',
      'sw-offset',
      'sw-paginate',
      'sw-length',
      'sw-add',
      'sw-sub',
      'sw-mul',
      'sw-div',
      'sw-mod',
      'sw-round',
      'sw-ceil',
      'sw-floor',
      'sw-min',
      'sw-max',
      'sw-lt',
      'sw-gt',
      'sw-lte',
      'sw-gte',
    ]) {
      expect(names, h).toContain(h);
    }
  });
});
