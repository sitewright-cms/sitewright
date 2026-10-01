// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { SocialProfilesEditor } from '../src/views/settings/SocialProfilesEditor';
import type { KeyedSocial } from '../src/views/settings/model';

afterEach(cleanup);

const rows = (over: Partial<KeyedSocial> = {}): KeyedSocial[] => [
  { id: 'r1', link: 'https://github.com/acme', name: 'GitHub', icon: 'brand:github', ...over },
];

describe('SocialProfilesEditor — the icon control', () => {
  it('offers a swatch that opens the icon library, BESIDE an input that stays editable', () => {
    // ★ The value is auto-detected from the URL and is often pasted, so replacing the input with a
    // picker-only control (as IconField does elsewhere) would take away the ability to type it. The
    // swatch is an addition: see the icon, browse for one — without losing the text.
    const onChange = vi.fn();
    render(<SocialProfilesEditor rows={rows()} onChange={onChange} />);

    const input = screen.getByLabelText('Social icon 1', { exact: true }) as HTMLInputElement;
    expect(input.value).toBe('brand:github');
    fireEvent.change(input, { target: { value: 'brand:x' } });
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ icon: 'brand:x' })]);

    expect(screen.getByRole('button', { name: 'Pick an icon for profile 1' })).toBeTruthy();
  });

  it('names the swatch so it cannot be confused with the input it sits next to', () => {
    // "Choose social icon 1" would CONTAIN "Social icon 1", leaving two controls answering to one
    // name — ambiguous to a screen reader, and to any by-name query.
    render(<SocialProfilesEditor rows={rows()} onChange={vi.fn()} />);
    expect(screen.getAllByLabelText(/Social icon 1/)).toHaveLength(1);
    expect(screen.getAllByLabelText(/Pick an icon for profile 1/)).toHaveLength(1);
  });

  it('shows the CURRENT icon in the swatch, and a placeholder when nothing is picked', () => {
    const { container, rerender } = render(<SocialProfilesEditor rows={rows()} onChange={vi.fn()} />);
    const swatch = () => screen.getByRole('button', { name: 'Pick an icon for profile 1' });
    expect(swatch().querySelector('svg')).toBeTruthy(); // the brand mark

    rerender(<SocialProfilesEditor rows={rows({ icon: '' })} onChange={vi.fn()} />);
    // Nothing picked must not look like "picked something that draws nothing": a dashed outline.
    expect(swatch().className).toContain('border-dashed');
    void container;
  });

  it('writes the picked name into the row', () => {
    const onChange = vi.fn();
    render(<SocialProfilesEditor rows={rows({ icon: '' })} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pick an icon for profile 1' }));
    const dialog = screen.getByRole('dialog', { name: 'Choose an icon' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Brands' }));
    fireEvent.change(within(dialog).getByLabelText(/Search/i), { target: { value: 'github' } });
    fireEvent.click(within(dialog).getAllByRole('button', { name: /github/i })[0]!);
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ icon: 'brand:github' })]);
  });
});
