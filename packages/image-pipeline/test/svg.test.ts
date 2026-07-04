import { describe, it, expect } from 'vitest';
import { sanitizeSvg, svgIntrinsicSize } from '../src/svg.js';

const okSvg = (inner = '<rect width="100" height="60" fill="#0ea5e9"/>', attrs = 'width="100" height="60"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`;

describe('sanitizeSvg — strips the dangerous surface', () => {
  it('returns null for non-SVG / empty / oversized input', () => {
    expect(sanitizeSvg('not an svg')).toBeNull();
    expect(sanitizeSvg('')).toBeNull();
    expect(sanitizeSvg('<svg ' + 'x'.repeat(5 * 1024 * 1024) + '>')).toBeNull();
  });

  it('strips <script>, <foreignObject> and on* handlers', () => {
    const dirty = okSvg('<script>fetch("//evil")</script><foreignObject><b>hi</b></foreignObject><rect onclick="x()"/>');
    const clean = sanitizeSvg(dirty)!;
    expect(clean).not.toMatch(/<script/i);
    expect(clean).not.toMatch(/<foreignObject/i);
    expect(clean).not.toMatch(/onclick/i);
    expect(clean).not.toMatch(/evil/);
  });

  it('neutralizes an svg-tag onload handler', () => {
    const clean = sanitizeSvg(okSvg('<rect/>', 'width="10" height="10" onload="alert(1)"'))!;
    expect(clean).not.toMatch(/onload/i);
  });

  it('drops remote href / xlink:href but keeps internal #fragment and RASTER data: refs', () => {
    const dirty = okSvg(
      '<image href="https://evil.example/leak.png"/><use xlink:href="http://evil/x"/>' +
        '<image href="data:image/png;base64,AAAA"/><use href="#gradient"/>',
    );
    const clean = sanitizeSvg(dirty)!;
    expect(clean).not.toMatch(/evil/);
    expect(clean).toMatch(/href="#"/);
    expect(clean).toContain('data:image/png;base64,AAAA'); // safe embedded raster kept
    expect(clean).toContain('href="#gradient"');
  });

  it('strips a data:text/html and a recursive data:image/svg+xml href (keeps raster data:)', () => {
    const clean = sanitizeSvg(
      okSvg(
        '<a href="data:text/html,<script>x</script>"><text>a</text></a>' +
          '<image href="data:image/svg+xml,<svg onload=alert(1)>"/>' +
          '<image href="data:image/jpeg;base64,BBBB"/>',
      ),
    )!;
    expect(clean).not.toMatch(/data:text\/html/i);
    expect(clean).not.toMatch(/data:image\/svg/i);
    expect(clean).toContain('data:image/jpeg;base64,BBBB'); // safe raster survives
  });

  it('strips a namespaced <x:script> element', () => {
    const clean = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" xmlns:x="x"><x:script>alert(1)</x:script><rect/></svg>')!;
    expect(clean).not.toMatch(/script/i);
  });

  it('keeps the xmlns declaration (root namespace, not a fetchable ref)', () => {
    expect(sanitizeSvg(okSvg())!).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('neutralizes remote CSS url() but keeps url(#id)', () => {
    const clean = sanitizeSvg(okSvg('<style>rect{fill:url(http://evil/x)}circle{clip-path:url(#c)}</style><rect/>'))!;
    expect(clean).not.toMatch(/evil/);
    expect(clean).toContain('url(#c)');
  });

  it('removes a DOCTYPE + internal ENTITY subset (XXE) and the dangling reference', () => {
    const xxe = '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "http://evil/x">]>' + okSvg('&xxe;<rect/>');
    const clean = sanitizeSvg(xxe)!;
    expect(clean).not.toMatch(/<!DOCTYPE/i);
    expect(clean).not.toMatch(/<!ENTITY/i);
    expect(clean).not.toMatch(/SYSTEM/i);
    expect(clean).not.toMatch(/evil/);
    expect(clean).not.toContain('&xxe;');
  });

  it('strips a SMIL animation that targets href but keeps a transform animation', () => {
    const dirty = okSvg(
      '<a href="#"><animate attributeName="href" to="javascript:alert(1)" dur="1s"/></a>' +
        '<g><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="3s" repeatCount="indefinite"/><rect/></g>',
    );
    const clean = sanitizeSvg(dirty)!;
    expect(clean).not.toMatch(/javascript:/i);
    expect(clean).not.toMatch(/attributeName="href"/i);
    expect(clean).toMatch(/animateTransform/);
    expect(clean).toMatch(/type="rotate"/);
  });

  it('PRESERVES the good stuff: geometry, gradients, <style> @keyframes, SMIL transform', () => {
    const animated =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">' +
      '<defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs>' +
      '<style>@keyframes spin{to{transform:rotate(360deg)}}.gear{animation:spin 2s linear infinite}</style>' +
      '<g class="gear"><circle cx="100" cy="100" r="80" fill="url(#g)"/>' +
      '<animateTransform attributeName="transform" type="rotate" from="0 100 100" to="360 100 100" dur="4s" repeatCount="indefinite"/></g>' +
      '</svg>';
    const clean = sanitizeSvg(animated)!;
    expect(clean).toContain('@keyframes spin');
    expect(clean).toContain('animation:spin 2s linear infinite');
    expect(clean).toContain('<linearGradient id="g"');
    expect(clean).toContain('fill="url(#g)"');
    expect(clean).toMatch(/animateTransform[^>]*type="rotate"/);
  });

  it('strips an on* handler with NO leading whitespace (attribute-dense markup)', () => {
    const clean = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10"onclick="x()"/></svg>')!;
    expect(clean).not.toMatch(/onclick/i);
  });

  it('neutralizes a javascript:/vbscript: scheme even unquoted or in CSS', () => {
    const a = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><a href=javascript:alert(1)><text>x</text></a></svg>')!;
    expect(a).not.toMatch(/javascript:/i);
    const b = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><style>a{cursor:url(vbscript:x)}</style><rect/></svg>')!;
    expect(b).not.toMatch(/vbscript:/i);
  });

  it('does NOT strip a legitimate attribute that merely contains "on" (e.g. font-*)', () => {
    const clean = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><text font-family="Arial" font-size="12">hi</text></svg>')!;
    expect(clean).toContain('font-family="Arial"');
    expect(clean).toContain('font-size="12"');
  });

  it('preserves standard XML entities', () => {
    const clean = sanitizeSvg(okSvg('<text>A &amp; B &lt;c&gt; &#169;</text>'))!;
    expect(clean).toContain('&amp;');
    expect(clean).toContain('&lt;');
    expect(clean).toContain('&#169;');
  });
});

describe('svgIntrinsicSize', () => {
  it('reads explicit px width/height (rounded)', () => {
    expect(svgIntrinsicSize(okSvg('<rect/>', 'width="4406px" height="1394px"'))).toEqual({ width: 4406, height: 1394 });
    expect(svgIntrinsicSize(okSvg('<rect/>', 'width="886.227" height="522.5"'))).toEqual({ width: 886, height: 523 });
  });
  it('falls back to viewBox', () => {
    expect(svgIntrinsicSize(okSvg('<rect/>', 'viewBox="0 0 800 600"'))).toEqual({ width: 800, height: 600 });
  });
  it('does NOT confuse stroke-width for width', () => {
    const s = '<svg xmlns="http://www.w3.org/2000/svg" stroke-width="3" viewBox="0 0 120 90"><rect/></svg>';
    expect(svgIntrinsicSize(s)).toEqual({ width: 120, height: 90 });
  });
  it('returns null when neither is present or values are non-positive', () => {
    expect(svgIntrinsicSize('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')).toBeNull();
    expect(svgIntrinsicSize(okSvg('<rect/>', 'width="0" height="0"'))).toBeNull();
  });
});
