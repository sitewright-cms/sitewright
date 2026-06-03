import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
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

  it('shows the loading hint and the error banner', () => {
    const { getByText, rerender } = render(<PreviewPane src="" loading={true} error={null} />);
    expect(getByText('updating…')).toBeTruthy();
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
