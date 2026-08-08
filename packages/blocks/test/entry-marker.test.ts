import { describe, it, expect } from 'vitest';
import { markEntry, markEntryInPlace, wrapEntry } from '../src/entry-marker.js';

/**
 * The contract this module exists for: a marked row is the UNMARKED row plus two attributes — no
 * element added, moved, or re-serialized. Everything below either asserts that byte-for-byte, or
 * asserts the narrow set of rows that legitimately fall back to the wrapper.
 */
const strip = (html: string) => html.replace(/ data-sw-(?:entry|dataset)="[^"]*"/g, '');

describe('markEntryInPlace — marks the row, changes nothing else', () => {
  it('stamps a single root element and leaves its attributes untouched', () => {
    expect(markEntryInPlace('<div class="card">A</div>', 'e1', 'posts')).toBe('<div data-sw-entry="e1" data-sw-dataset="posts" class="card">A</div>');
  });

  it('stamps every top-level element of a multi-root row', () => {
    expect(markEntryInPlace('<dt>k</dt><dd>v</dd>', 'e1', 'posts')).toBe(
      '<dt data-sw-entry="e1" data-sw-dataset="posts">k</dt><dd data-sw-entry="e1" data-sw-dataset="posts">v</dd>',
    );
  });

  it('does not descend — a nested element of the same name is left alone', () => {
    expect(markEntryInPlace('<div><div>inner</div></div>', 'e1', 'posts')).toBe('<div data-sw-entry="e1" data-sw-dataset="posts"><div>inner</div></div>');
  });

  it('preserves leading/trailing whitespace exactly (it is real text in the published page)', () => {
    expect(markEntryInPlace('\n  <li>A</li>\n', 'e1', 'posts')).toBe('\n  <li data-sw-entry="e1" data-sw-dataset="posts">A</li>\n');
  });

  // Round-tripping the row through a serializer would rewrite all of these. Splicing does not.
  it.each([
    ['unquoted + single-quoted attributes', "<div class=card data-x='1'>A</div>"],
    ['a boolean attribute', '<input disabled value="v">'],
    ['an uppercase tag name', '<DIV CLASS="c">A</DIV>'],
    ['an entity in the body', '<p>a &amp; b &nbsp; c</p>'],
    ['self-closing foreign content', '<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>'],
    ['a raw-text element containing markup', '<script>var a = "<div>";</script>'],
    ['an HTML comment inside', '<div><!-- keep me --><b>A</b></div>'],
  ])('leaves the row byte-identical apart from the markers: %s', (_label, html) => {
    const marked = markEntryInPlace(html, 'e1', 'posts');
    expect(marked).not.toBeNull();
    expect(strip(marked as string)).toBe(html);
  });

  it('marks void elements without inventing a close tag', () => {
    expect(markEntryInPlace('<br><img src="a.png">', 'e1', 'posts')).toBe(
      '<br data-sw-entry="e1" data-sw-dataset="posts"><img data-sw-entry="e1" data-sw-dataset="posts" src="a.png">',
    );
  });

  // `<li>a<li>b` is two SIBLINGS (the first close is implied) — the parser knows that, a tag-counting
  // scanner would not, which is the entire reason this uses htmlparser2 rather than a regex.
  it('treats an implied close as ending the element', () => {
    expect(markEntryInPlace('<li>a<li>b', 'e1', 'posts')).toBe(
      '<li data-sw-entry="e1" data-sw-dataset="posts">a<li data-sw-entry="e1" data-sw-dataset="posts">b',
    );
  });

  it('escapes the id and dataset into the attribute', () => {
    expect(markEntryInPlace('<div>A</div>', 'a"><script>x', 'p&p')).toBe('<div data-sw-entry="a&quot;&gt;&lt;script&gt;x" data-sw-dataset="p&amp;p">A</div>');
  });
});

describe('markEntryInPlace — the rows that must keep the wrapper (returns null)', () => {
  it.each([
    ['an empty row', ''],
    ['whitespace only', '   \n '],
    ['bare text', 'Just a title'],
    ['text mixed with elements at the top level', 'Hi <b>there</b>'],
    ['text AFTER an element', '<b>there</b> — hi'],
    // Marking again would duplicate the attribute and silently retarget the inner entry to the outer one.
    ['a root that is already marked', '<div data-sw-entry="inner" data-sw-dataset="d">A</div>'],
    // An orphan close leaves the text at the top level, which is a wrapper case for the usual reason.
    ['an orphan close tag followed by text', '</b>hello'],
  ])('returns null for %s', (_label, html) => {
    expect(markEntryInPlace(html, 'e1', 'posts')).toBeNull();
  });

  it('marks a row whose FIRST child is a comment (a comment is not text)', () => {
    expect(markEntryInPlace('<!-- c --><div>A</div>', 'e1', 'posts')).toBe('<!-- c --><div data-sw-entry="e1" data-sw-dataset="posts">A</div>');
  });

  // htmlparser2 DROPS an orphan close tag, exactly as a browser does when parsing the same fragment —
  // so the element that survives into the DOM is the one that gets marked, and the two agree.
  it('ignores an orphan close tag and marks the element that actually renders', () => {
    expect(markEntryInPlace('</div><span>A</span>', 'e1', 'posts')).toBe('</div><span data-sw-entry="e1" data-sw-dataset="posts">A</span>');
  });
});

describe('markEntry — in place, else the wrapper', () => {
  it('uses the element when there is one', () => {
    expect(markEntry('<li>A</li>', 'e1', 'posts')).toBe('<li data-sw-entry="e1" data-sw-dataset="posts">A</li>');
  });
  it('falls back to the wrapper when there is not', () => {
    expect(markEntry('A', 'e1', 'posts')).toBe(wrapEntry('A', 'e1', 'posts'));
    expect(wrapEntry('A', 'e1', 'posts')).toBe('<div data-sw-entry="e1" data-sw-dataset="posts">A</div>');
  });
});
