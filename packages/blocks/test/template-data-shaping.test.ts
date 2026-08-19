import { describe, it, expect } from 'vitest';
import { renderTemplate, registeredSwHelpers, type TemplateContext } from '../src/template.js';

/**
 * DATA SHAPING + STRING BUILDING.
 *
 * Every helper here exists because a real template could not express something and had no workaround.
 * The two that cost the most:
 *
 *   1. **No string concatenation.** Handlebars has no `+`, so an author cannot build `"/news-" + n`,
 *      `"icon-" + name`, or `"col-span-" + width`. The observed outcome is not a compile error — it is
 *      a HARD-CODED literal. A paginated archive shipped `href="/news-{{sw-add n 1}}"`, a root path
 *      that no locale prefix ever reaches, so every German page linked into the English archive.
 *
 *   2. **No predicate filtering.** `sw-limit`/`sw-slice` window a list by POSITION only. "The events
 *      that are still ahead" is not a position, so a homepage "Coming up" column rendered the first
 *      four rows by insertion order — seven months in the past — and there was no helper of any kind
 *      that could compare a date. `sw-lt`/`sw-gt` are number-only by design, and ISO dates are strings.
 *
 * Rules that run through all of them:
 *   • A list helper given a non-list returns an EMPTY list, never junk, and never the input unchanged.
 *   • A filter that matches nothing returns empty — the caller's `{{#if}}`/`{{else}}` is the affordance.
 *   • Comparison is type-directed: two numeric operands compare numerically, otherwise as strings, so
 *     ISO dates ("2026-08-21") order correctly without the author having to know they are strings.
 */

const ctx = (data: Record<string, unknown>): TemplateContext => ({ page: { data } });
const each = (expr: string, data: Record<string, unknown>, body = '[{{this}}]'): string =>
  renderTemplate(`{{#each ${expr}}}${body}{{/each}}`, ctx(data));

const EVENTS = [
  { title: 'Term starts', starts: '2026-01-19', category: 'term_date', seats: 0 },
  { title: 'Big Walk', starts: '2026-06-13', category: 'sport', seats: 120 },
  { title: 'Bazaar', starts: '2026-08-21', category: 'event', seats: 90 },
  { title: 'Orals', starts: '2026-10-28', category: 'exam', seats: 12 },
];

describe('{{sw-concat}} — build a string', () => {
  it('joins every argument, so an author can compose a URL, an id or a class', () => {
    expect(renderTemplate("{{sw-concat '/news-' 3}}", {})).toBe('/news-3');
    expect(renderTemplate("{{sw-concat 'icon-' page.data.name '-bold'}}", ctx({ name: 'gear' }))).toBe('icon-gear-bold');
  });

  it('composes with the other helpers — this is the pagination link that used to be hard-coded', () => {
    expect(renderTemplate("{{sw-url (sw-concat '/news-' (sw-add page.data.n 1))}}", ctx({ n: 2 }))).toBe('/news-3');
  });

  it('skips null/undefined rather than printing "null", and stringifies numbers and booleans', () => {
    expect(renderTemplate('{{sw-concat page.data.a page.data.missing page.data.b}}', ctx({ a: 'x', b: 'y' }))).toBe('xy');
    expect(renderTemplate('{{sw-concat 1 2 true}}', {})).toBe('12true');
  });

  it('is ESCAPED like every other string helper, so it is safe in an attribute', () => {
    expect(renderTemplate("{{sw-concat '<b>' page.data.t}}", ctx({ t: '"x"' }))).toBe('&lt;b&gt;&quot;x&quot;');
  });

  it('with no arguments is empty, not the word "undefined"', () => {
    expect(renderTemplate('{{sw-concat}}', {})).toBe('');
  });
});

describe('{{sw-default}} — the first value that is actually there', () => {
  it('falls through empty string, null and undefined to the next argument', () => {
    expect(renderTemplate("{{sw-default page.data.missing 'fallback'}}", ctx({}))).toBe('fallback');
    expect(renderTemplate("{{sw-default page.data.blank 'fallback'}}", ctx({ blank: '' }))).toBe('fallback');
    expect(renderTemplate("{{sw-default page.data.t 'fallback'}}", ctx({ t: 'real' }))).toBe('real');
  });

  it('keeps 0 and false — they are values, not absences (the classic `||` bug)', () => {
    expect(renderTemplate("{{sw-default page.data.n 'fallback'}}", ctx({ n: 0 }))).toBe('0');
    expect(renderTemplate("{{sw-default page.data.b 'fallback'}}", ctx({ b: false }))).toBe('false');
  });

  it('takes any number of candidates and is empty when none of them are there', () => {
    expect(renderTemplate("{{sw-default page.data.a page.data.b 'third'}}", ctx({}))).toBe('third');
    expect(renderTemplate('{{sw-default page.data.a page.data.b}}', ctx({}))).toBe('');
  });
});

describe('{{sw-join}} — a list as text', () => {
  it('joins with the given separator, defaulting to ", "', () => {
    expect(renderTemplate('{{sw-join page.data.tags}}', ctx({ tags: ['a', 'b', 'c'] }))).toBe('a, b, c');
    expect(renderTemplate("{{sw-join page.data.tags ' · '}}", ctx({ tags: ['a', 'b'] }))).toBe('a · b');
  });

  it('drops empty entries so a separator never dangles', () => {
    expect(renderTemplate('{{sw-join page.data.tags}}', ctx({ tags: ['a', '', null, 'b'] }))).toBe('a, b');
  });

  it('reads a FIELD off a list of objects via a NAMED argument', () => {
    expect(renderTemplate("{{sw-join page.data.events ', ' field='title'}}", ctx({ events: EVENTS }))).toBe(
      'Term starts, Big Walk, Bazaar, Orals',
    );
  });

  it('takes the field by NAME because a third positional arg is a foot-gun', () => {
    // sw-where/sw-sort/sw-group all put the field SECOND. An author carrying that habit over writes
    // {{sw-join staff 'name' ', '}} — which read 'name' as the separator and ', ' as the field, and
    // since no row has a ', ' field, every value was dropped and the helper rendered EMPTY. Silent.
    // With `field` named, the mistake is now LOUD — the rows stringify visibly instead of vanishing.
    expect(renderTemplate("{{sw-join page.data.s 'name' ', '}}", ctx({ s: [{ name: 'A' }, { name: 'B' }] }))).toContain('[object Object]');
    expect(renderTemplate("{{sw-join page.data.s ', ' field='name'}}", ctx({ s: [{ name: 'A' }, { name: 'B' }] }))).toBe('A, B');
  });

  it('given a non-list is empty', () => {
    expect(renderTemplate('{{sw-join page.data.nope}}', ctx({}))).toBe('');
    expect(renderTemplate('{{sw-join page.data.n}}', ctx({ n: 5 }))).toBe('');
  });
});

describe('{{sw-includes}} — membership', () => {
  it('finds a value in a list and a substring in a string', () => {
    expect(renderTemplate("{{#if (sw-includes page.data.tags 'b')}}Y{{else}}N{{/if}}", ctx({ tags: ['a', 'b'] }))).toBe('Y');
    expect(renderTemplate("{{#if (sw-includes page.data.t 'ell')}}Y{{else}}N{{/if}}", ctx({ t: 'hello' }))).toBe('Y');
  });

  it('is false for a miss and for a non-list/non-string, never throwing', () => {
    expect(renderTemplate("{{#if (sw-includes page.data.tags 'z')}}Y{{else}}N{{/if}}", ctx({ tags: ['a'] }))).toBe('N');
    expect(renderTemplate("{{#if (sw-includes page.data.n 'z')}}Y{{else}}N{{/if}}", ctx({ n: 5 }))).toBe('N');
  });
});

describe('{{sw-where}} — filter a list by a field', () => {
  it('filters on equality, which is how a category page selects its rows', () => {
    expect(each("(sw-where page.data.e 'category' 'eq' 'exam')", { e: EVENTS }, '[{{title}}]')).toBe('[Orals]');
  });

  it('compares ISO DATES correctly — the thing no existing helper could do', () => {
    // sw-lt/sw-gt are number-only by design, so a date comparison had no helper at all.
    expect(each("(sw-where page.data.e 'starts' 'gte' '2026-08-01')", { e: EVENTS }, '[{{title}}]')).toBe('[Bazaar][Orals]');
    expect(each("(sw-where page.data.e 'starts' 'lt' '2026-06-14')", { e: EVENTS }, '[{{title}}]')).toBe('[Term starts][Big Walk]');
  });

  it("accepts the literal 'now' so a template can ask for what is still ahead", () => {
    const past = [{ t: 'old', d: '2000-01-01' }, { t: 'new', d: '2999-01-01' }];
    expect(each("(sw-where page.data.e 'd' 'gte' 'now')", { e: past }, '[{{t}}]')).toBe('[new]');
    expect(each("(sw-where page.data.e 'd' 'lt' 'now')", { e: past }, '[{{t}}]')).toBe('[old]');
  });

  it("compares two ISO values at the COARSER granularity, so a date-only side means the whole day", () => {
    // The platform stores both '2026-08-21' and '2026-08-21T09:00'. Comparing those as raw strings makes
    // the shorter one always sort first, so the answer depended on how the value happened to be typed.
    // Now the comparison uses the shorter operand's granularity — a date-only side means the whole day.
    const rows = [{ t: 'am', d: '2026-08-21T06:00' }, { t: 'pm', d: '2026-08-21T22:00' }, { t: 'next', d: '2026-08-22' }];
    expect(each("(sw-where page.data.e 'd' 'gte' '2026-08-21')", { e: rows }, '[{{t}}]')).toBe('[am][pm][next]');
    expect(each("(sw-where page.data.e 'd' 'lt' '2026-08-22')", { e: rows }, '[{{t}}]')).toBe('[am][pm]');
    // Both sides timed → compared exactly, to the minute.
    expect(each("(sw-where page.data.e 'd' 'gte' '2026-08-21T12:00')", { e: rows }, '[{{t}}]')).toBe('[pm][next]');
  });

  it("'now' is DAY-granular, so anything happening today still counts as ahead all day", () => {
    const today = new Date().toISOString().slice(0, 10);
    const rows = [{ t: 'early', d: `${today}T06:00` }, { t: 'late', d: `${today}T22:00` }, { t: 'gone', d: '2000-01-01' }];
    expect(each("(sw-where page.data.e 'd' 'gte' 'now')", { e: rows }, '[{{t}}]')).toBe('[early][late]');
    expect(each("(sw-where page.data.e 'd' 'lt' 'now')", { e: rows }, '[{{t}}]')).toBe('[gone]');
  });

  it('does NOT apply date granularity to ordinary text — only to ISO-shaped values', () => {
    const rows = [{ t: 'a', s: 'apple' }, { t: 'b', s: 'apples' }];
    expect(each("(sw-where page.data.e 's' 'eq' 'apple')", { e: rows }, '[{{t}}]')).toBe('[a]');
  });

  it('compares NUMBERS numerically, not as text — "9" must not sort above "10"', () => {
    expect(each("(sw-where page.data.e 'seats' 'gt' 89)", { e: EVENTS }, '[{{title}}]')).toBe('[Big Walk][Bazaar]');
    expect(each("(sw-where page.data.e 'seats' 'lte' 12)", { e: EVENTS }, '[{{title}}]')).toBe('[Term starts][Orals]');
  });

  it('supports ne, and `has` for a substring/list-membership field', () => {
    expect(each("(sw-where page.data.e 'category' 'ne' 'exam')", { e: EVENTS }, '[{{title}}]')).toBe(
      '[Term starts][Big Walk][Bazaar]',
    );
    expect(each("(sw-where page.data.e 'title' 'has' 'Walk')", { e: EVENTS }, '[{{title}}]')).toBe('[Big Walk]');
    expect(each("(sw-where page.data.e 'tags' 'has' 'x')", { e: [{ title: 'A', tags: ['x'] }, { title: 'B', tags: ['y'] }] }, '[{{title}}]')).toBe('[A]');
  });

  it('defaults to `eq` when the op is omitted, so the common case is two arguments', () => {
    expect(each("(sw-where page.data.e 'category' 'sport')", { e: EVENTS }, '[{{title}}]')).toBe('[Big Walk]');
  });

  it('an UNKNOWN op matches nothing rather than silently matching everything', () => {
    expect(each("(sw-where page.data.e 'category' 'wat' 'exam')", { e: EVENTS }, '[{{title}}]')).toBe('');
  });

  it('a non-list, a missing field, and a matchless filter are all empty — never the unfiltered list', () => {
    expect(each("(sw-where page.data.nope 'a' 'eq' 'b')", {}, '[{{title}}]')).toBe('');
    expect(each("(sw-where page.data.e 'nofield' 'eq' 'x')", { e: EVENTS }, '[{{title}}]')).toBe('');
    expect(each("(sw-where page.data.e 'category' 'eq' 'nothing')", { e: EVENTS }, '[{{title}}]')).toBe('');
  });

  it('reads a DATASET ENTRY envelope’s values, so it works on `dataset.x` unchanged', () => {
    const entries = EVENTS.map((v, i) => ({ id: `e${i}`, dataset: 'events', values: v }));
    expect(each("(sw-where page.data.e 'category' 'eq' 'sport')", { e: entries }, '[{{title}}]')).toBe('[Big Walk]');
  });

  it('composes with sw-limit — "the next two things" in one expression', () => {
    expect(each("(sw-limit (sw-where page.data.e 'starts' 'gte' '2026-01-01') 2)", { e: EVENTS }, '[{{title}}]')).toBe(
      '[Term starts][Big Walk]',
    );
  });
});

describe('{{sw-sort}} — order a list by a field', () => {
  it('sorts ascending by default and descending on request', () => {
    expect(each("(sw-sort page.data.e 'title')", { e: EVENTS }, '[{{title}}]')).toBe('[Bazaar][Big Walk][Orals][Term starts]');
    expect(each("(sw-sort page.data.e 'title' 'desc')", { e: EVENTS }, '[{{title}}]')).toBe('[Term starts][Orals][Big Walk][Bazaar]');
  });

  it('sorts NUMBERS numerically — the bug a string sort would hide', () => {
    const rows = [{ n: 9 }, { n: 10 }, { n: 100 }];
    expect(each("(sw-sort page.data.e 'n')", { e: rows }, '[{{n}}]')).toBe('[9][10][100]');
  });

  it('sorts ISO dates correctly, which is the same comparison as sw-where', () => {
    expect(each("(sw-sort page.data.e 'starts' 'desc')", { e: EVENTS }, '[{{title}}]')).toBe(
      '[Orals][Bazaar][Big Walk][Term starts]',
    );
  });

  it('does not MUTATE the input list — a second render must see the original order', () => {
    const rows = [{ n: 3 }, { n: 1 }, { n: 2 }];
    const data = { e: rows };
    each("(sw-sort page.data.e 'n')", data, '[{{n}}]');
    expect(rows.map((r) => r.n)).toEqual([3, 1, 2]);
  });

  it('puts rows MISSING the field last instead of scattering them through the order', () => {
    const rows = [{ n: 2 }, {}, { n: 1 }];
    expect(each("(sw-sort page.data.e 'n')", { e: rows }, '[{{#if n}}{{n}}{{else}}-{{/if}}]')).toBe('[1][2][-]');
  });

  it('treats null and "" as MISSING too — a blank dataset field is not "the smallest value"', () => {
    // The absent-key case was covered; null and '' were not. compareValues already calls all three
    // "missing", but the desc override only recognised `undefined`, so a null row sorted FIRST on desc
    // — which reads as data loss, the exact failure the override exists to prevent.
    const nulls = [{ n: null }, { n: 5 }, { n: 1 }];
    expect(each("(sw-sort page.data.e 'n' 'desc')", { e: nulls }, '[{{#if n}}{{n}}{{else}}-{{/if}}]')).toBe('[5][1][-]');
    expect(each("(sw-sort page.data.e 'n')", { e: nulls }, '[{{#if n}}{{n}}{{else}}-{{/if}}]')).toBe('[1][5][-]');
    const blanks = [{ n: '' }, { n: 'zebra' }, { n: 'apple' }];
    expect(each("(sw-sort page.data.e 'n' 'desc')", { e: blanks }, '[{{#if n}}{{n}}{{else}}-{{/if}}]')).toBe('[zebra][apple][-]');
  });

  it('given a non-list is empty', () => {
    expect(each("(sw-sort page.data.nope 'n')", {}, '[{{n}}]')).toBe('');
  });
});

describe('{{sw-group}} — group a list by a field', () => {
  it('yields {key, items} pairs in first-seen order, so a calendar can print month headings', () => {
    const out = renderTemplate(
      "{{#each (sw-group page.data.e 'category')}}<{{key}}:{{sw-length items}}>{{/each}}",
      ctx({ e: EVENTS }),
    );
    expect(out).toBe('<term_date:1><sport:1><event:1><exam:1>');
  });

  it('actually groups when keys repeat', () => {
    const rows = [{ m: 'Jan', t: 'a' }, { m: 'Feb', t: 'b' }, { m: 'Jan', t: 'c' }];
    const out = renderTemplate(
      "{{#each (sw-group page.data.e 'm')}}<{{key}}:{{#each items}}{{t}}{{/each}}>{{/each}}",
      ctx({ e: rows }),
    );
    expect(out).toBe('<Jan:ac><Feb:b>');
  });

  it('drops rows with no value for the field rather than inventing an empty group', () => {
    const rows = [{ m: 'Jan' }, {}, { m: 'Jan' }];
    expect(renderTemplate("{{#each (sw-group page.data.e 'm')}}<{{key}}:{{sw-length items}}>{{/each}}", ctx({ e: rows }))).toBe(
      '<Jan:2>',
    );
  });

  it('given a non-list is empty', () => {
    expect(renderTemplate("{{#each (sw-group page.data.nope 'm')}}<{{key}}>{{/each}}", ctx({}))).toBe('');
  });
});

describe('{{sw-date}} — locale-aware formats', () => {
  const d = { page: { data: { at: '2026-08-21' }, locale: 'de' } } as unknown as TemplateContext;
  const en = { page: { data: { at: '2026-08-21' }, locale: 'en' } } as unknown as TemplateContext;

  it('still returns ISO YYYY-MM-DD by default — the existing behaviour is unchanged', () => {
    expect(renderTemplate('{{sw-date page.data.at}}', d)).toBe('2026-08-21');
    expect(renderTemplate("{{sw-date page.data.at 'YYYY'}}", d)).toBe('2026');
  });

  it('formats for the PAGE locale, so a German page stops printing ISO dates at the reader', () => {
    expect(renderTemplate("{{sw-date page.data.at 'medium'}}", d)).toBe('21. Aug. 2026');
    expect(renderTemplate("{{sw-date page.data.at 'medium'}}", en)).toBe('21 Aug 2026');
  });

  it('offers long and short as well, and takes an explicit locale= override', () => {
    expect(renderTemplate("{{sw-date page.data.at 'long'}}", d)).toBe('21. August 2026');
    expect(renderTemplate("{{sw-date page.data.at 'long'}}", en)).toBe('21 August 2026');
    expect(renderTemplate("{{sw-date page.data.at 'short'}}", d)).toBe('21.08.2026');
    expect(renderTemplate("{{sw-date page.data.at 'short'}}", en)).toBe('21/08/2026');
    expect(renderTemplate("{{sw-date page.data.at 'long' locale='de'}}", en)).toBe('21. August 2026');
  });

  it('falls back to the default locale rather than throwing on an unknown one', () => {
    const weird = { page: { data: { at: '2026-08-21' }, locale: 'zz-ZZ' } } as unknown as TemplateContext;
    expect(renderTemplate("{{sw-date page.data.at 'medium'}}", weird)).toMatch(/2026/);
  });

  it('an unparseable value is still empty in every format', () => {
    expect(renderTemplate("{{sw-date page.data.nope 'medium'}}", d)).toBe('');
  });
});

describe('the helper registry', () => {
  it('lists every new helper, so the reference and the validator cannot drift from the code', () => {
    for (const name of ['sw-concat', 'sw-default', 'sw-join', 'sw-includes', 'sw-where', 'sw-sort', 'sw-group']) {
      expect(registeredSwHelpers()).toContain(name);
    }
  });
});
