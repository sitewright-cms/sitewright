// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SearchSelect } from '../src/views/ui/SearchSelect';

/**
 * A `<select>` you can type into.
 *
 * The reason it exists: a native select is fine for five options and useless for five hundred, and its
 * own type-ahead only matches a PREFIX of the label — the one part of a page title or entry name you
 * are least likely to remember.
 */

const OPTIONS = [
  { value: 'home', label: 'Home', hint: '/' },
  { value: 'svc', label: 'Our services', hint: '/services' },
  { value: 'web', label: 'Web design', hint: '/services/web-design' },
];

const open = (props: Partial<Parameters<typeof SearchSelect>[0]> = {}) => {
  const onChange = vi.fn();
  render(<SearchSelect ariaLabel="Page" value="" options={OPTIONS} onChange={onChange} {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Page' }));
  return { onChange };
};

afterEach(cleanup);

describe('SearchSelect', () => {
  it('filters on a MID-STRING match of the label, the hint, or the stored value', () => {
    open();
    const search = screen.getByLabelText('Search Page');
    // "services" is in the middle of "Our services" — a native select's type-ahead would find nothing.
    fireEvent.change(search, { target: { value: 'services' } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Our services/services', 'Web design/services/web-design']);
    // The HINT is matched too (a page's route), and so is the raw stored value…
    fireEvent.change(search, { target: { value: 'web-design' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.change(search, { target: { value: 'svc' } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Our services/services']);
  });

  it('commits on click and on Enter over the highlighted row', () => {
    const { onChange } = open();
    fireEvent.click(screen.getByRole('option', { name: /Web design/ }));
    expect(onChange).toHaveBeenCalledWith('web');
    expect(screen.queryByRole('listbox')).toBeNull(); // and closes

    cleanup();
    const second = open();
    const search = screen.getByLabelText('Search Page');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(second.onChange).toHaveBeenCalledWith('svc');
  });

  it('Escape closes the picker WITHOUT closing the modal it sits in', () => {
    const onModalEscape = vi.fn();
    document.addEventListener('keydown', onModalEscape);
    open();
    fireEvent.keyDown(screen.getByLabelText('Search Page'), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    // The entry editor and the schema editor both live in a Modal that closes on Escape. Without the
    // stopPropagation, dismissing the dropdown would throw away the whole form behind it.
    expect(onModalEscape).not.toHaveBeenCalled();
    document.removeEventListener('keydown', onModalEscape);
  });

  it('shows the selected LABEL on the trigger, and names a value that no longer exists', () => {
    render(<SearchSelect ariaLabel="Page" value="web" options={OPTIONS} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Page' }).textContent).toContain('Web design');
    cleanup();
    // A reference to a since-deleted page must SAY so rather than looking like an empty field, which
    // would read as "nothing selected" and quietly lose the reference on the next save.
    render(<SearchSelect ariaLabel="Page" value="gone" options={OPTIONS} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Page' }).textContent).toContain('gone (missing)');
  });

  it('clears the selection without opening the list', () => {
    const onChange = vi.fn();
    render(<SearchSelect ariaLabel="Page" value="web" options={OPTIONS} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear Page' }));
    expect(onChange).toHaveBeenCalledWith('');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('distinguishes an EMPTY option set from a search that matched nothing', () => {
    open({ options: [] });
    expect(screen.getByText('Nothing to choose from yet.')).toBeInTheDocument();
    cleanup();
    open();
    fireEvent.change(screen.getByLabelText('Search Page'), { target: { value: 'zzz' } });
    expect(screen.getByText(/Nothing matched/)).toBeInTheDocument();
  });

  it('starts each opening with a fresh query', () => {
    open();
    fireEvent.change(screen.getByLabelText('Search Page'), { target: { value: 'zzz' } });
    fireEvent.click(screen.getByRole('button', { name: 'Page' })); // close
    fireEvent.click(screen.getByRole('button', { name: 'Page' })); // re-open
    // An inherited filter looks like a list that has lost most of its options.
    expect(screen.getAllByRole('option')).toHaveLength(OPTIONS.length);
  });
});
