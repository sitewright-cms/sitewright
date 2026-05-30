import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PreviewPane } from '../src/views/editor/PreviewPane';

describe('PreviewPane', () => {
  it('fully sandboxes the preview iframe (no scripts, no same-origin)', () => {
    const { container } = render(<PreviewPane html="<h1>Hi</h1>" loading={false} error={null} />);
    const iframe = container.querySelector('iframe');
    expect(iframe).toBeTruthy();
    // Security regression guard: the preview must stay script-isolated. Granting
    // allow-scripts here is ineffective (inherited CSP blocks inline JS) AND would
    // need an explicit, reviewed redesign — so the empty sandbox is intentional.
    expect(iframe?.getAttribute('sandbox')).toBe('');
    expect(iframe?.getAttribute('sandbox')).not.toContain('allow-same-origin');
  });

  it('passes the html via srcDoc (never dangerouslySetInnerHTML)', () => {
    const { container } = render(
      <PreviewPane html="<h1>Hello world</h1>" loading={false} error={null} />,
    );
    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe.getAttribute('srcdoc')).toContain('Hello world');
  });

  it('shows the loading hint and the error banner', () => {
    const { getByText, rerender } = render(<PreviewPane html="" loading={true} error={null} />);
    expect(getByText('updating…')).toBeTruthy();
    rerender(<PreviewPane html="" loading={false} error="boom" />);
    expect(getByText(/Preview error: boom/)).toBeTruthy();
  });
});
