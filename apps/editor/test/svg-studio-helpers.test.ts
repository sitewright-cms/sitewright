import { describe, it, expect, beforeEach } from 'vitest';
import { parseSvg, stampIds, buildTree, assetFromUrl, cssEsc, resetStampCounter } from '../src/views/library/svg-studio-helpers';

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
