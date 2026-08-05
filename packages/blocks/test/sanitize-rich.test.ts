import { describe, it, expect } from 'vitest';
import { sanitizeRichHtml } from '../src/sanitize-rich.js';

describe('sanitizeRichHtml — broad safe-HTML allowlist', () => {
  it('keeps the rich-text + structural/sectioning/media surface', () => {
    const html =
      '<section><article><p class="sw-h2">h</p><p><strong>a</strong> <em>b</em> <code>e</code></p>' +
      '<figure><img src="/m/a.jpg" alt="x" /><figcaption>cap</figcaption></figure>' +
      '<details><summary>more</summary><p>body</p></details>' +
      '<ul><li>x</li></ul>' +
      '<table><thead><tr><th scope="col">H</th></tr></thead><tbody><tr><td colspan="2">c</td></tr></tbody></table>' +
      '</article></section>';
    expect(sanitizeRichHtml(html)).toBe(html);
  });

  // Rich content is a FRAGMENT dropped into a page that already has its own heading outline, so no
  // h1-h6 may survive this sink — including from the HTML-source editor, which the toolbar cannot police.
  // Rewritten rather than discarded: dropping the tag would take the author's words with it.
  it('rewrites every heading level to a paragraph carrying its look-alike class', () => {
    for (const h of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
      expect(sanitizeRichHtml(`<${h}>Title</${h}>`)).toBe(`<p class="sw-${h}">Title</p>`);
    }
  });

  it('keeps the text, the attributes and any author classes when rewriting a heading', () => {
    const out = sanitizeRichHtml('<h3 class="text-primary mt-4" id="x" dir="rtl">Kept <strong>words</strong></h3>');
    expect(out).toContain('Kept <strong>words</strong>'); // nothing is lost
    expect(out).toContain('class="text-primary mt-4 sw-h3"'); // author classes first, look-alike appended
    expect(out).toContain('id="x"');
    expect(out).toContain('dir="rtl"');
    expect(out).not.toMatch(/<h[1-6][\s>]/);
  });

  it('is idempotent over the rewrite — a second pass does not stack another class', () => {
    const once = sanitizeRichHtml('<h2>Twice</h2>');
    expect(sanitizeRichHtml(once)).toBe(once);
    // …and markup that already names the look-alike class does not end up carrying it twice.
    expect(sanitizeRichHtml('<h2 class="sw-h2">Already</h2>')).toBe('<p class="sw-h2">Already</p>');
  });

  it('rewrites a heading wherever it appears, however it is written', () => {
    expect(sanitizeRichHtml('<H2>Shout</H2>')).toBe('<p class="sw-h2">Shout</p>'); // uppercase
    expect(sanitizeRichHtml('<div><h3>Deep</h3></div>')).toBe('<div><p class="sw-h3">Deep</p></div>');
    expect(sanitizeRichHtml('<ul><li><h4>In list</h4></li></ul>')).toBe('<ul><li><p class="sw-h4">In list</p></li></ul>');
    expect(sanitizeRichHtml('<h2>Unclosed')).toBe('<p class="sw-h2">Unclosed</p>');
  });

  it('rewriting a heading does NOT smuggle its attributes past the allowlist', () => {
    // transformTags returns attribs wholesale, so the filtering that follows it is load-bearing.
    expect(sanitizeRichHtml('<h2 onclick="alert(1)" class="a">Evil</h2>')).toBe('<p class="a sw-h2">Evil</p>');
    expect(sanitizeRichHtml('<h2 style="color:red;position:fixed">S</h2>')).toBe('<p style="color:red" class="sw-h2">S</p>');
    expect(sanitizeRichHtml('<h2 data-sw-component="modal">D</h2>')).toBe('<p class="sw-h2">D</p>');
  });

  it('leaves NON-heading blocks alone (the rewrite is not a blanket block transform)', () => {
    expect(sanitizeRichHtml('<p>plain</p>')).toBe('<p>plain</p>');
    expect(sanitizeRichHtml('<blockquote>q</blockquote>')).toBe('<blockquote>q</blockquote>');
    expect(sanitizeRichHtml('<div class="a">d</div>')).toBe('<div class="a">d</div>');
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

  it('preserves the rich-text toolbar Tailwind utility classes it emits', () => {
    // The WYSIWYG toolbars emit EXISTING Tailwind classes (colour/highlight/size/align/indent + CI font/colour)
    // rather than inline styles; the `class` attribute is allow-listed, so they must survive verbatim.
    const html = '<p class="text-center pl-8"><span class="text-red-600 text-lg bg-yellow-200 font-heading">styled</span></p>';
    const out = sanitizeRichHtml(html);
    for (const c of ['text-center', 'pl-8', 'text-red-600', 'text-lg', 'bg-yellow-200', 'font-heading']) {
      expect(out).toContain(c);
    }
    // The tables / dividers the toolbar can insert are allow-listed too.
    expect(sanitizeRichHtml('<table><tbody><tr><td>c</td></tr></tbody></table>')).toContain('<td>c</td>');
    expect(sanitizeRichHtml('<hr>')).toContain('<hr');
  });
});
