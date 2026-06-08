import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BusinessTypeModal, BUSINESS_TYPE_DISABLED } from '../src/views/settings/BusinessTypeModal';
import { SCHEMA_ORG_TYPES } from '../src/views/settings/schema-org-types';

describe('SCHEMA_ORG_TYPES', () => {
  it('has unique, PascalCase @types with non-empty labels + groups', () => {
    const types = SCHEMA_ORG_TYPES.map((t) => t.type);
    expect(new Set(types).size).toBe(types.length);
    for (const t of SCHEMA_ORG_TYPES) {
      // schema.org identifiers are PascalCase letters (some include digits/acronyms like HVACBusiness).
      expect(t.type, t.type).toMatch(/^[A-Z][A-Za-z0-9]*$/);
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.group.length).toBeGreaterThan(0);
    }
  });
});

describe('BusinessTypeModal', () => {
  it('filters by search and selects a preset by its @type', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<BusinessTypeModal value="" onSelect={onSelect} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Search business types'), { target: { value: 'restaurant' } });
    fireEvent.click(screen.getByRole('button', { name: 'Restaurant Restaurant' }));
    expect(onSelect).toHaveBeenCalledWith('Restaurant');
    expect(onClose).toHaveBeenCalled();
  });

  it('offers Disabled (the JSON-LD-suppressing sentinel)', () => {
    const onSelect = vi.fn();
    render(<BusinessTypeModal value="" onSelect={onSelect} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /^Disabled/ }));
    expect(onSelect).toHaveBeenCalledWith(BUSINESS_TYPE_DISABLED);
  });

  it('offers Default (clears to empty)', () => {
    const onSelect = vi.fn();
    render(<BusinessTypeModal value="Restaurant" onSelect={onSelect} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /^Default/ }));
    expect(onSelect).toHaveBeenCalledWith('');
  });

  it('allows a custom @type when no preset matches the search', () => {
    const onSelect = vi.fn();
    render(<BusinessTypeModal value="" onSelect={onSelect} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Search business types'), { target: { value: 'Spaceport' } });
    fireEvent.click(screen.getByRole('button', { name: /Use .*Spaceport.* as a custom @type/ }));
    expect(onSelect).toHaveBeenCalledWith('Spaceport');
  });
});
