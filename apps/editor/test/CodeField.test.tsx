import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Swap CodeMirror for a plain textarea so the edit→save flow runs in jsdom; the real editor
// is covered by the Playwright browser E2E.
vi.mock('../src/lib/code-editor', () => ({
  CodeEditor: ({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel?: string }) => (
    <textarea aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { CodeField } from '../src/views/ui/CodeField';

describe('CodeField', () => {
  it('shows the placeholder + "empty" when the value is blank', () => {
    render(<CodeField label="topNav" value="" onChange={() => {}} placeholder="<nav>…</nav>" />);
    expect(screen.getByText('<nav>…</nav>')).toBeInTheDocument();
    expect(screen.getByText('empty')).toBeInTheDocument();
  });

  it('previews the first lines and counts them', () => {
    render(<CodeField label="topNav" value={'a\nb\nc\nd'} onChange={() => {}} />);
    expect(screen.getByText('4 lines')).toBeInTheDocument();
    // The preview clamps to the first 3 lines.
    expect(screen.getByText(/a\s+b\s+c/)).toBeInTheDocument();
  });

  it('opens the editor modal on Edit, then saves the edited value and closes', () => {
    const onChange = vi.fn();
    render(<CodeField label="topNav" title="topNav partial" value="<nav/>" onChange={onChange} />);

    // No modal until Edit is clicked.
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));

    const dialog = screen.getByRole('dialog', { name: 'topNav partial' });
    expect(dialog).toBeInTheDocument();

    const textarea = screen.getByRole('textbox', { name: 'topNav partial' }) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '<nav>new</nav>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(onChange).toHaveBeenCalledWith('<nav>new</nav>');
    // Modal closes after save.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the hint inside the editor modal', () => {
    render(<CodeField label="topNav" value="" onChange={() => {}} hint="Bindings: {{ company.* }}" />);
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
    expect(screen.getByText('Bindings: {{ company.* }}')).toBeInTheDocument();
  });
});
