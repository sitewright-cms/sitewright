import { describe, it, expect } from 'vitest';
import { resolveInternalUrl, relativizeInternalLinks, cssUrlEscape, safeUrl } from '../src/url.js';

describe('safeUrl', () => {
  it('passes http(s), root-relative, fragment, and the mailto/tel/sms handlers', () => {
    for (const ok of ['https://x.test', 'http://x.test', '/about', '#sec', 'mailto:a@b.test', 'tel:+1', 'sms:+1']) {
      expect(safeUrl(ok)).toBe(ok);
    }
  });
  it('falls back for active/unknown schemes and protocol-relative URLs', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x', '//evil.test']) {
      expect(safeUrl(bad)).toBe('#');
    }
    expect(safeUrl('', 'FB')).toBe('FB');
  });
});

describe('cssUrlEscape', () => {
  it('passes a clean media/https URL', () => {
    expect(cssUrlEscape('/media/p/a/x.jpg')).toBe('/media/p/a/x.jpg');
    expect(cssUrlEscape('https://cdn.test/x.png')).toBe('https://cdn.test/x.png');
  });
  it("refuses anything that could break out of url('…')", () => {
    expect(cssUrlEscape("/x');background:red//")).toBe('');
    expect(cssUrlEscape('/a b.jpg')).toBe(''); // whitespace
    expect(cssUrlEscape('/a"b.jpg')).toBe('');
    expect(cssUrlEscape('')).toBe('');
  });
});

describe('resolveInternalUrl', () => {
  it('rewrites root-relative internal links to be page-relative (in canonical directory form)', () => {
    expect(resolveInternalUrl('/about', '../')).toBe('../about/');
    expect(resolveInternalUrl('/contact', '../../')).toBe('../../contact/');
    expect(resolveInternalUrl('/our-vehicles', '')).toBe('our-vehicles/');
  });

  it('maps the home link relative to the current page', () => {
    expect(resolveInternalUrl('/', '')).toBe('./');
    expect(resolveInternalUrl('/', '../')).toBe('../');
    expect(resolveInternalUrl('/', '../../')).toBe('../../');
  });

  it('leaves external and fragment links unchanged', () => {
    expect(resolveInternalUrl('https://example.com/x', '../')).toBe('https://example.com/x');
    expect(resolveInternalUrl('http://example.com', '')).toBe('http://example.com');
    expect(resolveInternalUrl('#section', '../')).toBe('#section');
  });

  it('rejects unsafe and protocol-relative URLs (fallback to #)', () => {
    expect(resolveInternalUrl('javascript:alert(1)', '../')).toBe('#');
    expect(resolveInternalUrl('//evil.com', '../')).toBe('#');
    expect(resolveInternalUrl('', '../')).toBe('#');
  });

  it('rejects root-relative paths that traverse above the site root', () => {
    expect(resolveInternalUrl('/../evil', '')).toBe('#');
    expect(resolveInternalUrl('/a/../b', '../')).toBe('#');
    expect(resolveInternalUrl('/..', '../')).toBe('#');
  });

  it('keeps internal links inside the locale subtree via localePrefix', () => {
    // From /de/index.html (root '../', prefix 'de/'): /about → ../de/about/.
    expect(resolveInternalUrl('/about', '../', 'de/')).toBe('../de/about/');
    // From /de/about/index.html (root '../../'): /contact → ../../de/contact/.
    expect(resolveInternalUrl('/contact', '../../', 'de/')).toBe('../../de/contact/');
    // Home within the locale.
    expect(resolveInternalUrl('/', '../', 'de/')).toBe('../de/');
    // Default/empty prefix is identical to no prefix (single-locale no-regression).
    expect(resolveInternalUrl('/about', '../', '')).toBe('../about/');
    // External + fragment links ignore the prefix.
    expect(resolveInternalUrl('https://x.io/a', '../', 'de/')).toBe('https://x.io/a');
    expect(resolveInternalUrl('#top', '../', 'de/')).toBe('#top');
  });
});

describe('relativizeInternalLinks', () => {
  it('rebases internal href/src onto the page root; leaves external/relative untouched', () => {
    const html =
      '<a href="/about">A</a><a href="/de/services">B</a><img src="/media/x.jpg">' +
      '<a href="https://x.io/a">ext</a><a href="//cdn/x">proto</a><a href="#top">frag</a>' +
      '<a href="../already">rel</a><a href="/">home</a>';
    // From a depth-1 page (root '../').
    const out = relativizeInternalLinks(html, '../');
    expect(out).toContain('<a href="../about/">A</a>');
    expect(out).toContain('<a href="../de/services/">B</a>');
    expect(out).toContain('<img src="../media/x.jpg">');
    expect(out).toContain('<a href="../">home</a>'); // "/" → the page root
    // Untouched:
    expect(out).toContain('<a href="https://x.io/a">ext</a>');
    expect(out).toContain('<a href="//cdn/x">proto</a>'); // protocol-relative left alone
    expect(out).toContain('<a href="#top">frag</a>');
    expect(out).toContain('<a href="../already">rel</a>');
  });

  it('at the site root (depth 0) drops the leading slash; home "/" → "./"', () => {
    const out = relativizeInternalLinks('<a href="/about">A</a><a href="/">H</a>', '');
    expect(out).toContain('<a href="about/">A</a>');
    expect(out).toContain('<a href="./">H</a>');
  });

  it('collapses traversing internal links to "#"', () => {
    expect(relativizeInternalLinks('<a href="/a/../b">x</a>', '../')).toContain('<a href="#">x</a>');
  });

  it('neutralizes a TAB/newline scheme-bypass (would parse as javascript: once the slash is dropped)', () => {
    // `/<TAB>javascript:…` survives safeUrl (starts with `/`); at the site root the leading
    // slash is dropped → the browser strips the TAB → `javascript:` scheme. Must become "#".
    expect(relativizeInternalLinks('<a href="/\tjavascript:alert(1)">x</a>', '')).toContain('<a href="#">x</a>');
    expect(resolveInternalUrl('/\njavascript:alert(1)', '')).toBe('#');
    expect(resolveInternalUrl('/\rdata:text/html,x', '../')).toBe('#');
  });
});

describe('internal PAGE links are emitted in canonical DIRECTORY form', () => {
  // A page builds to `<slug>/index.html`, and every host — the platform's own /sites + /preview-site
  // handlers, Apache's DirectorySlash, nginx — answers a slash-less page URL with a 301 to the
  // directory. Emitting the slash-less form made EVERY menu click a redirect. The canonical/og:url/
  // sitemap/search-index side already used the directory form (siteUrlFor), so this also ends a
  // disagreement the site was publishing about itself.
  it('appends the trailing slash to a page route', () => {
    expect(resolveInternalUrl('/about', '')).toBe('about/');
    expect(resolveInternalUrl('/about', '../')).toBe('../about/');
    expect(resolveInternalUrl('/de/services', '../../')).toBe('../../de/services/');
  });

  it('is idempotent — an already-canonical path is unchanged', () => {
    expect(resolveInternalUrl('/about/', '')).toBe('about/');
    expect(resolveInternalUrl('/', '')).toBe('./');
    expect(resolveInternalUrl('/', '../')).toBe('../');
  });

  it('collapses a doubled slash, so a hand-written `{{page.path}}/` workaround cannot emit `about//`', () => {
    expect(resolveInternalUrl('/about//', '')).toBe('about/');
  });

  it('LEAVES FILES ALONE — the last segment carrying a dot means "not a page route"', () => {
    // A page slug can never contain a dot (PageSlugSchema is /^$|^[a-z0-9]+(?:-[a-z0-9]+)*$/), and
    // every asset carries an extension — so this predicate cannot misfire in either direction. It is
    // the same test the server's own 301 applies before redirecting.
    expect(resolveInternalUrl('/media/x.jpg', '../')).toBe('../media/x.jpg');
    expect(resolveInternalUrl('/_assets/_sw/styles.css', '')).toBe('_assets/_sw/styles.css');
    expect(resolveInternalUrl('/contact.php', '')).toBe('contact.php');
    expect(resolveInternalUrl('/sitemap.xml', '')).toBe('sitemap.xml');
  });

  it('puts the slash BEFORE a fragment or query, never after it', () => {
    expect(resolveInternalUrl('/about#team', '')).toBe('about/#team');
    expect(resolveInternalUrl('/search?q=x', '')).toBe('search/?q=x');
    expect(resolveInternalUrl('/about/#team', '../')).toBe('../about/#team');
    // A path-less fragment on the home route keeps resolving to the same page.
    expect(resolveInternalUrl('/#features', '../')).toBe('../#features');
  });

  it('leaves external, handler and fragment URLs untouched', () => {
    expect(resolveInternalUrl('https://x.test/about', '')).toBe('https://x.test/about');
    expect(resolveInternalUrl('mailto:a@b.test', '')).toBe('mailto:a@b.test');
    expect(resolveInternalUrl('#top', '')).toBe('#top');
  });

  it('applies through relativizeInternalLinks — the ONE place every internal link is rebased', () => {
    const out = relativizeInternalLinks(
      '<a href="/about">A</a><a href="/">H</a><img src="/media/x.jpg"><a href="/contact.php">P</a>',
      '../',
    );
    expect(out).toContain('<a href="../about/">A</a>');
    expect(out).toContain('<a href="../">H</a>');
    expect(out).toContain('<img src="../media/x.jpg">');
    expect(out).toContain('<a href="../contact.php">P</a>');
  });
});
