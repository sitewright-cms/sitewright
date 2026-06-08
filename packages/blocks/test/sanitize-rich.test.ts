import { describe, it, expect } from 'vitest';
import { sanitizeRichHtml } from '../src/sanitize-rich.js';

describe('sanitizeRichHtml — allowlist', () => {
  it('keeps the Full formatting surface', () => {
    const html =
      '<p><strong>a</strong> <em>b</em> <u>c</u> <s>d</s> <code>e</code></p>' +
      '<h2>h</h2><h3>h3</h3><blockquote>q</blockquote>' +
      '<ul><li>x</li></ul><ol><li>y</li></ol>' +
      '<table><thead><tr><th scope="col">H</th></tr></thead><tbody><tr><td colspan="2">c</td></tr></tbody></table>';
    expect(sanitizeRichHtml(html)).toBe(html);
  });

  it('allows text-align in style but drops every other declaration', () => {
    expect(sanitizeRichHtml('<p style="text-align:center">x</p>')).toBe('<p style="text-align:center">x</p>');
    const out = sanitizeRichHtml('<p style="text-align:right;color:red;position:fixed">x</p>');
    expect(out).toContain('text-align:right');
    expect(out).not.toContain('color');
    expect(out).not.toContain('position');
  });

  it('strips scripts, event handlers, and dangerous elements', () => {
    expect(sanitizeRichHtml('<p onclick="alert(1)">x</p>')).toBe('<p>x</p>');
    expect(sanitizeRichHtml('<script>alert(1)</script><p>ok</p>')).toBe('<p>ok</p>');
    expect(sanitizeRichHtml('<img src="x" onerror="alert(1)">')).not.toContain('onerror');
    expect(sanitizeRichHtml('<iframe src="https://e.test"></iframe><p>ok</p>')).toBe('<p>ok</p>');
    expect(sanitizeRichHtml('<form><input></form><p>ok</p>')).toBe('<p>ok</p>');
    expect(sanitizeRichHtml('<p>a<!-- c -->b</p>')).toBe('<p>ab</p>');
  });

  it('drops client classes (keeps the published Tailwind candidate-set stable)', () => {
    expect(sanitizeRichHtml('<p class="bg-red-500">x</p>')).toBe('<p>x</p>');
  });

  it('gates URL schemes on links and images', () => {
    expect(sanitizeRichHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizeRichHtml('<a href="https://ok.test">x</a>')).toBe('<a href="https://ok.test">x</a>');
    expect(sanitizeRichHtml('<a href="/about">x</a>')).toBe('<a href="/about">x</a>');
    expect(sanitizeRichHtml('<a href="mailto:hi@a.test">x</a>')).toBe('<a href="mailto:hi@a.test">x</a>');
    expect(sanitizeRichHtml('<img src="data:image/svg+xml,..." alt="">')).not.toContain('data:');
    expect(sanitizeRichHtml('<img src="/media/p/a/x.jpg" alt="ok">')).toContain('/media/p/a/x.jpg');
  });

  it('forces rel=noopener on target=_blank links', () => {
    const out = sanitizeRichHtml('<a href="https://ok.test" target="_blank">x</a>');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('returns empty for empty/non-string', () => {
    expect(sanitizeRichHtml('')).toBe('');
    expect(sanitizeRichHtml(undefined as unknown as string)).toBe('');
  });
});
