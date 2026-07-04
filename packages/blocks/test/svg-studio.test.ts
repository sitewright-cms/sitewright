import { describe, it, expect } from 'vitest';
import { svgStudioPreviewDoc } from '../src/svg-studio.js';

describe('SVG Studio canvas document', () => {
  const doc = svgStudioPreviewDoc();

  it('embeds the REAL runtimes so "play" matches the published site', () => {
    expect(doc).toContain('var SW_RT='); // the core + morph runtimes, injected for on-demand play
    expect(doc).toContain('getTotalLength'); // core draw
    expect(doc).toContain('data-sw-svg-to'); // morph
  });

  it('speaks the editor↔canvas protocol', () => {
    for (const m of ['sw-studio-render', 'sw-studio-play', 'sw-studio-highlight', 'sw-studio-ready', 'sw-studio-click']) {
      expect(doc).toContain(m);
    }
  });

  it('renders only postMessage content (no tenant string is baked into the doc)', () => {
    // Content arrives via {type:sw-studio-render, svg}; the doc itself carries no dynamic input.
    expect(doc).toContain("d.type==='sw-studio-render'&&typeof d.svg==='string'");
  });

  it('strips script/foreignObject/on* from rendered SVG (belt-and-suspenders in the sandbox)', () => {
    expect(doc).toContain("querySelectorAll('script,foreignObject')");
    expect(doc).toContain('/^on/i');
  });

  it('is a well-formed static doc (exactly one <style> + one <script> block)', () => {
    // Content is injected only via postMessage, so the doc structure is fixed — a single style + script.
    expect((doc.match(/<\/style>/gi) || []).length).toBe(1);
    expect((doc.match(/<\/script>/gi) || []).length).toBe(1);
  });
});
