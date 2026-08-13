// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { IconField } from '../src/views/ui/IconPicker';

/**
 * The platform icon picker — Phosphor at every weight, brand logos, country flags in two shapes.
 *
 * The thing these tests are really about is that a picker is for people who do NOT already know the
 * library's spelling. Someone looking for the Dutch flag types "Netherlands", not "nl".
 */

const openPicker = (value = '') => {
  const onChange = vi.fn();
  render(<IconField value={value} onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'Choose the icon' }));
  return { onChange, dialog: screen.getByRole('dialog', { name: 'Choose an icon' }) };
};

afterEach(cleanup);

describe('IconPicker', () => {
  it('switches icon WEIGHT with pills, like every other choice in the picker', () => {
    const { dialog } = openPicker();
    const weights = within(dialog).getByRole('radiogroup', { name: 'Icon weight' });
    const names = within(weights).getAllByRole('radio').map((b) => b.textContent);
    expect(names).toEqual(['thin', 'light', 'regular', 'bold', 'fill', 'duotone']);
    // `fill` is the platform default, so that is what the picker opens on.
    expect(within(weights).getByRole('radio', { name: 'fill' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(within(weights).getByRole('radio', { name: 'bold' }));
    expect(within(weights).getByRole('radio', { name: 'bold' })).toHaveAttribute('aria-checked', 'true');
    // …and the weight rides into the picked name. (Queried by TITLE: the tile's accessible name is its
    // visible label — "gear" — while the title carries the full platform spelling.)
    fireEvent.change(within(dialog).getByLabelText('Search icons'), { target: { value: 'gear' } });
    expect(within(dialog).getByTitle('gear — gear:bold')).toBeInTheDocument();
  });

  it('finds a flag by COUNTRY NAME, and labels the tile with it', () => {
    const { dialog, onChange } = openPicker();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Flags' }));
    fireEvent.change(within(dialog).getByLabelText('Search icons'), { target: { value: 'netherlands' } });
    // Labelled by the country. A grid of two-letter codes is unreadable, and "nl" is the one thing the
    // author does not know — before this, searching "netherlands" matched nothing at all.
    const tile = within(dialog).getByTitle('Netherlands — flag:nl');
    expect(tile.textContent).toContain('Netherlands');
    expect(within(dialog).getByRole('button', { name: 'Netherlands' })).toBe(tile);
    // The CODE stays searchable — it is what a template author already has in front of them.
    fireEvent.change(within(dialog).getByLabelText('Search icons'), { target: { value: 'nl' } });
    expect(within(dialog).getByTitle('Netherlands — flag:nl')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByTitle('Netherlands — flag:nl'));
    expect(onChange).toHaveBeenCalledWith('flag:nl');
  });

  it('the shape pills re-cut the flag set and what gets picked', () => {
    const { dialog, onChange } = openPicker();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Flags' }));
    const shapes = within(dialog).getByRole('radiogroup', { name: 'Flag shape' });
    expect(within(shapes).getByRole('radio', { name: 'Rectangular' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(within(shapes).getByRole('radio', { name: 'Round' }));
    fireEvent.change(within(dialog).getByLabelText('Search icons'), { target: { value: 'germany' } });
    fireEvent.click(within(dialog).getByTitle('Germany — flag:de-circle'));
    expect(onChange).toHaveBeenCalledWith('flag:de-circle');
  });

  it('re-opens on the shape and weight the current value already uses', () => {
    const { dialog } = openPicker('flag:de-circle');
    expect(within(dialog).getByRole('button', { name: 'Flags' })).toHaveClass('font-bold');
    const shapes = within(dialog).getByRole('radiogroup', { name: 'Flag shape' });
    expect(within(shapes).getByRole('radio', { name: 'Round' })).toHaveAttribute('aria-checked', 'true');
  });

  it('gives every tile a fixed height and a ripple, so a short result set stays a grid of icons', () => {
    // The grid is a flex CHILD filling the modal: without a row height, the two rows a narrow search
    // returns stretch to the full height and each tile becomes a tall empty box with a glyph in it.
    const { dialog } = openPicker();
    fireEvent.change(within(dialog).getByLabelText('Search icons'), { target: { value: 'gear' } });
    // `fill` is the default weight, so the platform spelling carries the suffix (only `regular` is bare).
    const tile = within(dialog).getByTitle('gear — gear:fill');
    expect(tile.className).toContain('h-[4.5rem]');
    expect(tile.className).toContain('waves-effect'); // selecting an icon gives the same feedback as every other control
    expect(tile.parentElement?.className).toContain('content-start');
  });
});
