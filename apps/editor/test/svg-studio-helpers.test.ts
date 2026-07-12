import { describe, it, expect, beforeEach } from 'vitest';
import { parseSvg, cleanupSvg, prettySvg, isSvgUpload, cleanSvgFile, stampIds, buildTree, assetFromUrl, cssEsc, resetStampCounter } from '../src/views/library/svg-studio-helpers';

/** A messy export: full editor namespaces, comments, <metadata>/RDF, a <sodipodi:namedview>, layer names,
 *  namespaced attrs — mixed with everything that MUST survive (CSS, ids, gradient, geometry, data-sw-*). */
const MESSY = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.0.dtd" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:cc="http://creativecommons.org/ns#" viewBox="0 0 100 100" version="1.1">
  <!-- Generator: Adobe Illustrator 27.0 -->
  <sodipodi:namedview id="nv1" inkscape:zoom="4"/>
  <metadata id="md1"><rdf:RDF><cc:Work><dc:title>Untitled</dc:title></cc:Work></rdf:RDF></metadata>
  <defs>
    <linearGradient id="grad"><stop offset="0" stop-color="#f00"/></linearGradient>
    <style>.brand{fill:url(#grad)} /* keep me */</style>
  </defs>
  <title>My Logo</title>
  <g id="layer1" inkscape:label="Layer 1" data-name="Layer 1">
    <path id="p1" class="brand" d="M10 10 L90 90" fill="url(#grad)" data-sw-svg="draw" data-sw-duration="900" sodipodi:nodetypes="cc"/>
    <text x="5" y="20">Keep  spaces</text>
    <use xlink:href="#p1"/>
  </g>
</svg>`;

describe('svg-studio-helpers', () => {
  beforeEach(() => resetStampCounter());

  describe('parseSvg', () => {
    it('parses a valid SVG and injects a missing namespace', () => {
      const svg = parseSvg('<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
      expect(svg).not.toBeNull();
      expect(svg!.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg');
      expect(svg!.querySelector('rect')).not.toBeNull();
    });

    it('strips <script>, <foreignObject> and on* handlers (sanitize)', () => {
      const svg = parseSvg(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><foreignObject><b/></foreignObject><rect onclick="x()" onload="y()" width="5" height="5"/></svg>',
      );
      expect(svg).not.toBeNull();
      expect(svg!.querySelector('script')).toBeNull();
      expect(svg!.querySelector('foreignObject')).toBeNull();
      const rect = svg!.querySelector('rect')!;
      expect(rect.getAttribute('onclick')).toBeNull();
      expect(rect.getAttribute('onload')).toBeNull();
    });

    it('returns null for empty or non-SVG input', () => {
      expect(parseSvg('')).toBeNull();
      expect(parseSvg('   ')).toBeNull();
      expect(parseSvg('<div>not svg</div>')).toBeNull();
    });
  });

  describe('cleanupSvg', () => {
    const serialize = (el: Element) => new XMLSerializer().serializeToString(el);

    it('removes comments, <metadata>/RDF, editor namespaces, layer names & their xmlns declarations', () => {
      const svg = parseSvg(MESSY)!;
      cleanupSvg(svg);
      const out = serialize(svg);
      expect(out).not.toContain('<!--'); // comments gone
      expect(out).not.toContain('metadata'); // <metadata> + RDF block gone
      expect(out).not.toContain('rdf:'); // (and its RDF children)
      expect(out).not.toContain('namedview'); // <sodipodi:namedview> gone
      expect(out).not.toContain('inkscape:'); // inkscape:label / inkscape:zoom attrs gone
      expect(out).not.toContain('sodipodi:'); // sodipodi:nodetypes gone
      expect(out).not.toContain('data-name'); // layer-name attr gone
      expect(out).not.toContain('xmlns:inkscape'); // leftover editor xmlns declarations gone
      expect(out).not.toContain('xmlns:dc');
      expect(out).not.toContain('xmlns:rdf');
    });

    it('preserves CSS, ids, gradients, geometry, xlink & every data-sw-* directive', () => {
      const svg = parseSvg(MESSY)!;
      cleanupSvg(svg);
      // ids + geometry + fill kept
      const path = svg.querySelector('#p1')!;
      expect(path).not.toBeNull();
      expect(path.getAttribute('d')).toBe('M10 10 L90 90');
      expect(path.getAttribute('fill')).toBe('url(#grad)');
      expect(path.getAttribute('class')).toBe('brand');
      // animation directives kept (the critical guard: data-name went, data-sw-* stayed)
      expect(path.getAttribute('data-sw-svg')).toBe('draw');
      expect(path.getAttribute('data-sw-duration')).toBe('900');
      expect(path.hasAttribute('sodipodi:nodetypes')).toBe(false);
      // CSS: <style> element + its rules (incl. a CSS comment) survive verbatim
      const style = svg.querySelector('style')!;
      expect(style.textContent).toContain('.brand{fill:url(#grad)}');
      expect(style.textContent).toContain('/* keep me */');
      // defs gradient (referenced by url(#grad)) kept
      expect(svg.querySelector('#grad')).not.toBeNull();
      // <title> (a11y) kept; xlink namespace + reference kept; text spacing untouched
      expect(svg.querySelector('title')?.textContent).toBe('My Logo');
      expect(svg.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg');
      expect(svg.getAttribute('xmlns:xlink')).toBe('http://www.w3.org/1999/xlink');
      expect(svg.querySelector('use')!.getAttribute('xlink:href')).toBe('#p1');
      expect(svg.querySelector('text')!.textContent).toBe('Keep  spaces');
    });

    it('is idempotent (running twice changes nothing)', () => {
      const svg = parseSvg(MESSY)!;
      cleanupSvg(svg);
      const once = serialize(svg);
      cleanupSvg(svg);
      expect(serialize(svg)).toBe(once);
    });

    it('leaves an already-clean SVG structurally intact', () => {
      const svg = parseSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect id="r" width="10" height="10" data-sw-svg="fade"/></svg>')!;
      cleanupSvg(svg);
      const rect = svg.querySelector('#r')!;
      expect(rect.getAttribute('data-sw-svg')).toBe('fade');
      expect(rect.getAttribute('width')).toBe('10');
    });

    it('keeps attributes bound to a legitimate (non-editor) namespace, even with a short prefix', () => {
      const svg = parseSvg('<svg xmlns="http://www.w3.org/2000/svg" xmlns:a="http://custom.example/ns" viewBox="0 0 10 10"><rect id="r" a:role="deco" width="10" height="10"/></svg>')!;
      cleanupSvg(svg);
      const rect = svg.querySelector('#r')!;
      expect(rect.getAttribute('a:role')).toBe('deco'); // resolved non-editor ns → NOT an editor prefix false-positive
      expect(svg.getAttribute('xmlns:a')).toBe('http://custom.example/ns');
    });

    it('drops an Adobe xmlns:i declaration + its attributes by namespace URI (prefix name irrelevant)', () => {
      const svg = parseSvg('<svg xmlns="http://www.w3.org/2000/svg" xmlns:i="http://ns.adobe.com/AdobeIllustrator/10.0/" viewBox="0 0 10 10"><rect id="r" i:extraneous="foo" width="10" height="10"/></svg>')!;
      cleanupSvg(svg);
      const out = new XMLSerializer().serializeToString(svg);
      expect(out).not.toContain('xmlns:i');
      expect(out).not.toContain('i:extraneous');
      expect(svg.querySelector('#r')!.getAttribute('width')).toBe('10');
    });

    it('descends deep without overflowing the stack (iterative traversal reaches the leaf)', () => {
      // Deep-but-jsdom-safe: jsdom's own querySelectorAll/serializer recurse, so we can't push to a real
      // browser's stack limit here — but this proves stripCommentsAndSpace descends fully and completes.
      const depth = 2000;
      const svg = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${'<g>'.repeat(depth)}<!-- deep --><rect id="leaf" width="1" height="1"/>${'</g>'.repeat(depth)}</svg>`)!;
      expect(() => cleanupSvg(svg)).not.toThrow();
      const leaf = svg.querySelector('#leaf')!;
      expect(leaf).not.toBeNull();
      // the comment sibling of the deepest rect was reached and removed
      expect(Array.from(leaf.parentNode!.childNodes).some((n) => n.nodeType === 8)).toBe(false);
    });
  });

  describe('prettySvg', () => {
    it('indents container elements onto multiple lines', () => {
      const svg = parseSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g id="a"><rect id="r" width="5" height="5"/></g></svg>')!;
      const pretty = prettySvg(svg);
      const lines = pretty.split('\n');
      expect(lines.length).toBeGreaterThan(3); // not one line
      expect(lines[0]).toMatch(/^<svg /);
      expect(pretty).toContain('\n  <g id="a">'); // group indented one level
      expect(pretty).toContain('\n    <rect id="r"'); // rect indented two levels, self-closed
      expect(pretty).toContain('/>');
      expect(pretty.trimEnd().endsWith('</svg>')).toBe(true);
    });

    it('preserves text whitespace, CSS, attributes & namespaces (round-trips to the same DOM)', () => {
      const src = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100"><defs><linearGradient id="grad"><stop offset="0" stop-color="#f00"/></linearGradient><style>.brand{fill:url(#grad)}</style></defs><g id="g"><path id="p" class="brand" d="M10 10 L90 90" data-sw-svg="draw"/><text x="5" y="20">Keep  spaces</text><use xlink:href="#p"/></g></svg>';
      const svg = parseSvg(src)!;
      const pretty = prettySvg(svg);
      const re = parseSvg(pretty)!; // must re-parse cleanly
      expect(re).not.toBeNull();
      expect(re.querySelector('#p')!.getAttribute('data-sw-svg')).toBe('draw');
      expect(re.querySelector('#p')!.getAttribute('d')).toBe('M10 10 L90 90');
      expect(re.querySelector('#grad')).not.toBeNull();
      expect(re.querySelector('style')!.textContent).toContain('.brand{fill:url(#grad)}');
      expect(re.querySelector('text')!.textContent).toBe('Keep  spaces'); // double space intact
      expect(re.querySelector('use')!.getAttribute('xlink:href')).toBe('#p');
      // <text>/<style> stay on a single line (not reformatted)
      expect(pretty).toMatch(/<text x="5" y="20">Keep  spaces<\/text>/);
      expect(pretty).toMatch(/<style>\.brand\{fill:url\(#grad\)\}<\/style>/);
    });

    it('escapes attribute & text special characters', () => {
      const svg = parseSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text id="t" data-x="a &amp; b &lt; c">x &amp; y</text></svg>')!;
      const pretty = prettySvg(svg);
      expect(pretty).toContain('data-x="a &amp; b &lt; c"');
      expect(pretty).toContain('x &amp; y');
      const re = parseSvg(pretty)!;
      expect(re.querySelector('#t')!.getAttribute('data-x')).toBe('a & b < c');
      expect(re.querySelector('#t')!.textContent).toBe('x & y');
    });

    it('preserves CDATA-wrapped <style> CSS (Inkscape/Illustrator export)', () => {
      const svg = parseSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><style><![CDATA[.cls-1{fill:#4f46e5}]]></style><rect class="cls-1" width="10" height="10"/></svg>')!;
      const pretty = prettySvg(svg);
      expect(pretty).toContain('.cls-1{fill:#4f46e5}'); // CSS survives the pretty pass (was silently dropped)
      const re = parseSvg(pretty)!;
      expect(re.querySelector('style')!.textContent).toContain('.cls-1{fill:#4f46e5}');
    });

    it('does not overflow on deep container nesting (iterative block path)', () => {
      const depth = 3000;
      const svg = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${'<g>'.repeat(depth)}<rect id="leaf" width="1" height="1"/>${'</g>'.repeat(depth)}</svg>`)!;
      expect(() => prettySvg(svg)).not.toThrow();
      expect(prettySvg(svg)).toContain('<rect id="leaf"');
    });

    it('does not overflow on deep inline (tspan) nesting (iterative inline path)', () => {
      const depth = 2000;
      const svg = parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>${'<tspan>'.repeat(depth)}x${'</tspan>'.repeat(depth)}</text></svg>`)!;
      expect(() => prettySvg(svg)).not.toThrow();
      expect(prettySvg(svg)).toContain('x');
    });
  });

  describe('isSvgUpload', () => {
    it('detects SVG by MIME type or .svg extension, rejects others', () => {
      expect(isSvgUpload(new File(['x'], 'a.svg', { type: 'image/svg+xml' }))).toBe(true);
      expect(isSvgUpload(new File(['x'], 'LOGO.SVG', { type: '' }))).toBe(true); // extension, any case
      expect(isSvgUpload(new File(['x'], 'a.png', { type: 'image/png' }))).toBe(false);
    });
  });

  describe('cleanSvgFile', () => {
    const MESSY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 100 100"><!-- Generator: Illustrator --><metadata id="m">junk</metadata><g id="g" inkscape:label="Layer 1" data-name="Layer 1"><circle id="c" cx="50" cy="50" r="40" fill="#4f46e5" data-sw-svg="draw"/></g></svg>`;
    // jsdom has no Blob.text(); read via FileReader (which the helper also uses).
    const readFile = (b: Blob): Promise<string> =>
      new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ''));
        r.onerror = () => reject(r.error);
        r.readAsText(b);
      });

    it('cleans + pretty-prints an uploaded SVG, preserving ids & animation, and re-types it', async () => {
      const input = new File([MESSY_SVG], 'logo.svg', { type: 'image/svg+xml' });
      const out = await cleanSvgFile(input);
      expect(out).not.toBe(input); // a NEW File with tidied bytes
      expect(out.type).toBe('image/svg+xml');
      expect(out.name).toBe('logo.svg');
      const text = await readFile(out);
      expect(text).not.toContain('<!--'); // cruft stripped
      expect(text).not.toContain('metadata');
      expect(text).not.toContain('inkscape:');
      expect(text).not.toContain('data-name');
      expect(text).toContain('data-sw-svg="draw"'); // animation kept
      expect(text).toContain('id="c"'); // id kept
      expect(text.split('\n').length).toBeGreaterThan(3); // pretty (multi-line), not one line
    });

    it('passes a non-SVG file through unchanged (same reference)', async () => {
      const png = new File(['\x89PNG'], 'a.png', { type: 'image/png' });
      expect(await cleanSvgFile(png)).toBe(png);
    });

    it('passes an unparseable "SVG" through unchanged rather than blocking the upload', async () => {
      const bad = new File(['<not-svg/>'], 'x.svg', { type: 'image/svg+xml' });
      expect(await cleanSvgFile(bad)).toBe(bad);
    });
  });

  describe('stampIds', () => {
    it('stamps animatable elements without an id, preserving authored ids', () => {
      const svg = parseSvg('<svg xmlns="http://www.w3.org/2000/svg"><g><path id="logo"/><circle/></g><rect/></svg>')!;
      stampIds(svg);
      expect(svg.querySelector('#logo')).not.toBeNull(); // authored id kept
      expect(svg.querySelector('circle')!.getAttribute('id')).toMatch(/^sw-el-\d+$/);
      expect(svg.querySelector('rect')!.getAttribute('id')).toMatch(/^sw-el-\d+$/);
      expect(svg.querySelector('g')!.getAttribute('id')).toMatch(/^sw-el-\d+$/);
    });
  });

  describe('buildTree', () => {
    it('builds a nested tree (groups get children), flagging authored vs stamped ids', () => {
      const svg = parseSvg('<svg xmlns="http://www.w3.org/2000/svg"><g id="grp"><path/><circle/></g><rect/><defs><linearGradient/></defs></svg>')!;
      stampIds(svg);
      const tree = buildTree(svg, 0);
      expect(tree.map((n) => n.tag)).toEqual(['g', 'rect']); // <defs> excluded
      const g = tree[0]!;
      expect(g.authored).toBe(true); // id="grp"
      expect(g.children.map((c) => c.tag)).toEqual(['path', 'circle']);
      expect(g.children[0]!.depth).toBe(1);
      expect(tree[1]!.authored).toBe(false); // stamped rect
    });
  });

  describe('assetFromUrl', () => {
    it('extracts the asset id + filename from a media URL', () => {
      expect(assetFromUrl('/media/site/abc123/logo.svg')).toEqual({ id: 'abc123', filename: 'logo.svg' });
      expect(assetFromUrl('/media/site/def456/file/icon.svg')).toEqual({ id: 'def456', filename: 'icon.svg' });
      expect(assetFromUrl('/media/site/ghi789/my%20logo.svg?v=1')).toEqual({ id: 'ghi789', filename: 'my logo.svg' });
    });
    it('returns null for a non-media URL', () => {
      expect(assetFromUrl('https://example.com/x.svg')).toBeNull();
      expect(assetFromUrl('/assets/x.svg')).toBeNull();
    });
  });

  describe('cssEsc', () => {
    it('escapes quotes and backslashes for a [id="…"] selector', () => {
      expect(cssEsc('a"b\\c')).toBe('a\\"b\\\\c');
      expect(cssEsc('plain')).toBe('plain');
    });
  });
});
