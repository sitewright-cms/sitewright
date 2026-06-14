import { describe, it, expect } from 'vitest';
import { sanitizeRichHtml } from '../src/sanitize-rich.js';

describe('sanitizeRichHtml — broad safe-HTML allowlist', () => {
  it('keeps the rich-text + structural/sectioning/media surface', () => {
    const html =
      '<section><article><h2>h</h2><p><strong>a</strong> <em>b</em> <code>e</code></p>' +
      '<figure><img src="/m/a.jpg" alt="x" /><figcaption>cap</figcaption></figure>' +
      '<details><summary>more</summary><p>body</p></details>' +
      '<ul><li>x</li></ul>' +
      '<table><thead><tr><th scope="col">H</th></tr></thead><tbody><tr><td colspan="2">c</td></tr></tbody></table>' +
      '</article></section>';
    expect(sanitizeRichHtml(html)).toBe(html);
  });

  it('keeps class / id / aria-* / role for styling + a11y', () => {
    const out = sanitizeRichHtml('<div class="grid gap-4" id="x" role="note" aria-label="hi">ok</div>');
    expect(out).toContain('class="grid gap-4"');
    expect(out).toContain('id="x"');
    expect(out).toContain('role="note"');
    expect(out).toContain('aria-label="hi"');
  });

  it('allows a SAFE inline-style set (text-align, color, font) but drops the rest (position, url, …)', () => {
    const out = sanitizeRichHtml('<p style="text-align:right;color:red;font-weight:bold;position:fixed;background-image:url(x)">x</p>');
    expect(out).toContain('text-align:right');
    expect(out).toContain('color:red');
    expect(out).toContain('font-weight:bold');
    expect(out).not.toContain('position');
    expect(out).not.toContain('url(');
  });

  it('allows an HTTPS iframe embed but FORCE-sandboxes it (no allow-same-origin) + no-referrer', () => {
    const out = sanitizeRichHtml('<iframe src="https://www.youtube.com/embed/x" width="560" height="315" allowfullscreen></iframe>');
    expect(out).toContain('src="https://www.youtube.com/embed/x"');
    expect(out).toContain('sandbox="allow-scripts allow-popups allow-presentation allow-forms"');
    expect(out).not.toContain('allow-same-origin');
    expect(out).toContain('referrerpolicy="no-referrer"');
    // an author-supplied permissive sandbox is overridden, not merged
    const forced = sanitizeRichHtml('<iframe src="https://e.test" sandbox="allow-same-origin allow-scripts"></iframe>');
    expect(forced).not.toContain('allow-same-origin');
  });

  it('drops a non-https / schemeless / src-less iframe entirely', () => {
    expect(sanitizeRichHtml('<iframe src="http://e.test"></iframe><p>ok</p>')).toBe('<p>ok</p>');
    expect(sanitizeRichHtml('<iframe src="javascript:alert(1)"></iframe><p>ok</p>')).toBe('<p>ok</p>');
    expect(sanitizeRichHtml('<iframe></iframe><p>ok</p>')).toBe('<p>ok</p>');
  });

  it('STILL strips scripts, event handlers, and form/input (no embedded credential forms)', () => {
    expect(sanitizeRichHtml('<p onclick="alert(1)">x</p>')).toBe('<p>x</p>');
    expect(sanitizeRichHtml('<script>alert(1)</script><p>ok</p>')).toBe('<p>ok</p>');
    expect(sanitizeRichHtml('<style>body{display:none}</style><p>ok</p>')).toBe('<p>ok</p>');
    expect(sanitizeRichHtml('<img src="x" onerror="alert(1)">')).not.toContain('onerror');
    expect(sanitizeRichHtml('<form><input></form><p>ok</p>')).toBe('<p>ok</p>');
    expect(sanitizeRichHtml('<p>a<!-- c -->b</p>')).toBe('<p>ab</p>');
  });

  it('STILL strips ALL data-* (so authored HTML can NOT inject platform data-sw-* markers)', () => {
    const out = sanitizeRichHtml('<p data-sw-component="carousel" data-sw-cart-add data-foo="y" class="ok">z</p>');
    expect(out).toBe('<p class="ok">z</p>');
    expect(out).not.toContain('data-');
  });

  it('gates URL schemes on links and images', () => {
    expect(sanitizeRichHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizeRichHtml('<a href="https://ok.test">x</a>')).toBe('<a href="https://ok.test">x</a>');
    expect(sanitizeRichHtml('<a href="/about">x</a>')).toBe('<a href="/about">x</a>');
    expect(sanitizeRichHtml('<a href="mailto:hi@a.test">x</a>')).toBe('<a href="mailto:hi@a.test">x</a>');
    expect(sanitizeRichHtml('<img src="data:image/svg+xml,..." alt="">')).not.toContain('data:');
    expect(sanitizeRichHtml('<img src="/media/p/a/x.jpg" alt="ok">')).toContain('/media/p/a/x.jpg');
    // video poster is URL-bearing too → scheme-gated (data:/javascript: dropped, https kept)
    expect(sanitizeRichHtml('<video poster="data:text/html,<script>alert(1)</script>" controls></video>')).not.toContain('data:');
    expect(sanitizeRichHtml('<video poster="https://ok.test/p.jpg" controls></video>')).toContain('https://ok.test/p.jpg');
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
