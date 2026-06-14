import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlaceholderLabel } from '../src/views/PlaceholderLabel';

describe('PlaceholderLabel', () => {
  it('shows a rich placeholder name as readable text, never the raw HTML/mustache markup', async () => {
    render(<PlaceholderLabel name={'<span class="x">{{sw-icon "sparkles"}} Free site audit</span>'} />);
    // Both the synchronous text fallback and the engine-rendered HTML expose "Free site audit".
    expect(await screen.findByText(/Free site audit/)).toBeInTheDocument();
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
