// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ProjectIcon } from '../src/views/ui/ProjectIcon';

const BOX = 'flex h-6 w-6 items-center justify-center overflow-hidden rounded';

describe('ProjectIcon (shared favicon badge)', () => {
  it('renders the favicon <img> (no-referrer, presentational) when a src is given', () => {
    const { container } = render(<ProjectIcon src="/media/s/fav.png" boxClassName={BOX} />);
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', '/media/s/fav.png');
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(img).toHaveAttribute('alt', ''); // presentational
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders the generic globe fallback (no img) when no src is given', () => {
    const { container } = render(<ProjectIcon boxClassName={BOX} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('falls back to the globe when the favicon fails to load', () => {
    const { container } = render(<ProjectIcon src="/broken.png" boxClassName={BOX} />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('applies the caller-supplied box + fallback-glyph classes', () => {
    const { container } = render(<ProjectIcon boxClassName={BOX} iconClassName="h-9 w-9 text-white" />);
    expect(container.querySelector('span')?.className).toContain('rounded');
    expect(container.querySelector('svg')?.getAttribute('class')).toContain('h-9 w-9');
  });
});
