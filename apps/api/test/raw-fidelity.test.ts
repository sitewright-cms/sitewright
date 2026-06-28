import { describe, expect, it } from 'vitest';
import { isUnnativizedImport } from '../src/import/raw-fidelity.js';

describe('isUnnativizedImport', () => {
  it('is true for a still-faithful imported page (swImport present, not nativized)', () => {
    expect(isUnnativizedImport({ data: { swImport: { sourceUrl: 'https://x/', rewritten: false } } })).toBe(true);
  });
  it('is false once nativized (rewritten:true)', () => {
    expect(isUnnativizedImport({ data: { swImport: { sourceUrl: 'https://x/', rewritten: true } } })).toBe(false);
  });
  it('is false for a normal (non-imported) page', () => {
    expect(isUnnativizedImport({ data: {} })).toBe(false);
    expect(isUnnativizedImport({})).toBe(false);
    expect(isUnnativizedImport({ data: { other: 1 } })).toBe(false);
  });
});
