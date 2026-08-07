import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PreviewProgressPill, previewProgressLabel } from '../src/views/editor/PreviewProgressPill';

describe('previewProgressLabel', () => {
  it('names each build step in plain language', () => {
    expect(previewProgressLabel('preparing')).toBe('Preparing the preview…');
    expect(previewProgressLabel('media')).toBe('Processing images…');
    expect(previewProgressLabel('styles')).toBe('Compiling styles…');
    expect(previewProgressLabel('scripts')).toBe('Bundling scripts…');
    expect(previewProgressLabel('finalizing')).toBe('Finishing up…');
  });

  it('counts pages, naming the one being rendered rather than the one just finished', () => {
    expect(previewProgressLabel('pages', 0, 93)).toBe('Rendering pages… 1 of 93');
    expect(previewProgressLabel('pages', 11, 93)).toBe('Rendering pages… 12 of 93');
  });

  it('never overshoots the total on the last page', () => {
    expect(previewProgressLabel('pages', 93, 93)).toBe('Rendering pages… 93 of 93');
  });

  it('drops the counter when there is no total to count against', () => {
    expect(previewProgressLabel('pages')).toBe('Rendering pages…');
    expect(previewProgressLabel('pages', 3, 0)).toBe('Rendering pages…');
  });

  it('falls back to a generic label for an unknown or absent phase', () => {
    // The isolated build worker serializes its job, so it reports no phase at all — the pill still
    // has to say something truthful rather than render an empty line.
    expect(previewProgressLabel(undefined)).toBe('Building the preview…');
    expect(previewProgressLabel('something-new')).toBe('Building the preview…');
  });
});

describe('PreviewProgressPill', () => {
  it('announces the current step politely, with a spinner', () => {
    const { container } = render(<PreviewProgressPill phase="media" />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Processing images…');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });

  it('sits at the top centre and never eats a click meant for the preview', () => {
    const { container } = render(<PreviewProgressPill phase="pages" done={2} total={9} />);
    const wrap = container.firstElementChild as HTMLElement;
    expect(wrap.className).toContain('justify-center');
    expect(wrap.className).toContain('top-5');
    expect(wrap.className).toContain('pointer-events-none');
    expect(screen.getByRole('status')).toHaveTextContent('Rendering pages… 3 of 9');
  });
});
