import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { Skeleton, SkeletonList, SkeletonImage } from '../src/views/ui/Skeleton';

describe('Skeleton', () => {
  it('renders a single DaisyUI skeleton block with passed sizing', () => {
    const { container } = render(<Skeleton className="h-10 w-20" />);
    const box = container.querySelector('.skeleton');
    expect(box).toBeTruthy();
    expect(box?.className).toContain('h-10');
    expect(box?.className).toContain('w-20');
  });

  it('SkeletonList stacks N bars and keeps an accessible status label', () => {
    const { container, getByText } = render(<SkeletonList rows={4} label="Loading forms…" />);
    expect(container.querySelectorAll('.skeleton')).toHaveLength(4);
    const status = container.querySelector('[role="status"]');
    expect(status).toBeTruthy();
    // The label is present for AT but visually hidden.
    expect(getByText('Loading forms…').className).toContain('sr-only');
  });

  it('SkeletonImage covers the frame with a skeleton until the image loads', () => {
    const { container } = render(<SkeletonImage src="/m/x.jpg" alt="A photo" className="h-24 w-full" />);
    // Skeleton visible up front; the image is present but faded out.
    expect(container.querySelector('.skeleton')).toBeTruthy();
    const img = container.querySelector('img')!;
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.className).toContain('opacity-0');

    // On load the skeleton clears and the image fades in.
    fireEvent.load(img);
    expect(container.querySelector('.skeleton')).toBeNull();
    expect(img.className).toContain('opacity-100');
  });

  it('SkeletonImage also clears on error (broken image never traps a skeleton)', () => {
    const { container } = render(<SkeletonImage src="/m/broken.jpg" alt="" className="h-6 w-6" />);
    expect(container.querySelector('.skeleton')).toBeTruthy();
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('.skeleton')).toBeNull();
  });
});
