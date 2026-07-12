import { describe, it, expect } from 'vitest';
import { checkNativeMarkers, buildAuthorPrompt, buildGateFeedback, gatePasses, type CloneGateResult } from '../src/ai/clone-orchestrator.js';
import type { VisualDefect } from '../src/render/visual-audit.js';

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

const defect = (severity: VisualDefect['severity'], description = 'x'): VisualDefect => ({ region: 'hero', category: 'image', severity, description });

describe('buildGateFeedback', () => {
  it('surfaces the raw-import marker failure prominently', () => {
    const gate: CloneGateResult = {
      pass: false,
      visual: { pass: true, summary: '', defects: [] },
      structuralFails: [],
      markers: { native: 2, foreign: 200, ok: false },
    };
    expect(buildGateFeedback(gate)).toContain('STILL A RAW IMPORT');
    expect(buildGateFeedback(gate)).toContain('200 foreign');
  });

  it('lists blocker + major visual defects but SKIPS minors (advisory)', () => {
    const gate: CloneGateResult = {
      pass: false,
      visual: { pass: false, summary: 'hero image missing', defects: [defect('major', 'no hero photo'), defect('minor', 'tiny spacing')] },
      structuralFails: ['sliders not enhanced'],
      markers: { native: 40, foreign: 0, ok: true },
    };
    const fb = buildGateFeedback(gate);
    expect(fb).toContain('no hero photo');
    expect(fb).toContain('sliders not enhanced');
    expect(fb).not.toContain('tiny spacing');
  });
});

describe('gatePasses — all three legs must pass', () => {
  const base: CloneGateResult = { pass: false, visual: { pass: true, summary: '', defects: [] }, structuralFails: [], markers: { native: 10, foreign: 0, ok: true } };
  it('passes when visual + structure + markers all pass', () => {
    expect(gatePasses(base)).toBe(true);
  });
  it('fails if the visual leg fails', () => {
    expect(gatePasses({ ...base, visual: { pass: false, summary: '', defects: [defect('major')] } })).toBe(false);
  });
  it('fails if a structural check fails', () => {
    expect(gatePasses({ ...base, structuralFails: ['modals missing'] })).toBe(false);
  });
  it('fails if the source is still a raw import', () => {
    expect(gatePasses({ ...base, markers: { native: 2, foreign: 99, ok: false } })).toBe(false);
  });
});
