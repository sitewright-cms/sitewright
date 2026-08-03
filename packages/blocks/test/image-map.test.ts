import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMPONENT_TYPES, componentAssets, componentTypesInSource } from '../src/components.js';
import { IMAGE_MAP_RUNTIME_JS, IMAGE_MAP_VENDOR_CSS } from '../src/vendor/image-map-runtime.js';

const vendorSrc = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../vendor-src/image-map/${rel}`, import.meta.url)), 'utf8');

/**
 * Vendored source with its comments removed.
 *
 * The comments in these files quote the very constructs the tests assert are gone (`onclick=`,
 * `options.script`) in order to record WHY they were removed — so a plain substring check on the
 * raw file matches the explanation instead of the code.
 */
const vendorCode = (rel: string) =>
  vendorSrc(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/**
 * The Image Map runtime is a FORK of a third-party product (Image Map Pro 6.1.11), vendored under
 * licence. Everything upstream did that this platform cannot allow was cut out by hand — and a
 * hand-cut fork is exactly the thing that quietly grows its capabilities back on the next upgrade.
 *
 * So the removals are asserted against the GENERATED BUNDLE, not the source: whatever
 * gen-vendor.mjs actually ships is what these tests read. If someone re-vendors upstream, or
 * restores a file, or an npm dependency drags one of these back in, the suite fails here rather
 * than on a customer's site.
 */
describe('ImageMap component registration', () => {
  it('is a registered component type', () => {
    expect(COMPONENT_TYPES.has('ImageMap')).toBe(true);
  });

  it('detects the marker in page source and ships its assets', () => {
    const src = '<div data-sw-component="image-map"><script type="application/json" data-sw-part="config">{}</script></div>';
    expect(componentTypesInSource(src)).toEqual(['ImageMap']);

    const { css, js } = componentAssets(['ImageMap']);
    expect(js).toContain('data-sw-component');
    expect(css).toContain('sw-imap-');
  });

  it('ships nothing when no page uses it', () => {
    const { css, js } = componentAssets(componentTypesInSource('<p>no maps here</p>'));
    expect(js).toBe('');
    expect(css).toBe('');
  });
});

describe('ImageMap runtime executes no tenant code', () => {
  it('has no eval or Function constructor', () => {
    // Upstream ran a hotspot's `actions.script` through eval() on click (objectController).
    expect(IMAGE_MAP_RUNTIME_JS).not.toMatch(/\beval\s*\(/);
    expect(IMAGE_MAP_RUNTIME_JS).not.toMatch(/new\s+Function\s*\(/);
  });

  it('has no custom-JS / custom-CSS injection', () => {
    // Upstream's loadCustomCode() appended the config's custom_js as a <script> and custom_css as
    // a <style> to <body>. Both the call and the config keys are gone.
    for (const gone of ['custom_js', 'custom_css', 'loadCustomCode', 'run-script']) {
      expect(IMAGE_MAP_RUNTIME_JS).not.toContain(gone);
    }
  });

  it('renders no inline event handler in a tooltip button', () => {
    // Upstream's Button block emitted `onclick="${options.script}"` — inline JavaScript straight
    // from the config, and a fourth execution path alongside run-script and loadCustomCode.
    const code = vendorCode('src/UI/tooltip/content/button.js');
    expect(code).not.toContain('onclick=');
    expect(code).not.toMatch(/options\.script/);
    expect(IMAGE_MAP_RUNTIME_JS).not.toMatch(/onclick="/);
  });

  it('gates every URL a tooltip block renders', () => {
    // href / img src / <source> src all come from the config; each goes through safeLinkUrl, so a
    // javascript: value cannot be emitted.
    for (const file of [
      'src/UI/tooltip/content/button.js',
      'src/UI/tooltip/content/image.js',
      'src/UI/tooltip/content/video.js',
    ]) {
      expect(vendorSrc(file), file).toContain('safeLinkUrl(');
    }
  });

  it('escapes every config value a tooltip block puts in an attribute', () => {
    // `other.id` / `other.classes` / `other.css` are interpolated into quoted attributes; without
    // escaping, a value containing a quote closes the attribute and adds one of its own.
    for (const file of [
      'src/UI/tooltip/content/button.js',
      'src/UI/tooltip/content/heading.js',
      'src/UI/tooltip/content/paragraph.js',
      'src/UI/tooltip/content/image.js',
      'src/UI/tooltip/content/video.js',
      'src/UI/tooltip/content/youTube.js',
    ]) {
      const src = vendorCode(file);
      expect(src, file).toMatch(/escapeHtml\(this\.options\.other\.(id|classes|css)\)/);
      // No raw interpolation of an `other.*` value left anywhere.
      expect(src, file).not.toMatch(/\$\{this\.options\.other\.(id|classes|css)\}/);
    }
  });

  it('allowlists the Heading block tag', () => {
    // `<${options.heading}>` let a config name ANY element, e.g. "img src=x onerror=…".
    const src = vendorCode('src/UI/tooltip/content/heading.js');
    expect(src).toContain('headingTag(this.options.heading)');
    expect(src).not.toMatch(/<\$\{this\.options\.heading\}/);
    expect(vendorSrc('shared/utilities.js')).toMatch(/const HEADING_TAGS = \[/);
  });

  it('publishes no global and does not touch window.print', () => {
    // Upstream hung instances + a dozen imperative helpers off window.ImageMapPro, and overwrote
    // window.print with a mobile debug console.
    expect(IMAGE_MAP_RUNTIME_JS).not.toContain('ImageMapPro');
    expect(IMAGE_MAP_RUNTIME_JS).not.toMatch(/window\.print\s*=/);
  });

  it('keeps no jQuery bridge', () => {
    expect(IMAGE_MAP_RUNTIME_JS).not.toMatch(/\$\.fn\b/);
    expect(IMAGE_MAP_RUNTIME_JS).not.toContain('jQuery');
  });

  it('only follows link schemes that cannot execute', () => {
    // safeLinkUrl's allowlist — a hotspot link is authored data, so javascript:/data:/vbscript:
    // must never reach location.assign or window.open.
    expect(IMAGE_MAP_RUNTIME_JS).toContain('mailto:');
    expect(IMAGE_MAP_RUNTIME_JS).toContain('noopener');
  });
});

describe('ImageMap runtime does not turn authored config into markup', () => {
  // A map config is written by an editor or an agent, not a visitor — but a title is a STRING and
  // upstream assigned all three of these straight to innerHTML, so a title containing markup
  // became live DOM. Asserted on the source, where the intent is legible.
  it.each([
    ['src/UI/menu/item.js', 'the object list'],
    ['src/UI/menu/itemArtboard.js', 'the artboard headings'],
  ])('renders titles in %s as text, not HTML', (file) => {
    const src = vendorSrc(file);
    expect(src).toContain('textContent = this.options.title');
    expect(src).not.toContain('innerHTML = this.options.title');
  });

  it('renders a text object as text, not HTML', () => {
    const src = vendorSrc('src/UI/objects/text.js');
    expect(src).toContain('textContent = this.options.text.text');
    expect(src).not.toContain('innerHTML = this.options.text.text');
  });

  it('escapes the object-list search on both sides', () => {
    // The needle is visitor input interpolated into a RegExp — unescaped, "(" threw and "(a+)+$"
    // could hang the tab. The titles it highlights are escaped before the span is inserted.
    const src = vendorSrc('src/UI/menu/list.js');
    expect(src).toMatch(/escapeRegex\(escapeHtml\(needle\)\)/);
    expect(src).toMatch(/const title = escapeHtml\(item\.options\.title\)/);
  });
});

describe('ImageMap runtime carries no upstream branding', () => {
  it('uses the sw-imap- prefix throughout, in both JS and CSS', () => {
    // The old `imp-` prefix must not survive anywhere in the shipped DOM or stylesheet.
    expect(IMAGE_MAP_RUNTIME_JS).not.toMatch(/["'\s.#]imp-/);
    expect(IMAGE_MAP_VENDOR_CSS).not.toMatch(/[\s.#,]imp-/);
    expect(IMAGE_MAP_VENDOR_CSS).toContain('.sw-imap-');
  });

  it('names no ID selectors in the shipped stylesheet', () => {
    // An id selector can only match one element and outranks anything a site's CSS can write.
    // The fullscreen overlay was upstream's only pair; both are classes now.
    expect(IMAGE_MAP_VENDOR_CSS).not.toMatch(/#[a-zA-Z][\w-]*\s*[,{]/);
  });

  it('carries its licence notice in the bundle itself', () => {
    expect(IMAGE_MAP_RUNTIME_JS).toContain('used under licence');
  });
});
