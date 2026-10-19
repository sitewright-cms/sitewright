import { describe, it, expect } from 'vitest';
import { extractClassNames } from '../src/index.js';

// ★ A HANDLEBARS EXPRESSION INSIDE A CLASS ATTRIBUTE MAY CARRY QUOTES OF ITS OWN.
//
// An agent wrote `<div class="p-6 {{#if (eq phase "dusk")}}bg-orange-500{{/if}}">`. The editor preview looked
// right (it compiles Tailwind from the RENDERED page), but the published site showed the block unstyled: the
// publish build reads class names from the page SOURCE, and the `"` around "dusk" ended the attribute for the
// extractor, so `bg-orange-500` was never a candidate and never compiled. The scan has to read a class value the
// way Handlebars does — a `{{…}}` is one unit, whatever quotes are inside it.

describe('extractClassNames — Handlebars expressions inside class attributes', () => {
  it('★ finds the class inside an {{#if}} whose helper call uses the SAME quote as the attribute', () => {
    const classes = extractClassNames('<div class="p-6 {{#if (eq phase "dusk")}}bg-orange-500{{/if}}">x</div>');
    expect(classes).toEqual(expect.arrayContaining(['p-6', 'bg-orange-500']));
  });

  it('does the same for a single-quoted attribute with a single-quoted helper argument', () => {
    const classes = extractClassNames("<div class='p-6 {{#if (eq phase 'dusk')}}bg-orange-500{{/if}}'>x</div>");
    expect(classes).toEqual(expect.arrayContaining(['p-6', 'bg-orange-500']));
  });

  it('reads every branch: {{else}}, {{else if}}, {{#unless}} and nesting', () => {
    const classes = extractClassNames(
      '<a class="btn {{#if a}}{{#unless (eq b "x")}}btn-primary{{else}}btn-ghost{{/unless}}' +
        '{{else if (eq c "y")}}btn-accent{{else}}btn-neutral{{/if}} w-full">x</a>',
    );
    expect(classes).toEqual(
      expect.arrayContaining(['btn', 'btn-primary', 'btn-ghost', 'btn-accent', 'btn-neutral', 'w-full']),
    );
  });

  it('reads the canonical active-link pattern — {{#if (sw-active "/about")}}', () => {
    const classes = extractClassNames('<a href="/about" class="link {{#if (sw-active "/about")}}active font-bold{{/if}}">About</a>');
    expect(classes).toEqual(expect.arrayContaining(['link', 'active', 'font-bold']));
  });

  it('never turns a CONDITION into a candidate: comparison values and paths stay out', () => {
    const classes = extractClassNames('<a class="link {{#if (sw-active "/about")}}active{{else if (eq tone "grid")}}x{{/if}}">A</a>');
    expect(classes).not.toContain('/about');
    expect(classes).not.toContain('grid'); // a block helper's argument is never rendered into the class
  });

  it('takes the string arguments of an OUTPUT expression — they are what renders into the class', () => {
    const classes = extractClassNames('<section class="{{sw-default page.data.bg "bg-base-200 text-base-content"}} p-4">x</section>');
    expect(classes).toEqual(expect.arrayContaining(['bg-base-200', 'text-base-content', 'p-4']));
  });

  it('leaves no Handlebars syntax in any token, and keeps reading the attributes that follow', () => {
    const classes = extractClassNames(
      '<div class="a {{#if (eq x "y")}}b{{/if}}"><span class="c">x</span><p class=\'d {{#if z}}e{{/if}}\'>y</p></div>',
    );
    expect(classes).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('handles a triple-stash, a comment and a whitespace-controlled tag inside the value', () => {
    const classes = extractClassNames(
      '<div class="a {{{raw}}} {{!-- note "quoted" --}} {{~#if x~}} b {{~/if~}} {{! "short" }} c">x</div>',
    );
    expect(classes).toEqual(['a', 'b', 'c']);
  });

  it('honours an escaped quote inside a helper string literal', () => {
    const classes = extractClassNames('<div class="a {{#if (eq x "say \\"hi\\"")}}b{{/if}} c">x</div>');
    expect(classes).toEqual(['a', 'b', 'c']);
  });

  it('still reads the class= HASH argument of a helper (sw-form / sw-add-to-cart)', () => {
    expect(extractClassNames('{{sw-form "contact" class="space-y-4 max-w-md"}}')).toEqual(['space-y-4', 'max-w-md']);
  });

  it('a malformed expression degrades to the old reading and never swallows the rest of the page', () => {
    const classes = extractClassNames('<div class="a {{oops">x</div><p class="b">y</p>');
    expect(classes).toContain('a');
    expect(classes).toContain('b');
    expect(classes.some((c) => c.includes('{{') || c.includes('}}'))).toBe(false);
  });

  it('the fallback still drops a COMPLETE expression and a lone `}` from the plain reading', () => {
    // `{{b}}` closes, `{{c}` does not, and the trailing `{{oops"` never does — the whole value is malformed.
    const classes = extractClassNames('<div class="a {{b}} x{{c} y {{oops">z</div><p class="d">y</p>');
    expect(classes).toEqual(['a', 'y', 'd']);
  });

  it('a value too long to read as a template falls back to the plain reading', () => {
    const long = `${'w '.repeat(2_100)}`; // > the 4 KB templated window
    const classes = extractClassNames(`<div class="first {{#if x}}second{{/if}} ${long}last">x</div><p class="after">y</p>`);
    expect(classes).toEqual(expect.arrayContaining(['first', 'second', 'w', 'last', 'after']));
  });

  it('stays linear on adversarial input (a 256 KB source of unterminated expressions)', () => {
    const t0 = performance.now();
    extractClassNames('<a class="{{x "'.repeat(20_000));
    extractClassNames('class="{{'.repeat(28_000));
    extractClassNames(`<a class="${'{{'.repeat(130_000)}">`);
    // A flood of unterminated comments: each used to search for `--}}` to the END of the input.
    extractClassNames('<a class="x {{!--'.repeat(65_000));
    extractClassNames(`<a class="${'{{! '.repeat(260_000)}`);
    // A quadratic reading of the first input runs for minutes; the bound is generous for a loaded CI box.
    expect(performance.now() - t0).toBeLessThan(5_000);
  });

  it('a comment that closes beyond the templated window is not read past it', () => {
    const far = `<div class="a {{!-- ${'x'.repeat(5_000)} --}} b">x</div><p class="c">y</p>`;
    const classes = extractClassNames(far);
    expect(classes).toEqual(expect.arrayContaining(['a', 'c']));
  });
});
