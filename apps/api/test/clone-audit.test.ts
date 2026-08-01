import { describe, it, expect } from 'vitest';
import { structuralChecks, behaviouralChecks, visualChecks, assembleAudit, countEditDirectives, type BehaviourFacts } from '../src/render/clone-audit.js';
import { CLIP_PROBE } from '../src/render/clone-audit-probe.js';

const behaviour = (over: Partial<BehaviourFacts> = {}): BehaviourFacts => ({
  carousels: 1, carouselsEnhanced: 1, dialogs: 1, headingFont: 'primary-font', bodyFont: 'text-font',
  headingFontLoaded: true, bodyFontLoaded: true, navExpected: 3, navReachableMobile: 3, hasModalTrigger: true, ...over,
});

describe('structuralChecks', () => {
  it('fails on generic-named / auto-slug datasets, passes when named', () => {
    const bad = structuralChecks({ datasets: [{ id: 'items', name: 'List' }, { id: 'team', name: 'Team' }], media: [], pageSource: '<div data-sw-text="x">a</div>' });
    expect(bad.find((c) => c.id === 'datasets')!.pass).toBe(false);
    const good = structuralChecks({ datasets: [{ id: 'team', name: 'Team' }], media: [], pageSource: '<div data-sw-text="x">a</div>' });
    expect(good.find((c) => c.id === 'datasets')!.pass).toBe(true);
    // zero datasets is acceptable (no repeated content)
    expect(structuralChecks({ datasets: [], media: [], pageSource: '{{sw-control "x"}}' }).find((c) => c.id === 'datasets')!.pass).toBe(true);
    // a generic SLUG (auto-inferred, not yet renamed) is flagged even with a friendly name
    expect(structuralChecks({ datasets: [{ id: 'x', name: 'Clients', slug: 'list' }], media: [], pageSource: '{{sw-control "x"}}' }).find((c) => c.id === 'datasets')!.pass).toBe(false);
    // but a properly RENAMED dataset passes even though rename keeps the immutable importer id ("items"):
    // meaningful name + slug is what matters, not the id.
    expect(structuralChecks({ datasets: [{ id: 'items', name: 'Featured Listings', slug: 'featured_listings' }], media: [], pageSource: '{{sw-control "x"}}' }).find((c) => c.id === 'datasets')!.pass).toBe(true);
  });

  it('fails when media is still under imported/', () => {
    const checks = structuralChecks({ datasets: [], media: [{ folder: 'imported/_data' }, { folder: 'Brand' }], pageSource: '<p data-sw-html="p">x</p>' });
    expect(checks.find((c) => c.id === 'media-folders')!.pass).toBe(false);
    expect(structuralChecks({ datasets: [], media: [{ folder: 'Brand' }], pageSource: '<p data-sw-html="p">x</p>' }).find((c) => c.id === 'media-folders')!.pass).toBe(true);
  });

  it('fails when the page has no edit directives', () => {
    expect(structuralChecks({ datasets: [], media: [], pageSource: '<div>plain</div>' }).find((c) => c.id === 'editable')!.pass).toBe(false);
    expect(structuralChecks({ datasets: [], media: [], pageSource: '<h1 data-sw-text="t">T</h1>' }).find((c) => c.id === 'editable')!.pass).toBe(true);
  });

  // REGRESSION: the check used to read the page's RAW stored source, so the two structures the import
  // guide MANDATES both scored 0 and FAILED — a template-driven page (empty own source) and a page whose
  // directives live in a composed {{> snippet}}. The caller now passes the template-RESOLVED source plus
  // the snippet bodies.
  it('counts directives from a composed {{> snippet}}, not just the page body', () => {
    const snippets = { 'page-hero': '<h1 data-sw-text="header_title">T</h1><div data-sw-text="header_sub"></div>' };
    const composed = structuralChecks({ datasets: [], media: [], pageSource: '{{> page-hero}}\n<section>plain</section>', snippets });
    expect(composed.find((c) => c.id === 'editable')!.pass).toBe(true);
    expect(composed.find((c) => c.id === 'editable')!.detail).toContain('2 edit directives');
    // …and without the snippet bodies the very same page still reads as un-editable (the old behaviour).
    expect(structuralChecks({ datasets: [], media: [], pageSource: '{{> page-hero}}\n<section>plain</section>' }).find((c) => c.id === 'editable')!.pass).toBe(false);
  });
});

describe('countEditDirectives', () => {
  it('counts the page body, every directive kind, and {{sw-control}}', () => {
    expect(countEditDirectives('<h1 data-sw-text="t">T</h1><img data-sw-src="i"><div data-sw-bg="b"></div>')).toBe(3);
    expect(countEditDirectives('{{sw-control "x"}} {{ sw-control "y"}}')).toBe(2);
    expect(countEditDirectives(null)).toBe(0);
    expect(countEditDirectives('<div>nothing</div>')).toBe(0);
  });

  it('expands partials transitively and counts each snippet once', () => {
    const snippets = {
      outer: '<div data-sw-text="a"></div>{{> inner}}',
      inner: '<div data-sw-html="b"></div>',
      unused: '<div data-sw-text="never"></div>',
    };
    expect(countEditDirectives('{{> outer}}', snippets)).toBe(2);
    // referenced twice → counted once (the snippet renders twice, but this gates on authored editability)
    expect(countEditDirectives('{{> outer}}{{> outer}}', snippets)).toBe(2);
  });

  it('terminates on a cyclic composition instead of hanging', () => {
    const snippets = { a: '<i data-sw-text="a"></i>{{> b}}', b: '<i data-sw-text="b"></i>{{> a}}' };
    expect(countEditDirectives('{{> a}}', snippets)).toBe(2);
  });

  it('matches the {{~ }} and {{#> }} partial forms publish accepts', () => {
    const snippets = { hero: '<h1 data-sw-text="t"></h1>' };
    expect(countEditDirectives('{{~> hero}}', snippets)).toBe(1);
    expect(countEditDirectives('{{#> hero}}{{/hero}}', snippets)).toBe(1);
    expect(countEditDirectives('{{> missing}}', snippets)).toBe(0);
  });
});

describe('behaviouralChecks', () => {
  it('fails a dead slider, passes a fully enhanced one (and when there are none)', () => {
    expect(behaviouralChecks(behaviour({ carousels: 1, carouselsEnhanced: 0 })).find((c) => c.id === 'sliders')!.pass).toBe(false);
    expect(behaviouralChecks(behaviour({ carousels: 2, carouselsEnhanced: 2 })).find((c) => c.id === 'sliders')!.pass).toBe(true);
    expect(behaviouralChecks(behaviour({ carousels: 0, carouselsEnhanced: 0 })).find((c) => c.id === 'sliders')!.pass).toBe(true);
  });

  it('fails when an element is visually CUT OFF by an ancestor overflow, and names the clipper', () => {
    // The check a rect measurement cannot make: getBoundingClientRect returns the LAYOUT box whether or
    // not an ancestor clips it, so the element reads full-size while the visitor sees part of it. When
    // the clipper is injected by a component runtime it is absent from the authored source too.
    const clean = behaviouralChecks(behaviour({ clipped: [] })).find((c) => c.id === 'not-clipped')!;
    expect(clean.pass).toBe(true);
    expect(clean.detail).toBe('nothing clipped');
    // Absent (an older/failed probe) must not invent a defect.
    expect(behaviouralChecks(behaviour({})).find((c) => c.id === 'not-clipped')!.pass).toBe(true);

    const cut = behaviouralChecks(
      behaviour({
        clipped: [{ el: 'img.ost-cert-logo', clippedBy: 'div.', box: '122x115', visible: '122x51', lost: '56%' }],
      }),
    ).find((c) => c.id === 'not-clipped')!;
    expect(cut.pass).toBe(false);
    // The detail must name the CLIPPER and the loss — the fix is otherwise a guessing game, since the
    // element the author would reach for is not the one doing the clipping.
    expect(cut.detail).toContain('img.ost-cert-logo');
    expect(cut.detail).toContain('by div.');
    expect(cut.detail).toContain('56%');
    expect(cut.detail).toContain('122x115 -> 122x51');
    // GATING, not advisory — this is objectively measurable, so it must block rather than advise.
    expect(cut.advisory).toBeFalsy();
  });

  it('CLIP_PROBE exempts the two clippings that are DELIBERATE', () => {
    // Source-level, like the STICKY_HEADER_JS assertions: CLIP_PROBE is pure layout geometry, and
    // jsdom's getBoundingClientRect returns zeros, so its behaviour can only be exercised in a real
    // browser. What this guards is that the two exemptions are not silently dropped.
    //
    // Why they exist: a false positive here is not free. A clone agent hit both and, to pass the gate,
    // replaced 14 `<img alt="…">` elements with CSS background divs (alt text and srcset gone) and
    // swapped an accordion's `max-width:0 → 100%` slide-open — which is what the ORIGINAL did — for a
    // `display:none` toggle, losing the animation. The gate made the output worse.
    //   • a SLIDER viewport clips by definition: queued slides sit outside it, and a "peek" carousel
    //     shows a sliver of the next slide on purpose.
    //   • a >95% clip means the element is hidden, not chopped — a collapsed accordion, a closed
    //     drawer. The visitor sees nothing, so there is no visual defect to report.
    expect(CLIP_PROBE.toString()).toContain('.embla');
    expect(CLIP_PROBE.toString()).toContain('.slick-list');
    expect(CLIP_PROBE.toString()).toContain('data-sw-part="container"');
    expect(CLIP_PROBE.toString()).toContain('if (bySlider) continue;');
    expect(CLIP_PROBE.toString()).toMatch(/>\s*0\.95\)\s*continue/);
    // and the partial-cut threshold that makes a REAL defect report must still be there
    expect(CLIP_PROBE.toString()).toMatch(/lostH > 0\.1 \|\| lostW > 0\.1/);
  });

  it('requires modals ONLY when the original has triggers', () => {
    expect(behaviouralChecks(behaviour({ hasModalTrigger: true, dialogs: 0 })).find((c) => c.id === 'modals')!.pass).toBe(false);
    expect(behaviouralChecks(behaviour({ hasModalTrigger: false, dialogs: 0 })).find((c) => c.id === 'modals')!.pass).toBe(true);
  });

  it('fails when a declared font did not load; mobile menu must be reachable', () => {
    expect(behaviouralChecks(behaviour({ headingFontLoaded: false })).find((c) => c.id === 'fonts')!.pass).toBe(false);
    expect(behaviouralChecks(behaviour({ bodyFontLoaded: false })).find((c) => c.id === 'fonts')!.pass).toBe(false);
    expect(behaviouralChecks(behaviour({ navExpected: 3, navReachableMobile: 0 })).find((c) => c.id === 'mobile-menu')!.pass).toBe(false);
    expect(behaviouralChecks(behaviour({ navExpected: 3, navReachableMobile: 5 })).find((c) => c.id === 'mobile-menu')!.pass).toBe(true);
  });
});

describe('visualChecks + assembleAudit', () => {
  it('marks BOTH computed-style visual legs advisory (never gating)', () => {
    const v = visualChecks({ body: { pass: true, coverage: 0.9, score: 0 }, chrome: { pass: false, coverage: 0.3, styleOff: 5, metaOff: 2 } });
    // body-fidelity + chrome-fidelity are BOTH advisory: computed-style coverage is blind to casing/dividers/
    // icon-style/section-height, so it steers the agent but never terminates the loop — visual_audit does.
    expect(v.find((c) => c.id === 'body-fidelity')!.advisory).toBe(true);
    expect(v.find((c) => c.id === 'chrome-fidelity')!.advisory).toBe(true);
  });

  it('gates ONLY on structure/behaviour: a clone whose only failures are computed-style is still GREEN', () => {
    const green = assembleAudit([
      structuralChecks({ datasets: [{ id: 'team', name: 'Team' }], media: [{ folder: 'Brand' }], pageSource: '<h1 data-sw-text="t">T</h1>' }),
      behaviouralChecks(behaviour()),
      // structure + behaviour pass; BOTH computed-style legs FAIL — both advisory, so the audit is still GREEN
      visualChecks({ body: { pass: false, coverage: 0.5, score: 0.3 }, chrome: { pass: false, coverage: 0.3, styleOff: 8, metaOff: 2 } }),
    ]);
    expect(green.pass).toBe(true);
    expect(green.passed).toBe(green.total); // advisory visual legs excluded from the count
    expect(green.checks.some((c) => c.id === 'body-fidelity' && !c.pass && c.advisory)).toBe(true); // still reported
    expect(green.checks.some((c) => c.id === 'chrome-fidelity' && !c.pass && c.advisory)).toBe(true);

    // RED comes purely from structure/behaviour now — computed-style visual all green can't rescue it.
    const red = assembleAudit([
      structuralChecks({ datasets: [{ id: 'items', name: 'List' }], media: [], pageSource: '<div>plain</div>' }),
      behaviouralChecks(behaviour({ carouselsEnhanced: 0 })),
      visualChecks({ body: { pass: true, coverage: 0.9, score: 0 }, chrome: { pass: true } }),
    ]);
    expect(red.pass).toBe(false);
    expect(red.passed).toBeLessThan(red.total);
  });
});
