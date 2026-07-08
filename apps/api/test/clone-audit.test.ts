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
    // an auto-slug id ("list"/"items3") is flagged even if the name was later made friendly
    expect(structuralChecks({ datasets: [{ id: 'list', name: 'Clients' }], media: [], pageSource: '{{sw-control "x"}}' }).find((c) => c.id === 'datasets')!.pass).toBe(false);
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
  it('folds in fidelity_check body + chrome pass', () => {
    const v = visualChecks({ body: { pass: true, coverage: 0.9, score: 0 }, chrome: { pass: false, coverage: 0.3, styleOff: 5, metaOff: 2 } });
    expect(v.find((c) => c.id === 'body-fidelity')!.pass).toBe(true);
    expect(v.find((c) => c.id === 'chrome-fidelity')!.pass).toBe(false);
  });

  it('is RED if any check fails, GREEN only when all pass', () => {
    const green = assembleAudit([
      structuralChecks({ datasets: [{ id: 'team', name: 'Team' }], media: [{ folder: 'Brand' }], pageSource: '<h1 data-sw-text="t">T</h1>' }),
      behaviouralChecks(behaviour()),
      visualChecks({ body: { pass: true, coverage: 0.9, score: 0 }, chrome: { pass: true, coverage: 0.9, styleOff: 0, metaOff: 0 } }),
    ]);
    expect(green.pass).toBe(true);
    expect(green.passed).toBe(green.total);

    const red = assembleAudit([
      structuralChecks({ datasets: [{ id: 'items', name: 'List' }], media: [], pageSource: '<div>plain</div>' }),
      behaviouralChecks(behaviour({ carouselsEnhanced: 0 })),
      visualChecks(null),
    ]);
    expect(red.pass).toBe(false);
    expect(red.passed).toBeLessThan(red.total);
  });
});
