import { describe, it, expect } from 'vitest';
import { decorateNav, NAV_LINK_JS, usesDialog } from '../src/nav-runtime.js';
import { renderTemplate } from '../src/template.js';

// A structural nav item (mirrors core's NavItem) — decorateNav writes labelHtml in place.
interface Item {
  label?: string;
  path?: string;
  rich?: boolean;
  labelHtml?: string;
  children?: Item[];
}
const nav = (items: Item[]): { header: Item[] } => ({ header: items });

describe('decorateNav', () => {
  it('escapes a plain page label but renders a rich placeholder label (icon helper + basic HTML)', () => {
    const out = decorateNav(
      nav([
        { label: 'A & B', path: '/a' }, // a page → plain, escaped
        { label: '{{sw-icon "calendar"}} <strong>Book</strong>', path: 'https://x.test', rich: true }, // placeholder → rich
      ]),
    );
    expect(out.header[0]!.labelHtml).toBe('A &amp; B');
    const rich = out.header[1]!.labelHtml as string;
    expect(rich).toContain('<svg'); // the icon helper resolved
    expect(rich).toContain('<strong>Book</strong>'); // basic inline HTML passes through
  });

  it('falls back to the escaped label when a rich label fails validation (e.g. an inline on* handler)', () => {
    // NOTE: a bare <script> is now VALID author content (it runs only on the isolated published origin),
    // so it is no longer the rejection example here — an inline event-handler attribute still is.
    const out = decorateNav(nav([{ label: '<span onclick="alert(1)">x</span>', path: '#x', rich: true }]));
    expect(out.header[0]!.labelHtml).not.toContain('<span onclick'); // no LIVE handler element
    expect(out.header[0]!.labelHtml).toContain('&lt;span'); // fell back to the escaped label
  });

  it('decorates nested children too', () => {
    const out = decorateNav(nav([{ label: 'Parent', path: '#', rich: true, children: [{ label: 'Kid', path: '/k' }] }]));
    expect(out.header[0]!.children![0]!.labelHtml).toBe('Kid');
  });
});

describe('{{sw-label}} helper', () => {
  it('emits labelHtml raw and falls back to the escaped plain label', () => {
    const html = renderTemplate('{{#each nav.header}}<a>{{sw-label}}</a>{{/each}}', {
      nav: { header: [{ label: 'X', labelHtml: '<b>X</b>' }, { label: 'A & B' }] },
    } as never);
    expect(html).toContain('<a><b>X</b></a>'); // labelHtml emitted raw (SafeString)
    expect(html).toContain('<a>A &amp; B</a>'); // no labelHtml → escaped fallback
  });
});

describe('NAV_LINK_JS', () => {
  it('is a self-contained runtime that opens dialogs + smooth-scrolls', () => {
    expect(NAV_LINK_JS).toContain('showModal');
    expect(NAV_LINK_JS).toContain('scrollIntoView');
    expect(NAV_LINK_JS.trim().startsWith('(function')).toBe(true);
  });

  it('treats a path-prefixed anchor (/#id) as in-page when the path matches, is root, or is a path suffix', () => {
    // so a shared-nav /#features smooth-scrolls on its own page AND in the path-served preview (/sites/<slug>)
    expect(NAV_LINK_JS).toContain('samePath');
    expect(NAV_LINK_JS).toContain('location.pathname');
    expect(NAV_LINK_JS).toContain('here.endsWith(path)');
  });

  it('is embeddable as an inline <script> — no raw backtick, interpolation, or </script> breakout', () => {
    expect(NAV_LINK_JS).not.toContain('`');
    expect(NAV_LINK_JS).not.toContain('${');
    expect(NAV_LINK_JS).not.toContain('</script');
  });

  it('global backdrop-close respects data-backdrop-close="false" (Modal opt-out)', () => {
    // The document-level backdrop handler must bail when the dialog or its owning component opts
    // out — otherwise it would close a data-backdrop-close="false" Modal that the component itself
    // deliberately left un-wired.
    expect(NAV_LINK_JS).toContain('[data-backdrop-close="false"]');
  });
});

describe('usesDialog (ship the dialog runtime for code-first <dialog> markup)', () => {
  it('detects a native <dialog> opening tag (with or without attributes / self-close)', () => {
    expect(usesDialog('<dialog id="x" class="modal"><p>hi</p></dialog>')).toBe(true);
    expect(usesDialog('<DIALOG>')).toBe(true); // case-insensitive
    expect(usesDialog('<dialog/>')).toBe(true);
  });

  it('does not match a closing tag, a lookalike word, or non-string input', () => {
    expect(usesDialog('</dialog>')).toBe(false); // closing tag alone is not an authored modal
    expect(usesDialog('<div class="dialogue">')).toBe(false);
    expect(usesDialog('')).toBe(false);
    expect(usesDialog(undefined)).toBe(false);
    expect(usesDialog(null)).toBe(false);
  });

});
