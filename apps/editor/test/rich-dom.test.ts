import { describe, it, expect, vi } from 'vitest';
import { RICH_COLOR_CLASSES, RICH_SIZE_CLASSES, RICH_ALIGN_CLASSES } from '@sitewright/blocks';
import { applyInlineClass, applyBlockClass, stepBlockIndent, applyLink, insertImage, updateImage, currentAnchor } from '../src/lib/rich-dom';

/** A contentEditable with its inner <p> contents selected — the common toolbar case. */
function editableSelectingP(html: string): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('contenteditable', 'true');
  el.innerHTML = html;
  document.body.appendChild(el);
  const p = el.querySelector('p') ?? el;
  const range = document.createRange();
  range.selectNodeContents(p);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  return el;
}

describe('rich-dom class application', () => {
  it('applyInlineClass wraps the selection in a span carrying the utility class', () => {
    const el = editableSelectingP('<p>hello</p>');
    applyInlineClass(el, RICH_COLOR_CLASSES, 'text-red-600');
    expect(el.querySelector('p')?.innerHTML).toContain('class="text-red-600"');
    expect(el.textContent).toBe('hello');
  });

  it('applyInlineClass replaces an existing same-group class (no stacking)', () => {
    const el = editableSelectingP('<p><span class="text-blue-600">hi</span></p>');
    // Re-select the inner span's contents.
    const span = el.querySelector('span')!;
    const range = document.createRange();
    range.selectNodeContents(span);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    applyInlineClass(el, RICH_COLOR_CLASSES, 'text-green-600');
    const html = el.querySelector('p')!.innerHTML;
    expect(html).toContain('text-green-600');
    expect(html).not.toContain('text-blue-600');
  });

  it('applyInlineClass with an empty class clears the group (unwraps)', () => {
    const el = editableSelectingP('<p>hello</p>');
    applyInlineClass(el, RICH_SIZE_CLASSES, 'text-lg');
    expect(el.querySelector('p')!.innerHTML).toContain('text-lg');
    // Re-select all and clear.
    const p = el.querySelector('p')!;
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    applyInlineClass(el, RICH_SIZE_CLASSES, '');
    expect(el.querySelector('p')!.innerHTML).not.toContain('text-lg');
    expect(el.textContent).toBe('hello');
  });

  it('applyBlockClass sets an alignment class on the enclosing block', () => {
    const el = editableSelectingP('<p>hello</p>');
    applyBlockClass(el, RICH_ALIGN_CLASSES, 'text-center');
    expect(el.querySelector('p')!.getAttribute('class')).toBe('text-center');
    // Re-align → replaces, never stacks.
    const range = document.createRange();
    range.selectNodeContents(el.querySelector('p')!);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    applyBlockClass(el, RICH_ALIGN_CLASSES, 'text-right');
    expect(el.querySelector('p')!.getAttribute('class')).toBe('text-right');
  });

  it('applyLink scheme-sanitizes the URL (drops javascript:, keeps http/relative)', () => {
    // jsdom has no document.execCommand, so install a mock + assert on WHICH command applyLink dispatches.
    const el = editableSelectingP('<p>link me</p>');
    const spy = vi.fn(() => true);
    const doc = document as unknown as { execCommand?: unknown };
    const orig = doc.execCommand;
    doc.execCommand = spy;
    // Re-establish a fresh non-collapsed selection before each createLink case (the mock execCommand doesn't
    // actually wrap the text, and runExec's focus() collapses the selection, so it must be reset per case).
    const reselect = () => {
      const p = el.querySelector('p')!;
      const r = document.createRange();
      r.selectNodeContents(p);
      const s = window.getSelection()!;
      s.removeAllRanges();
      s.addRange(r);
    };
    try {
      applyLink(el, 'javascript:alert(document.cookie)');
      // No existing anchor + dangerous URL → nothing happens (no link created, nothing to unlink).
      expect(spy).not.toHaveBeenCalledWith('createLink', false, expect.stringContaining('javascript'));
      spy.mockClear();
      reselect();
      applyLink(el, 'https://ok.test/path');
      expect(spy).toHaveBeenCalledWith('createLink', false, 'https://ok.test/path');
      spy.mockClear();
      reselect();
      applyLink(el, '/about');
      expect(spy).toHaveBeenCalledWith('createLink', false, '/about');
    } finally {
      doc.execCommand = orig;
    }
  });

  it('applyLink edits an existing anchor in place (href + new tab), never nesting', () => {
    const el = document.createElement('div');
    el.setAttribute('contenteditable', 'true');
    el.innerHTML = '<p><a href="/old">click</a></p>';
    document.body.appendChild(el);
    const a = el.querySelector('a')!;
    const range = document.createRange();
    range.selectNodeContents(a);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    applyLink(el, 'https://new.test', true);
    expect(el.querySelectorAll('a')).toHaveLength(1); // in place, not nested
    expect(el.querySelector('a')!.getAttribute('href')).toBe('https://new.test');
    expect(el.querySelector('a')!.getAttribute('target')).toBe('_blank');
    expect(el.querySelector('a')!.getAttribute('rel')).toBe('noopener noreferrer');
    applyLink(el, 'https://new.test', false); // toggle new-tab off
    expect(el.querySelector('a')!.hasAttribute('target')).toBe(false);
    expect(el.querySelector('a')!.hasAttribute('rel')).toBe(false);
  });

  it('currentAnchor returns null when the selection is outside the editable', () => {
    const el = document.createElement('div');
    el.setAttribute('contenteditable', 'true');
    el.innerHTML = '<p><a href="/x">y</a></p>';
    document.body.appendChild(el);
    const outside = document.createElement('div');
    outside.textContent = 'chrome';
    document.body.appendChild(outside);
    const range = document.createRange();
    range.selectNodeContents(outside);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    expect(currentAnchor(el)).toBeNull(); // selection not in `el` → no anchor, never page-chrome anchors
  });

  it('applyLink on a collapsed caret inserts a NEW link with the URL as its text', () => {
    const el = document.createElement('div');
    el.setAttribute('contenteditable', 'true');
    el.innerHTML = '<p>before</p>';
    document.body.appendChild(el);
    const p = el.querySelector('p')!;
    const range = document.createRange();
    range.setStart(p.firstChild!, 6);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    applyLink(el, 'https://x.test', false);
    const a = el.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://x.test');
    expect(a.textContent).toBe('https://x.test');
  });

  it('applyLink drops a dangerous URL (no anchor created)', () => {
    const el = document.createElement('div');
    el.setAttribute('contenteditable', 'true');
    el.innerHTML = '<p>hi</p>';
    document.body.appendChild(el);
    const p = el.querySelector('p')!;
    const range = document.createRange();
    range.setStart(p.firstChild!, 2);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    applyLink(el, 'javascript:alert(1)', false);
    expect(el.querySelector('a')).toBeNull();
  });

  it('insertImage inserts a sanitized <img> at the saved range; drops a dangerous src', () => {
    const el = document.createElement('div');
    el.setAttribute('contenteditable', 'true');
    el.innerHTML = '<p>ab</p>';
    document.body.appendChild(el);
    const p = el.querySelector('p')!;
    const range = document.createRange();
    range.setStart(p.firstChild!, 1);
    range.collapse(true);
    insertImage(el, { url: '/media/x.jpg', alt: 'A cat', width: '320', height: '200' }, range);
    const img = el.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('/media/x.jpg');
    expect(img.getAttribute('alt')).toBe('A cat');
    expect(img.getAttribute('width')).toBe('320');
    expect(img.getAttribute('height')).toBe('200');
    insertImage(el, { url: 'javascript:alert(1)' }, null); // dangerous → dropped
    expect(el.querySelectorAll('img')).toHaveLength(1);
  });

  it('updateImage rewrites an existing img in place (sanitized src, removes empty dims)', () => {
    const el = document.createElement('div');
    el.innerHTML = '<p><img src="/old.jpg" alt="old" width="100" height="80"></p>';
    document.body.appendChild(el);
    const img = el.querySelector('img')!;
    updateImage(img, { url: '/new.jpg', alt: 'new', width: '', height: '' });
    expect(img.getAttribute('src')).toBe('/new.jpg');
    expect(img.getAttribute('alt')).toBe('new');
    expect(img.hasAttribute('width')).toBe(false);
    expect(img.hasAttribute('height')).toBe(false);
    updateImage(img, { url: 'javascript:alert(1)', alt: 'x' }); // dangerous src rejected → keeps the last good src
    expect(img.getAttribute('src')).toBe('/new.jpg');
    updateImage(img, { url: '/n.jpg', width: '99999', height: '-3' }); // defense-in-depth clamp
    expect(img.getAttribute('width')).toBe('4000');
    expect(img.hasAttribute('height')).toBe(false);
  });

  it('stepBlockIndent steps the block indent up and down', () => {
    const el = editableSelectingP('<p>hello</p>');
    const reselect = () => {
      const range = document.createRange();
      range.selectNodeContents(el.querySelector('p')!);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
    };
    stepBlockIndent(el, 1);
    expect(el.querySelector('p')!.getAttribute('class')).toBe('pl-4');
    reselect();
    stepBlockIndent(el, 1);
    expect(el.querySelector('p')!.getAttribute('class')).toBe('pl-8');
    reselect();
    stepBlockIndent(el, -1);
    expect(el.querySelector('p')!.getAttribute('class')).toBe('pl-4');
    reselect();
    stepBlockIndent(el, -1);
    expect(el.querySelector('p')!.hasAttribute('class')).toBe(false);
  });
});
