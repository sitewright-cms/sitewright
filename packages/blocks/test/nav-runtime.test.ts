import { describe, it, expect } from 'vitest';
import { decorateNav, NAV_LINK_JS } from '../src/nav-runtime.js';
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

  it('falls back to the escaped label when a rich label fails validation (e.g. a <script>)', () => {
    const out = decorateNav(nav([{ label: '<script>alert(1)</script>', path: '#x', rich: true }]));
    expect(out.header[0]!.labelHtml).not.toContain('<script');
    expect(out.header[0]!.labelHtml).toContain('&lt;script&gt;');
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
});
