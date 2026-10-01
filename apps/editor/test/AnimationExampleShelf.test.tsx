import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AnimationExampleShelf } from '../src/views/library/AnimationExampleShelf';
import { SVG_ANIM_EXAMPLES } from '../src/views/library/svg-anim-examples';

describe('AnimationExampleShelf', () => {
  it('offers VIEW (not copy) and hands the whole SVG to the studio', async () => {
    // ★ The affordance IS the point of this shelf. The snippets it replaces could only be copied as
    // text; an example is opened, because what it demonstrates — a dozen elements on one staggered
    // timeline — is only legible once the Studio has it.
    const onView = vi.fn();
    render(<AnimationExampleShelf onView={onView} />);

    expect(screen.getByRole('button', { name: /Animation Examples/ })).toBeInTheDocument();
    const first = SVG_ANIM_EXAMPLES[0]!;
    const view = await screen.findByRole('button', { name: `View ${first.name} in the studio` }, { timeout: 5000 });

    // Every example gets its own View button, and none of them offers a Copy.
    for (const ex of SVG_ANIM_EXAMPLES) {
      expect(screen.getByRole('button', { name: `View ${ex.name} in the studio` })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();

    fireEvent.click(view);
    expect(onView).toHaveBeenCalledTimes(1);
    const handed = onView.mock.calls[0]![0] as string;
    expect(handed).toBe(first.svg);
    // Not a fragment or a name — the complete, importable document.
    expect(handed).toMatch(/^<svg\b/);
    expect(handed).toContain('data-sw-svg-scene');
  });

  it('collapses, and loads the artwork only once opened', async () => {
    render(<AnimationExampleShelf onView={vi.fn()} />);
    const header = screen.getByRole('button', { name: /Animation Examples/ });
    await waitFor(() => expect(screen.getAllByRole('button', { name: /in the studio$/ }).length).toBeGreaterThan(0));
    expect(header).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryAllByRole('button', { name: /in the studio$/ })).toHaveLength(0);
  });
});
