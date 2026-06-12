import { describe, it, expect } from 'vitest';
import * as schema from '../src/index.js';

const EXPECTED_SCHEMAS = [
  'BrandSchema',
  'DatasetSchema',
  'EntrySchema',
  'FieldSchema',
  'PageSchema',
  'ProjectSchema',
  'FieldTypeSchema',
  'ProjectSettingsSchema',
] as const;

describe('public API (index barrel)', () => {
  it('exposes the project format version', () => {
    expect(typeof schema.PROJECT_FORMAT_VERSION).toBe('number');
  });

  it('re-exports every core schema', () => {
    for (const name of EXPECTED_SCHEMAS) {
      expect(schema[name], name).toBeDefined();
    }
  });
});
