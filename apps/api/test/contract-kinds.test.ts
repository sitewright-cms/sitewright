import { describe, it, expect } from 'vitest';
import { CONTENT_KINDS } from '../src/repo/content.js';
import { API_KEY_CAPABILITIES } from '../src/db/schema.js';
import { expectContract } from './contract-helpers.js';

// Two small vocabularies that appear in URLs, stored rows and export bundles, so a rename is a data
// migration rather than a refactor.
describe('contract: vocabularies', () => {
  it('content kinds match the committed list', () => {
    expectContract('content-kinds.json', [...CONTENT_KINDS].sort());
  });

  it('API-key capabilities match the committed list', () => {
    expectContract('capabilities.json', [...API_KEY_CAPABILITIES].sort());
  });

  it('keeps destructive deletes behind their own capability', () => {
    // The separation is the promise, not just the names: an integration granted content:write must
    // never gain delete by accident. Named here so collapsing them can't pass as a simplification.
    expect(API_KEY_CAPABILITIES).toContain('content:write');
    expect(API_KEY_CAPABILITIES).toContain('content:delete');
  });
});
