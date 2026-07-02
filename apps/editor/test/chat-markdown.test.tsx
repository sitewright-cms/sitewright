import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatMarkdown } from '../src/lib/chat-markdown';

describe('ChatMarkdown', () => {
  it('renders bold, inline code, and a bullet list', () => {
    const { container } = render(<ChatMarkdown text={'Added a **footer** with `data-sw-text`.\n\n- Windhoek\n- Swakopmund'} />);
    expect(container.querySelector('strong')?.textContent).toBe('footer');
    expect(container.querySelector('code')?.textContent).toBe('data-sw-text');
    const items = container.querySelectorAll('ul li');
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toBe('Windhoek');
  });

  it('renders a numbered list and a safe link, but drops a javascript: link', () => {
    const { container } = render(<ChatMarkdown text={'1. one\n2. two\n\nSee [docs](https://x.test) and [bad](javascript:alert(1)).'} />);
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://x.test');
    expect(link?.textContent).toBe('docs');
    // The unsafe link is NOT rendered as an anchor — it falls through as text.
    expect(screen.getByText(/\[bad\]\(javascript:alert\(1\)\)/)).toBeInTheDocument();
    expect(container.querySelectorAll('a')).toHaveLength(1);
  });

  it('renders a fenced code block and never emits raw HTML', () => {
    const { container } = render(<ChatMarkdown text={'```\n<script>x</script>\n```'} />);
    expect(container.querySelector('pre code')?.textContent).toBe('<script>x</script>');
    expect(container.querySelector('script')).toBeNull(); // the tags are TEXT, not executed markup
  });

  it('leaves an unclosed marker as plain text', () => {
    render(<ChatMarkdown text={'a **partial while streaming'} />);
    expect(screen.getByText(/a \*\*partial while streaming/)).toBeInTheDocument();
  });
});
