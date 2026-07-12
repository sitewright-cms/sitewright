import { describe, it, expect } from 'vitest';
import { checkNativeMarkers, buildAuthorPrompt, buildGateFeedback, gatePasses, type CloneGateResult } from '../src/ai/clone-orchestrator.js';

describe('checkNativeMarkers — anti-lie source audit', () => {
  it('accepts a genuinely native source (native markers, ~no foreign)', () => {
    const src = '<section class="sw-container"><div data-sw-text="title">Hi</div>{{#each dataset.services}}<a>{{sw-url this.href}}</a>{{/each}}</section>';
    const r = checkNativeMarkers(src);
    expect(r.foreign).toBe(0);
    expect(r.native).toBeGreaterThan(0);
    expect(r.ok).toBe(true);
  });

  it('rejects a raw foreign import (Materialize/FontAwesome/grid markers in bulk)', () => {
    const src = '<div class="d-flex col-md-6 waves-effect"><i class="fa fa-star"></i><i class="fa fa-check"></i><div class="cb-modal grid-md-3"></div></div>';
    const r = checkNativeMarkers(src);
    expect(r.foreign).toBeGreaterThan(5);
    expect(r.ok).toBe(false);
  });

  it('rejects an empty/absent source (no native markers)', () => {
    expect(checkNativeMarkers('').ok).toBe(false);
    expect(checkNativeMarkers(null).ok).toBe(false);
  });

  it('tolerates a few stray foreign-looking tokens on an otherwise native page', () => {
    const src = '<section class="sw-container"><div data-sw-text="x">y</div><span class="col-md-6"></span></section>';
    expect(checkNativeMarkers(src).ok).toBe(true); // 1 foreign ≤ 5 tolerance, native present
  });
});

describe('buildAuthorPrompt', () => {
  it('names the page + id and mandates the gate-driven loop', () => {
    const p = buildAuthorPrompt({ pageId: 'home', slug: '', title: 'Home' });
    expect(p).toContain('page id: home');
    expect(p).toContain('visual_audit("home")');
    expect(p).toContain('clone_audit("home")');
    expect(p).toContain('get_guide("import")');
    expect(p).toContain('Do NOT declare the page done');
  });
});

describe('buildGateFeedback', () => {
  it('surfaces the raw-import marker failure prominently', () => {
    const gate: CloneGateResult = { pass: false, structuralFails: [], markers: { native: 2, foreign: 200, ok: false } };
    expect(buildGateFeedback(gate)).toContain('STILL A RAW IMPORT');
    expect(buildGateFeedback(gate)).toContain('200 foreign');
  });

  it('lists the deterministic structural failures + reminds the agent to self-judge visual_audit', () => {
    const gate: CloneGateResult = { pass: false, structuralFails: ['sliders not enhanced'], markers: { native: 40, foreign: 0, ok: true } };
    const fb = buildGateFeedback(gate);
    expect(fb).toContain('sliders not enhanced');
    // The visual fidelity is the agent's own job now (deterministic gate doesn't judge it).
    expect(fb).toContain('visual_audit');
  });
});

describe('gatePasses — deterministic: structure/behaviour + not-a-raw-import', () => {
  const base: CloneGateResult = { pass: false, structuralFails: [], markers: { native: 10, foreign: 0, ok: true } };
  it('passes when structure + markers pass', () => {
    expect(gatePasses(base)).toBe(true);
  });
  it('fails if a structural check fails', () => {
    expect(gatePasses({ ...base, structuralFails: ['modals missing'] })).toBe(false);
  });
  it('fails if the source is still a raw import', () => {
    expect(gatePasses({ ...base, markers: { native: 2, foreign: 99, ok: false } })).toBe(false);
  });
});
