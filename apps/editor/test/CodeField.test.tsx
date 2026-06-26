import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Swap CodeMirror for a plain textarea so the edit→save flow runs in jsdom; the real editor
// is covered by the Playwright browser E2E.
vi.mock('../src/lib/code-editor', () => ({
  CodeEditor: ({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel?: string }) => (
    <textarea aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { CodeField } from '../src/views/ui/CodeField';

describe('CodeField', () => {
  it('shows the title, an empty indicator (with the placeholder), and an Edit button when blank', () => {
    render(<CodeField label="mainNav" value="" onChange={() => {}} placeholder="<nav>…</nav>" />);
    expect(screen.getByText('mainNav')).toBeInTheDocument();
    expect(screen.getByText(/Empty · e\.g\. <nav>…<\/nav>/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Edit/ })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull(); // editor only opens on Edit
  });

  it('shows the line count and NO inline code preview (the modal is the only surface)', () => {
    render(<CodeField label="mainNav" value={'a\nb\nc\nd'} onChange={() => {}} />);
    expect(screen.getByText('4 lines')).toBeInTheDocument();
    expect(screen.queryByText(/a\s+b\s+c/)).toBeNull();
  });

  it('opens the editor modal on Edit, then saves the edited value and closes', async () => {
    const onChange = vi.fn();
    render(<CodeField label="mainNav" title="mainNav partial" value="<nav/>" onChange={onChange} />);

    // No modal until Edit is clicked.
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));

    const dialog = screen.getByRole('dialog', { name: 'mainNav partial' });
    expect(dialog).toBeInTheDocument();

    const textarea = screen.getByRole('textbox', { name: 'mainNav partial' }) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '<nav>new</nav>' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(onChange).toHaveBeenCalledWith('<nav>new</nav>');
    // Modal closes once the (now async-aware) save resolves — a microtask later.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('renders the hint inside the editor modal', () => {
    render(<CodeField label="mainNav" value="" onChange={() => {}} hint="Bindings: {{ company.* }}" />);
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
    expect(screen.getByText('Bindings: {{ company.* }}')).toBeInTheDocument();
  });
});
