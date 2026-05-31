import { describe, expect, it } from 'vitest';
import {
  BLOCK_DESCRIPTORS,
  defaultPropsFor,
  descriptorFor,
  isContainerType,
} from '../src/descriptors.js';

// The renderer's component map — descriptors must stay in lockstep with it.
const RENDERED_TYPES = [
  'Section',
  'Hero',
  'Heading',
  'RichText',
  'Image',
  'Grid',
  'Card',
  'Button',
  'Icon',
  'Link',
  'Nav',
  'Header',
  'Footer',
  'Html',
  'Carousel',
  'Slide',
  'Accordion',
  'AccordionItem',
  'Lightbox',
  'LightboxItem',
  'Modal',
  'CookieConsent',
  'Tabs',
  'Tab',
  'Form',
];

describe('BLOCK_DESCRIPTORS', () => {
  it('covers every renderable block type exactly once', () => {
    const types = BLOCK_DESCRIPTORS.map((d) => d.type).sort();
    expect(types).toEqual([...RENDERED_TYPES].sort());
  });

  it('gives every descriptor a label and a known category', () => {
    for (const d of BLOCK_DESCRIPTORS) {
      expect(d.label.length).toBeGreaterThan(0);
      expect(['layout', 'content', 'nav', 'component']).toContain(d.category);
    }
  });

  it('only uses supported field input kinds, with options for selects', () => {
    const inputs = new Set(['text', 'textarea', 'number', 'url', 'select', 'boolean']);
    for (const d of BLOCK_DESCRIPTORS) {
      for (const f of d.fields) {
        expect(inputs.has(f.input)).toBe(true);
        expect(f.key.length).toBeGreaterThan(0);
        if (f.input === 'select') {
          expect((f.options ?? []).length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('descriptorFor / isContainerType', () => {
  it('finds a descriptor by type', () => {
    expect(descriptorFor('Hero')?.label).toBeTruthy();
    expect(descriptorFor('Nope')).toBeUndefined();
  });

  it('marks layout containers and the slotted blocks as containers', () => {
    expect(isContainerType('Section')).toBe(true);
    expect(isContainerType('Grid')).toBe(true);
    expect(isContainerType('Card')).toBe(true);
    expect(isContainerType('Heading')).toBe(false);
    expect(isContainerType('Image')).toBe(false);
  });
});

describe('defaultPropsFor', () => {
  it('builds props from the descriptor field defaults', () => {
    const props = defaultPropsFor('Heading');
    expect(props).toHaveProperty('level');
  });

  it('returns an empty object for blocks without defaulted fields', () => {
    expect(defaultPropsFor('Card')).toEqual({});
  });

  it('returns an empty object for an unknown type', () => {
    expect(defaultPropsFor('Nope')).toEqual({});
  });
});
