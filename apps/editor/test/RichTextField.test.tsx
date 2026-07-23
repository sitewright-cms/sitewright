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
    for (const name of [
      'Bold', 'Italic', 'Heading 2', 'Quote', 'Bulleted list', 'Numbered list',
      'Text color', 'Highlight', 'Text size', 'Alignment', 'Increase indent', 'Link', 'Insert table',
      'Edit HTML source',
    ]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('opens the text-color popover with standard swatches', () => {
    render(<RichTextField value="<p>x</p>" onChange={() => {}} ariaLabel="body" />);
    fireEvent.click(screen.getByRole('button', { name: 'Text color' }));
    expect(screen.getByRole('button', { name: 'Red' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Default' })).toBeInTheDocument();
  });

  it('opens the text-size menu', () => {
    render(<RichTextField value="<p>x</p>" onChange={() => {}} ariaLabel="body" />);
    fireEvent.click(screen.getByRole('button', { name: 'Text size' }));
    expect(screen.getByRole('button', { name: 'Large' })).toBeInTheDocument();
  });

  it('opens the alignment menu', () => {
    render(<RichTextField value="<p>x</p>" onChange={() => {}} ariaLabel="body" />);
    fireEvent.click(screen.getByRole('button', { name: 'Alignment' }));
    expect(screen.getByRole('button', { name: 'Center' })).toBeInTheDocument();
  });

  it('dismisses an open popover on a mousedown outside the toolbar', () => {
    render(<RichTextField value="<p>x</p>" onChange={() => {}} ariaLabel="body" />);
    fireEvent.click(screen.getByRole('button', { name: 'Text color' }));
    expect(screen.getByRole('button', { name: 'Red' })).toBeInTheDocument();
    fireEvent.mouseDown(document.body); // click away
    expect(screen.queryByRole('button', { name: 'Red' })).not.toBeInTheDocument();
  });

  it('shows the Insert image button only when a projectId is provided', () => {
    const { rerender } = render(<RichTextField value="" onChange={() => {}} ariaLabel="body" />);
    expect(screen.queryByRole('button', { name: 'Insert image' })).not.toBeInTheDocument();
    rerender(<RichTextField value="" onChange={() => {}} ariaLabel="body" projectId="p1" />);
    expect(screen.getByRole('button', { name: 'Insert image' })).toBeInTheDocument();
  });

  it('the link popover offers an "Open in new tab" checkbox', () => {
    render(<RichTextField value="<p>x</p>" onChange={() => {}} ariaLabel="body" />);
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    expect(screen.getByLabelText('Open in new tab')).toBeInTheDocument();
  });

  it('edits an existing link in place even after the URL input steals the selection', () => {
    // Regression guard: the popover input moves window.getSelection() OUT of the editable, so Apply must act
    // on the caret captured at open — not on the live (moved) selection — or it splices a stray anchor.
    const onChange = vi.fn();
    render(<RichTextField value='<p><a href="/old">link</a></p>' onChange={onChange} ariaLabel="body" />);
    const editable = screen.getByRole('textbox', { name: 'body' });
    const a = editable.querySelector('a')!;
    const range = document.createRange();
    range.selectNodeContents(a);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    fireEvent.click(screen.getByRole('button', { name: 'Link' })); // opens popover, captures caret, pre-fills
    // Simulate the URL input moving the live selection out of the editable.
    const away = document.createRange();
    away.selectNodeContents(document.body);
    away.collapse(true);
    sel.removeAllRanges();
    sel.addRange(away);
    fireEvent.change(screen.getByPlaceholderText(/https:/), { target: { value: 'https://new.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    const lastHtml = (onChange.mock.calls.at(-1)?.[0] as string) ?? '';
    expect(lastHtml).toContain('href="https://new.test"');
    expect((lastHtml.match(/<a[\s>]/g) || []).length).toBe(1); // edited in place, no stray anchor
    expect(editable.querySelectorAll('a')).toHaveLength(1);
  });

  it('has exactly ONE source toggle (the always-visible ml-auto button, not a duplicate toolbar command)', () => {
    render(<RichTextField value="" onChange={() => {}} ariaLabel="body" />);
    expect(screen.getAllByRole('button', { name: 'Edit HTML source' })).toHaveLength(1);
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
