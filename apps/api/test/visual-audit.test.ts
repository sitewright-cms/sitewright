import { describe, it, expect } from 'vitest';
import { VISUAL_AUDIT_RUBRIC, VISUAL_DEFECT_CATEGORIES, VISUAL_DEFECT_SEVERITIES } from '../src/render/visual-audit.js';

describe('visual audit — deterministic (the caller judges; no server AI)', () => {
  it('exposes the defect taxonomy the driving model tags against', () => {
    expect(VISUAL_DEFECT_CATEGORIES).toContain('image');
    expect(VISUAL_DEFECT_CATEGORIES).toContain('component');
    expect(VISUAL_DEFECT_CATEGORIES).toContain('layout');
    expect(VISUAL_DEFECT_SEVERITIES).toEqual(['blocker', 'major', 'minor']);
  });

  it('the rubric tells the caller to judge the PIXELS region-by-region + names the lying-metric trap', () => {
    expect(VISUAL_AUDIT_RUBRIC).toMatch(/region by region|REGION BY REGION/i);
    // It must call out what computed-style checks miss (the whole reason the vision gate exists).
    expect(VISUAL_AUDIT_RUBRIC.toLowerCase()).toContain('font');
    expect(VISUAL_AUDIT_RUBRIC.toLowerCase()).toMatch(/loaded|never loaded|glyph/);
    // The pass bar is zero blocker + major.
    expect(VISUAL_AUDIT_RUBRIC.toLowerCase()).toContain('zero blocker');
  });

  it('is plain text (no server prompt leaking a JSON-only contract — the caller decides its own format)', () => {
    // We no longer force a JSON response shape (there is no server-side parse); it's guidance for a human/LLM.
    expect(typeof VISUAL_AUDIT_RUBRIC).toBe('string');
    expect(VISUAL_AUDIT_RUBRIC.length).toBeGreaterThan(200);
  });
});
