import { describe, it, expect } from 'vitest';
import { applyTextEdits, readTextField, writeTextField, TEXT_PATCH_FIELDS } from '../src/repo/text-patch.js';

describe('applyTextEdits', () => {
  it('replaces a unique anchor and reports one replacement', () => {
    expect(applyTextEdits('<h1>Hi</h1><p>x</p>', [{ old: '<h1>Hi</h1>', new: '<h1>Hello</h1>' }])).toEqual({
      ok: true,
      text: '<h1>Hello</h1><p>x</p>',
      replacements: 1,
    });
  });

  it('applies edits in order, each against the result of the one before', () => {
    const res = applyTextEdits('a-b', [
      { old: 'a', new: 'c' },
      { old: 'c-b', new: 'done' },
    ]);
    expect(res).toEqual({ ok: true, text: 'done', replacements: 2 });
  });

  it('refuses an anchor that is not found, naming the edit — and says when an earlier edit is why', () => {
    const first = applyTextEdits('abc', [{ old: 'zzz', new: 'y' }]);
    expect(first).toMatchObject({ ok: false, edit: 0, found: 0 });
    expect(first.ok === false && first.error).toMatch(/edit 1: `old` was not found — copy it exactly/);
    const second = applyTextEdits('abc', [{ old: 'a', new: 'x' }, { old: 'a', new: 'y' }]);
    expect(second.ok === false && second.error).toMatch(/edit 2: .*after the edits before it were applied/);
  });

  it('refuses an ambiguous anchor with its count, instead of guessing which one', () => {
    const res = applyTextEdits('<li>x</li><li>x</li><li>x</li>', [{ old: '<li>x</li>', new: '<li>y</li>' }]);
    expect(res).toMatchObject({ ok: false, edit: 0, found: 3 });
    expect(res.ok === false && res.error).toMatch(/matches 3 times .*all:true/);
  });

  it('treats an OVERLAPPING second match as ambiguous too', () => {
    const res = applyTextEdits('aaa', [{ old: 'aa', new: 'b' }]);
    expect(res).toMatchObject({ ok: false, found: 1 });
    expect(res.ok === false && res.error).toMatch(/more than once \(overlapping\)/);
  });

  it('replaces every occurrence with all:true, counting them', () => {
    expect(applyTextEdits('<img src="a"><img src="b">', [{ old: '<img ', new: '<img loading="lazy" ', all: true }])).toEqual({
      ok: true,
      text: '<img loading="lazy" src="a"><img loading="lazy" src="b">',
      replacements: 2,
    });
  });

  it('is literal: regex metacharacters and $-patterns in either side are plain text', () => {
    expect(applyTextEdits('price: (x)', [{ old: '(x)', new: '$& $1 $$' }])).toEqual({ ok: true, text: 'price: $& $1 $$', replacements: 1 });
  });

  it('deletes with an empty replacement, and refuses an empty anchor', () => {
    expect(applyTextEdits('keep<b>drop</b>', [{ old: '<b>drop</b>', new: '' }])).toMatchObject({ ok: true, text: 'keep' });
    expect(applyTextEdits('x', [{ old: '', new: 'y' }])).toMatchObject({ ok: false, edit: 0 });
  });

  it('is all-or-nothing: a failing later edit returns no text at all', () => {
    const res = applyTextEdits('abc', [{ old: 'a', new: 'x' }, { old: 'nope', new: 'y' }]);
    expect(res.ok).toBe(false);
    expect('text' in res).toBe(false);
  });
});

describe('text fields', () => {
  it('reads a dotted path, treating absent or non-string as empty', () => {
    expect(readTextField({ website: { footer: '<p>f</p>' } }, 'website.footer')).toBe('<p>f</p>');
    expect(readTextField({ website: {} }, 'website.footer')).toBe('');
    expect(readTextField({ source: 42 }, 'source')).toBe('');
    expect(readTextField(null, 'source')).toBe('');
  });

  it('writes a dotted path on a COPY, keeping every sibling', () => {
    const before = { identity: { name: 'Acme' }, website: { footer: 'old', mainNav: 'nav' } };
    const after = writeTextField(before, 'website.footer', 'new');
    expect(after).toEqual({ identity: { name: 'Acme' }, website: { footer: 'new', mainNav: 'nav' } });
    expect(before.website.footer).toBe('old'); // the stored value is never mutated
    expect(writeTextField({ id: 'p' }, 'source', 's')).toEqual({ id: 'p', source: 's' });
    expect(writeTextField({}, 'website.footer', 'f')).toEqual({ website: { footer: 'f' } });
  });

  it('allows only the long text fields, never operator-only raw HTML', () => {
    expect(TEXT_PATCH_FIELDS.settings).not.toContain('website.head');
    expect(TEXT_PATCH_FIELDS.settings).not.toContain('website.scripts');
    expect(TEXT_PATCH_FIELDS.page).toEqual(['source']);
  });
});
