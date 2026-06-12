import { describe, it, expect } from 'vitest';
import { COMPONENT_CATALOG } from '@sitewright/schema';
import { COMPONENT_TYPES, componentTypesInSource } from '../src/components.js';
import { validateTemplate } from '../src/template.js';

// The catalog (in @sitewright/schema) is the machine-readable authoring contract served to
// agents (MCP get_components / GET /authoring/components). These tests pin it to the runtime
// registry so the two can never drift: every shipped component is documented, every documented
// component ships, and every skeleton is real, validator-safe markup the scanner detects.
describe('COMPONENT_CATALOG ↔ runtime registry', () => {
  it('documents exactly the registered component types', () => {
    const catalogTypes = COMPONENT_CATALOG.map((c) => c.type).sort();
    expect(catalogTypes).toEqual([...COMPONENT_TYPES].sort());
  });

  it('markers are unique and match the runtime marker vocabulary', () => {
    const markers = COMPONENT_CATALOG.map((c) => c.marker);
    expect(new Set(markers).size).toBe(markers.length);
    for (const entry of COMPONENT_CATALOG) {
      // The marker round-trips through the scanner: a minimal element carrying it is detected
      // as this component. (The Form marker is stamped at render; its skeleton is the embed
      // helper, which the scanner also detects — asserted below.)
      const detected = componentTypesInSource(`<div data-sw-component="${entry.marker}"></div>`);
      expect(detected, entry.type).toContain(entry.type);
    }
  });

  it('every skeleton passes the template validator and is detected by the component scanner', () => {
    for (const entry of COMPONENT_CATALOG) {
      expect(() => validateTemplate(entry.skeleton), `${entry.type} skeleton must be validator-safe`).not.toThrow();
      expect(componentTypesInSource(entry.skeleton), `${entry.type} skeleton must ship its own assets`).toContain(entry.type);
    }
  });

  it('entries are complete (summary, parts, no-JS story, usage notes)', () => {
    for (const entry of COMPONENT_CATALOG) {
      expect(entry.summary.length, entry.type).toBeGreaterThan(20);
      expect(entry.noJs.length, entry.type).toBeGreaterThan(20);
      expect(entry.notes.length, entry.type).toBeGreaterThan(20);
      expect(entry.parts.length, entry.type).toBeGreaterThan(0);
      expect(['markup', 'embed']).toContain(entry.authoring);
    }
  });
});
