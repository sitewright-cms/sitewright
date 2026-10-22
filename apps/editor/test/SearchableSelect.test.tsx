import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { SearchableSelect } from '../src/views/ui/SearchableSelect';

const opts = [
  { value: 'a', label: '/about', keywords: 'About us' },
  { value: 'b', label: '/services/web', keywords: 'Web Design' },
  { value: 'c', label: '/contact', keywords: 'Contact' },
];

describe('SearchableSelect', () => {
  it('shows the selected option label and opens a searchable listbox', () => {
    render(<SearchableSelect ariaLabel="Parent" value="b" options={opts} onChange={() => {}} />);
    const combo = screen.getByRole('combobox', { name: 'Parent' });
    expect(combo).toHaveTextContent('/services/web');
    fireEvent.click(combo);
    expect(screen.getByRole('listbox', { name: 'Parent' })).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('shows the placeholder when nothing is selected', () => {
    render(<SearchableSelect ariaLabel="Parent" value="" options={opts} placeholder="Pick one…" onChange={() => {}} />);
    expect(screen.getByRole('combobox', { name: 'Parent' })).toHaveTextContent('Pick one…');
  });

  it('filters by label (path) OR keywords (title)', () => {
    render(<SearchableSelect ariaLabel="Parent" value="" options={opts} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Parent' }));
    const search = screen.getByLabelText('Search Parent');
    // by title keyword
    fireEvent.change(search, { target: { value: 'web design' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option')).toHaveTextContent('/services/web');
    // by path
    fireEvent.change(search, { target: { value: '/contact' } });
    expect(screen.getByRole('option')).toHaveTextContent('/contact');
    // no match → empty state
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('No matches.')).toBeInTheDocument();
  });

  it('selects an option on click, fires onChange, and closes', () => {
    const onChange = vi.fn();
    render(<SearchableSelect ariaLabel="Parent" value="" options={opts} onChange={onChange} />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Parent' }));
    fireEvent.click(within(screen.getByRole('listbox')).getByText('/about'));
    expect(onChange).toHaveBeenCalledWith('a');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('keyboard nav from the search box: ArrowDown moves, Enter selects (bubbles to the popover)', () => {
    const onChange = vi.fn();
    render(<SearchableSelect ariaLabel="Parent" value="" options={opts} onChange={onChange} />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Parent' }));
    const search = screen.getByLabelText('Search Parent');
    fireEvent.keyDown(search, { key: 'ArrowDown' }); // active 0 → 1
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('a new search highlights its first match, so Enter picks what was found', () => {
    const onChange = vi.fn();
    const greek = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'].map((w) => ({ value: w, label: w }));
    // The current value (the 3rd row) is highlighted when the list opens …
    render(<SearchableSelect ariaLabel="Parent" value="gamma" options={greek} onChange={onChange} />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Parent' }));
    const search = screen.getByLabelText('Search Parent');
    // … "a" finds alpha, beta, gamma, delta: still four rows, so the old 3rd-row highlight would survive it.
    fireEvent.change(search, { target: { value: 'a' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('alpha');
  });

  it('keeps the current value highlighted when the list opens', () => {
    const onChange = vi.fn();
    render(<SearchableSelect ariaLabel="Parent" value="c" options={opts} onChange={onChange} />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Parent' }));
    fireEvent.keyDown(screen.getByLabelText('Search Parent'), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('Tab from the search box closes the list and leaves focus on the field, from where the Tab moves on', () => {
    const onChange = vi.fn();
    render(<SearchableSelect ariaLabel="Parent" value="a" options={opts} onChange={onChange} />);
    const combo = screen.getByRole('combobox', { name: 'Parent' });
    fireEvent.click(combo);
    const search = screen.getByLabelText('Search Parent');
    expect(search).toHaveFocus();
    // Not prevented: the browser's own Tab then moves on from the field, not from a search box that is gone.
    expect(fireEvent.keyDown(search, { key: 'Tab' })).toBe(true);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(combo).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Escape closes the list without selecting', () => {
    const onChange = vi.fn();
    render(<SearchableSelect ariaLabel="Parent" value="a" options={opts} onChange={onChange} />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Parent' }));
    fireEvent.keyDown(screen.getByLabelText('Search Parent'), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('re-opening after a search resets the query + pre-highlights the SELECTED option (full list)', () => {
    const onChange = vi.fn();
    // 'c' (/contact) is selected. Open, narrow the list to just '/about', Escape, re-open.
    render(<SearchableSelect ariaLabel="Parent" value="c" options={opts} onChange={onChange} />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Parent' }));
    fireEvent.change(screen.getByLabelText('Search Parent'), { target: { value: 'about' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(screen.getByLabelText('Search Parent'), { key: 'Escape' });
    // Re-open: the query is cleared (all 3 shown) and Enter selects the ORIGINALLY selected 'c',
    // not the stale 'about' that had been filtered — i.e. the pre-highlight indexes the full list.
    fireEvent.click(screen.getByRole('combobox', { name: 'Parent' }));
    expect(screen.getAllByRole('option')).toHaveLength(3);
    fireEvent.keyDown(screen.getByLabelText('Search Parent'), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('is inert when disabled (does not open)', () => {
    render(<SearchableSelect ariaLabel="Parent" value="a" options={opts} disabled onChange={() => {}} />);
    const combo = screen.getByRole('combobox', { name: 'Parent' });
    expect(combo).toBeDisabled();
    fireEvent.click(combo);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
