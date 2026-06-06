import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { PreviewPane } from '../src/views/editor/PreviewPane';

describe('PreviewPane', () => {
  it('loads the preview via src in an allow-scripts sandbox (never same-origin)', () => {
    const { container } = render(
      <PreviewPane src="/projects/p/preview/tok" loading={false} error={null} />,
    );
    const iframe = container.querySelector('iframe');
    expect(iframe).toBeTruthy();
    // Scripts run (the doc is served under CSP: sandbox), but the frame is an
    // opaque origin — `allow-same-origin` must never be present.
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts');
    expect(iframe?.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(iframe?.getAttribute('src')).toBe('/projects/p/preview/tok');
  });

  it('falls back to about:blank when no src yet (never loads the parent URL)', () => {
    const { container } = render(<PreviewPane src="" loading={true} error={null} />);
    const iframe = container.querySelector('iframe');
    expect(iframe?.getAttribute('src')).toBe('about:blank');
  });

  it('skeletons until first load, then shows the updating hint; surfaces errors', () => {
    const { container, getByText, queryByText, rerender } = render(
      <PreviewPane src="/x" loading={true} error={null} />,
    );
    // Before the first load an animated skeleton covers the frame — NOT the "updating…"
    // pill (that would strobe on live-preview's per-edit refresh).
    expect(container.querySelector('.skeleton')).toBeTruthy();
    expect(queryByText('updating…')).toBeNull();

    // The iframe reports its (real) src finished loading → skeleton clears for good.
    fireEvent.load(container.querySelector('iframe')!);
    expect(container.querySelector('.skeleton')).toBeNull();

    // A later refresh now shows the lightweight pill, leaving the last frame in place.
    rerender(<PreviewPane src="/x" loading={true} error={null} />);
    expect(getByText('updating…')).toBeTruthy();
    expect(container.querySelector('.skeleton')).toBeNull();

    // Errors surface in the banner (and never under a skeleton).
    rerender(<PreviewPane src="/x" loading={false} error="boom" />);
    expect(getByText(/Preview error: boom/)).toBeTruthy();
  });

  it('titles the iframe — defaults to "Live preview", overridable per context', () => {
    const { container, rerender } = render(<PreviewPane src="/x" loading={false} error={null} />);
    let iframe = container.querySelector('iframe');
    expect(iframe?.getAttribute('title')).toBe('Live preview');
    expect(iframe?.getAttribute('aria-label')).toBe('Live preview');
    rerender(<PreviewPane src="/x" loading={false} error={null} title="Preview" />);
    iframe = container.querySelector('iframe');
    expect(iframe?.getAttribute('title')).toBe('Preview');
    expect(iframe?.getAttribute('aria-label')).toBe('Preview');
  });
});
