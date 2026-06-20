import { describe, expect, it } from 'vitest';
import { isRawFidelityPage } from '../src/import/raw-fidelity.js';

describe('isRawFidelityPage', () => {
  it('is true for a still-faithful imported page (swImport present, not nativized)', () => {
    expect(isRawFidelityPage({ data: { swImport: { sourceUrl: 'https://x/', rewritten: false } } })).toBe(true);
  });
  it('is false once nativized (rewritten:true)', () => {
    expect(isRawFidelityPage({ data: { swImport: { sourceUrl: 'https://x/', rewritten: true } } })).toBe(false);
  });
  it('is false for a normal (non-imported) page', () => {
    expect(isRawFidelityPage({ data: {} })).toBe(false);
    expect(isRawFidelityPage({})).toBe(false);
    expect(isRawFidelityPage({ data: { other: 1 } })).toBe(false);
  });
});
