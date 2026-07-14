import { describe, it, expect } from 'vitest';
import { structuralChecks, behaviouralChecks, visualChecks, assembleAudit, type BehaviourFacts } from '../src/render/clone-audit.js';

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
});

describe('behaviouralChecks', () => {
  it('fails a dead slider, passes a fully enhanced one (and when there are none)', () => {
    expect(behaviouralChecks(behaviour({ carousels: 1, carouselsEnhanced: 0 })).find((c) => c.id === 'sliders')!.pass).toBe(false);
    expect(behaviouralChecks(behaviour({ carousels: 2, carouselsEnhanced: 2 })).find((c) => c.id === 'sliders')!.pass).toBe(true);
    expect(behaviouralChecks(behaviour({ carousels: 0, carouselsEnhanced: 0 })).find((c) => c.id === 'sliders')!.pass).toBe(true);
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
