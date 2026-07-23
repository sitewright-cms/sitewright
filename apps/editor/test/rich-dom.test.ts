import { describe, it, expect, vi } from 'vitest';
import { RICH_COLOR_CLASSES, RICH_SIZE_CLASSES, RICH_ALIGN_CLASSES } from '@sitewright/blocks';
import { applyInlineClass, applyBlockClass, stepBlockIndent, applyLink } from '../src/lib/rich-dom';

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
    try {
      applyLink(el, 'javascript:alert(document.cookie)');
      expect(spy).toHaveBeenCalledWith('unlink', false, undefined); // dangerous → dropped, not linked
      expect(spy).not.toHaveBeenCalledWith('createLink', false, expect.stringContaining('javascript'));
      spy.mockClear();
      applyLink(el, 'https://ok.test/path');
      expect(spy).toHaveBeenCalledWith('createLink', false, 'https://ok.test/path');
      spy.mockClear();
      applyLink(el, '/about');
      expect(spy).toHaveBeenCalledWith('createLink', false, '/about');
    } finally {
      doc.execCommand = orig;
    }
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
