import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { RichTextField } from '../src/views/datasets/RichTextField';

describe('RichTextField', () => {
  it('fills the editable with the stored value on mount', () => {
    render(<RichTextField value="<p>Hello world</p>" onChange={() => {}} ariaLabel="body" />);
    expect(screen.getByRole('textbox', { name: 'body' }).innerHTML).toContain('Hello world');
  });

  it('renders the formatting toolbar (mirrors the on-page editor commands)', () => {
    render(<RichTextField value="" onChange={() => {}} ariaLabel="body" />);
    for (const name of [
      'Bold', 'Italic', 'Paragraph', 'Quote', 'Bulleted list', 'Numbered list',
      'Text color', 'Highlight', 'Text size', 'Alignment', 'Increase indent', 'Link', 'Insert table',
      'Edit HTML source',
    ]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    // No heading buttons: rich content is a fragment inside a page that already owns its heading
    // outline, so the toolbar offers size + font + bold for the LOOK and never a heading TAG.
    for (const name of ['Heading 1', 'Heading 2', 'Heading 3', 'Heading 4', 'Heading 5', 'Heading 6']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
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

  it('double-clicking an image opens the edit dialog pre-filled', () => {
    render(<RichTextField value='<p><img src="/pic.jpg" alt="Pic" width="200"></p>' onChange={() => {}} ariaLabel="body" projectId="p" />);
    const img = screen.getByRole('textbox', { name: 'body' }).querySelector('img')!;
    fireEvent.doubleClick(img);
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
    expect((screen.getByLabelText(/Image URL/) as HTMLInputElement).value).toBe('/pic.jpg');
  });

  it('highlights a mark in the toolbar when the selection already has it (active state)', () => {
    // jsdom has no queryCommand* — stub them so the selection reads as bold.
    const doc = document as unknown as { queryCommandState?: unknown; queryCommandValue?: unknown };
    const os = doc.queryCommandState;
    const ov = doc.queryCommandValue;
    doc.queryCommandState = (c: string) => c === 'bold';
    doc.queryCommandValue = () => '';
    try {
      render(<RichTextField value="<p><b>x</b></p>" onChange={() => {}} ariaLabel="body" />);
      const editable = screen.getByRole('textbox', { name: 'body' });
      const range = document.createRange();
      range.selectNodeContents(editable);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      act(() => {
        document.dispatchEvent(new Event('selectionchange'));
      });
      expect(screen.getByRole('button', { name: 'Bold' }).className).toMatch(/indigo-100|indigo-500\/15/);
      expect(screen.getByRole('button', { name: 'Italic' }).className).not.toMatch(/indigo-100/);
      // Move the selection OUT of the field → the active highlight clears (no stale Bold).
      const away = document.createRange();
      away.selectNodeContents(document.body);
      away.collapse(true);
      sel.removeAllRanges();
      sel.addRange(away);
      act(() => {
        document.dispatchEvent(new Event('selectionchange'));
      });
      expect(screen.getByRole('button', { name: 'Bold' }).className).not.toMatch(/indigo-100|indigo-500\/15/);
    } finally {
      doc.queryCommandState = os;
      doc.queryCommandValue = ov;
    }
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

  // A dataset value can be written by a LOWER-privileged actor (invited client / API key / agent loop)
  // and is loaded here on the app origin, under the viewing admin's session. So the same allowlist that
  // guards the published site runs before innerHTML.
  describe('sanitizes the stored value before it reaches innerHTML', () => {
    const html = (value: string): string => {
      render(<RichTextField value={value} onChange={() => {}} ariaLabel="body" />);
      return screen.getByRole('textbox', { name: 'body' }).innerHTML;
    };

    it('strips inline event handlers', () => {
      const out = html('<p>hi</p><img src="x" onerror="alert(1)">');
      expect(out).not.toMatch(/onerror/i);
      expect(out).toContain('hi');
    });

    it('strips script elements', () => {
      expect(html('<p>ok</p><script>alert(1)</script>')).not.toMatch(/<script/i);
    });

    it('strips javascript: hrefs', () => {
      expect(html('<a href="javascript:alert(1)">x</a>')).not.toMatch(/javascript:/i);
    });

    it('strips authored data-sw-* markers (they must never reach the platform runtime)', () => {
      expect(html('<div data-sw-component="cart">x</div>')).not.toMatch(/data-sw-component/i);
    });

    it('is a NO-OP for the markup this toolbar actually emits (no silent content loss)', () => {
      const authored =
        '<h2 class="text-2xl">Title</h2><p class="text-center">a <strong>b</strong> <em>c</em> ' +
        '<a href="/page" target="_blank" rel="noopener noreferrer">link</a></p>' +
        '<ul><li>one</li><li>two</li></ul>' +
        '<img src="/media/site/abc-photo.png" alt="p" width="120" height="80">' +
        '<table><tbody><tr><td colspan="2">cell</td></tr></tbody></table>';
      const out = html(authored);
      for (const fragment of ['text-2xl', 'text-center', '<strong>b</strong>', '<em>c</em>', 'target="_blank"',
        'rel="noopener noreferrer"', '<li>one</li>', 'width="120"', 'height="80"', 'colspan="2"']) {
        expect(out, fragment).toContain(fragment);
      }
    });
  });
});
