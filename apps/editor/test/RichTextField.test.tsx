import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RichTextField } from '../src/views/datasets/RichTextField';

describe('RichTextField', () => {
  it('fills the editable with the stored value on mount', () => {
    render(<RichTextField value="<p>Hello world</p>" onChange={() => {}} ariaLabel="body" />);
    expect(screen.getByRole('textbox', { name: 'body' }).innerHTML).toContain('Hello world');
  });

  it('renders the formatting toolbar (mirrors the on-page editor commands)', () => {
    render(<RichTextField value="" onChange={() => {}} ariaLabel="body" />);
    for (const name of ['Bold', 'Italic', 'Heading 2', 'Quote', 'Bulleted list', 'Numbered list', 'Edit HTML source']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('toggles to an HTML-source textarea that edits the raw value', () => {
    const onChange = vi.fn();
    render(<RichTextField value="<p>Hi</p>" onChange={onChange} ariaLabel="body" />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit HTML source' }));
    const ta = screen.getByRole('textbox', { name: /html source/i }) as HTMLTextAreaElement;
    expect(ta.value).toBe('<p>Hi</p>');
    fireEvent.change(ta, { target: { value: '<p>Bye</p>' } });
    expect(onChange).toHaveBeenLastCalledWith('<p>Bye</p>');
  });

  it('re-fills the editable when toggling back from source mode (no blank editor)', () => {
    render(<RichTextField value="<p>Keep me</p>" onChange={() => {}} ariaLabel="body" />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit HTML source' })); // → source
    fireEvent.click(screen.getByRole('button', { name: 'Edit HTML source' })); // → wysiwyg
    expect(screen.getByRole('textbox', { name: 'body' }).innerHTML).toContain('Keep me');
  });
});
