import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PlaceholderLabel } from '../src/views/PlaceholderLabel';

describe('PlaceholderLabel', () => {
  it('renders the real icon + readable text, never the raw HTML/mustache markup', async () => {
    const { container } = render(<PlaceholderLabel name={'<span class="x">{{sw-icon "sparkles"}} Free site audit</span>'} />);
    // Once the icon maps load, the {{sw-icon}} token renders to an actual inline <svg> (not escaped markup).
    // (Generous timeout: the first lazy-import of the large icon chunk can be slow in the test env.)
    await waitFor(() => expect(container.querySelector('.sw-ph-label svg')).not.toBeNull(), { timeout: 8000 });
    // The clean text is shown alongside the icon.
    expect(screen.getByText(/Free site audit/)).toBeInTheDocument();
    // The raw template markup is NOT dumped verbatim.
    expect(screen.queryByText(/sw-icon/)).toBeNull();
    expect(screen.queryByText(/<span/)).toBeNull();
  });

  it('strips triple-stache + tags cleanly in the text fallback (no stray brace)', () => {
    render(<PlaceholderLabel name={'{{{raw}}} <b>Bold</b>'} />);
    // The fallback shows the stripped text; assert no leftover "}" leaked from the {{{ }}}.
    expect(screen.queryByText(/[{}]/)).toBeNull();
  });
});
