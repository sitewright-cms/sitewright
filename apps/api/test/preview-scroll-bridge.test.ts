import { describe, it, expect } from 'vitest';
import { PREVIEW_SITE_RUNTIME_JS, PREVIEW_SCROLL_BRIDGE_JS } from '../src/http/preview-site-runtime.js';
import { PREVIEW_BRIDGE_JS } from '../src/http/preview-bridge.js';

const BRIDGES = [
  ['whole-site draft preview', PREVIEW_SITE_RUNTIME_JS],
  ['single-page editor preview', PREVIEW_SCROLL_BRIDGE_JS],
] as const;

describe('preview scroll bridge honours scroll behaviour', () => {
  it.each(BRIDGES)('%s forwards to the body scroller instead of assigning scrollTop', (_name, js) => {
    // THE DEFECT: the bridge shadowed window.scrollTo with `body.scrollTop = opts.top`. Assigning
    // scrollTop is always an instant jump, so the platform back-to-top button
    // (window.scrollTo({top:0,behavior:'smooth'})) SNAPPED in preview while easing on the published
    // site. Forwarding to the body's own scrollTo/scrollBy is what carries `behavior` through.
    expect(js).toMatch(/b\[m?e?t?h?o?d?\]?\(/); // a method call on the body, not a property write
    expect(js).toContain('behavior');
    expect(js).toMatch(/a\.behavior\s*\|\|\s*'auto'/);
  });

  it.each(BRIDGES)('%s keeps an un-annotated scroll at "auto" so CSS scroll-behavior decides', (_name, js) => {
    // 'auto' (not a hardcoded 'smooth') is what makes the two surfaces agree: the preview body now
    // carries scroll-behavior:smooth exactly like the published root, so the SAME call resolves the
    // same way on both — rather than the bridge imposing its own policy.
    // Both branches of the options literal default to 'auto': the object form via
    // `a.behavior || 'auto'`, and the two-arg form (window.scrollTo(x, y)) literally.
    expect(js).toMatch(/behavior:\s*a\.behavior\s*\|\|\s*'auto'/);
    expect(js).toMatch(/left:\s*\+a\s*\|\|\s*0,\s*top:\s*\+y\s*\|\|\s*0,\s*behavior:\s*'auto'/);
  });

  it.each(BRIDGES)('%s still falls back to an assignment if the options form throws', (_name, js) => {
    // Older engines lack Element.scrollTo(options). Degraded easing is acceptable; a dead button is not.
    expect(js).toMatch(/catch\s*\(e\)\s*\{[\s\S]*scrollTop/);
  });

  it('the editor bridge RESTORES position instantly — a state sync must never animate', () => {
    // With the body now scrolling smoothly by default, an un-annotated restore would visibly glide the
    // page from the top on every reload. Both restore paths pass behavior:'instant' explicitly.
    expect(PREVIEW_BRIDGE_JS).toContain("behavior: 'instant'");
    expect(PREVIEW_BRIDGE_JS).toContain('function jumpTo(');
    // …and neither restore path still calls the two-arg form directly.
    expect(PREVIEW_BRIDGE_JS).not.toMatch(/window\.scrollTo\(0,\s*(?:d\.y|parseInt)/);
  });
});
