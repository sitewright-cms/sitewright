import { PREVIEW_SANDBOX_ATTR } from '@sitewright/schema';
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
    // opaque origin — `allow-same-origin` must never be present. The popup tokens are
    // what let an outbound target=_blank link open at all, and open UN-sandboxed at the
    // target's own origin; the list must match the response CSP or the stricter one wins.
    expect(iframe?.getAttribute('sandbox')).toBe(PREVIEW_SANDBOX_ATTR);
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

  it('frameless has NO gutter — the document meets the pane edge', () => {
    // ★ The page editor's preview IS the working surface, so a gutter reads as a grey ring drawn
    // around the site. It also sits in the one place where cosmetics have bitten before: a padding
    // change here once moved the hit targets so clicks landed on <body> instead of the document.
    // Padding can only ever SHRINK the iframe, so removing it is the safe direction — but assert the
    // shape so nobody restores it by reflex.
    const { container } = render(<PreviewPane src="/p/" loading={false} error={null} frameless />);
    const pane = container.firstElementChild as HTMLElement;
    expect(pane.className).not.toMatch(/(^|\s)p-\d/);
    // The iframe fills it completely.
    const frame = container.querySelector('iframe')!;
    expect(frame.className).toContain('h-full');
    expect(frame.className).toContain('w-full');
    expect(frame.className).not.toContain('border');
  });

  it('the FRAMED variant keeps its card gutter', () => {
    // The slot editor and the live-preview panel sit ON a page beside other cards — there the frame
    // is the point, and dropping it would make the preview bleed into the surrounding surface.
    const { container } = render(<PreviewPane src="/p/" loading={false} error={null} />);
    expect((container.firstElementChild as HTMLElement).className).toMatch(/(^|\s)p-1(\s|$)/);
  });
});
