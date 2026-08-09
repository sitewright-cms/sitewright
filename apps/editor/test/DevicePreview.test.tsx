import { describe, it, expect, vi } from 'vitest';
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
    // UNMEASURED fluid (jsdom has no layout, so clientWidth is 0) falls back to filling the box.
    const fluid = getByTestId('device-viewport');
    expect(fluid.getAttribute('style')).toBeFalsy();
    expect(fluid.className).toContain('w-full');
  });

  it('★ resolves fluid to a MEASURED pixel width, so every device renders the same shape', () => {
    // THE DEFECT: fluid rendered as `w-full` with no positioning while every other device was an
    // absolutely-positioned, `translateX(-50%)`-centred box. Neither `position` nor `transform` is
    // interpolable, so the transition had nothing to work with across that boundary: measured in a
    // real browser on the pre-fix component, desktop→mobile did not tween AT ALL, and mobile→desktop
    // tweened its width while the box slid 795px to the left — the centring transform vanishing in a
    // single frame. One shape for every device is what makes both directions a plain px→px tween.
    //
    // jsdom cannot see the motion (no layout, and act() flushes effects synchronously), but it CAN
    // hold the structural property the motion depends on. The glide itself is asserted in the E2E,
    // which samples width AND centre mid-flight.
    const spy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1600);
    try {
      const { getByTestId, rerender } = render(
        <DevicePreview width={null}>
          <span />
        </DevicePreview>,
      );
      const fluid = getByTestId('device-viewport');
      expect(fluid).toHaveStyle({ width: '1600px' }); // the host's measured width, not `w-full`
      expect(fluid.className).toContain('absolute');
      expect(fluid.style.transform).toContain('translateX(-50%)');

      rerender(
        <DevicePreview width={390}>
          <span />
        </DevicePreview>,
      );
      const fixed = getByTestId('device-viewport');
      // Same positioning and the same centring transform — ONLY the width and scale differ, which is
      // precisely the pair a `transition-all` can interpolate.
      expect(fixed).toHaveStyle({ width: '390px' });
      expect(fixed.className).toContain('absolute');
      expect(fixed.style.transform).toContain('translateX(-50%)');
    } finally {
      spy.mockRestore();
    }
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
