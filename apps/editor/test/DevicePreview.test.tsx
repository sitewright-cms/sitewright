import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DevicePreview, PREVIEW_DEVICES } from '../src/views/editor/DevicePreview';

describe('DevicePreview', () => {
  it('keeps the SAME child element across a fluid ↔ fixed-width switch', () => {
    // THE DEFECT (the responsive-switch 404): the two branches rendered different tree SHAPES —
    // fluid put children at depth 1, fixed-width at depth 2. React reconciles by position, so the
    // preview <iframe> was unmounted and REMOUNTED on every switch, refetching
    // `/preview/<slug>/<token>`. Once that token had expired the refetch hit the route's opaque
    // "Preview expired" 404 and the pane stuck there until a manual reload.
    //
    // Identity of the DOM node across a rerender is exactly the property that was broken, so that is
    // what this asserts — not the styles around it.
    const { rerender, getByTestId } = render(
      <DevicePreview width={null}>
        <iframe data-testid="frame" title="Preview" />
      </DevicePreview>,
    );
    const before = getByTestId('frame');

    for (const device of PREVIEW_DEVICES) {
      rerender(
        <DevicePreview width={device.width}>
          <iframe data-testid="frame" title="Preview" />
        </DevicePreview>,
      );
      expect(getByTestId('frame'), `remounted switching to ${device.key}`).toBe(before);
    }

    rerender(
      <DevicePreview width={null}>
        <iframe data-testid="frame" title="Preview" />
      </DevicePreview>,
    );
    expect(getByTestId('frame')).toBe(before);
  });

  it('simulates a fixed device at its exact CSS width, and fluid at full width', () => {
    const { getByTestId, rerender } = render(
      <DevicePreview width={390}>
        <span />
      </DevicePreview>,
    );
    expect(getByTestId('device-viewport')).toHaveStyle({ width: '390px' });

    rerender(
      <DevicePreview width={null}>
        <span />
      </DevicePreview>,
    );
    // Fluid carries no simulation styles at all — no width, no transform.
    const fluid = getByTestId('device-viewport');
    expect(fluid.getAttribute('style')).toBeFalsy();
    expect(fluid.className).toContain('w-full');
  });

  it('glides between simulated widths on a device change, and waives it for reduced motion', () => {
    const { getByTestId, rerender } = render(
      <DevicePreview width={1024}>
        <span />
      </DevicePreview>,
    );
    rerender(
      <DevicePreview width={390}>
        <span />
      </DevicePreview>,
    );
    const vp = getByTestId('device-viewport');
    expect(vp).toHaveStyle({ width: '390px' });
    expect(vp.className).toContain('transition-all');
    // The tween is a CLASS, not an inline style, so `prefers-reduced-motion` can actually waive it —
    // an inline `transition` would outrank any utility and animate regardless.
    expect(vp.className).toContain('motion-reduce:transition-none');
    expect(vp.getAttribute('style')).not.toContain('transition');
  });

  it('animates the way BACK to fluid too — every device change glides, in both directions', () => {
    const { getByTestId, rerender } = render(
      <DevicePreview width={768}>
        <span />
      </DevicePreview>,
    );
    rerender(
      <DevicePreview width={null}>
        <span />
      </DevicePreview>,
    );
    // Leaving the fluid branch unarmed made "back to Large desktop" the one switch that still
    // snapped. Measured in a real browser: 1024px → 1400px passes through 1207px at 120ms, so the
    // width tweens even though the box also drops from absolute to static positioning.
    expect(getByTestId('device-viewport').className).toContain('transition-all');
    expect(getByTestId('device-viewport').className).toContain('motion-reduce:transition-none');
  });
});
