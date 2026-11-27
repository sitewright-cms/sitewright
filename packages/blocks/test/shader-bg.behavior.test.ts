// @vitest-environment jsdom
/// <reference lib="dom" />
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SHADER_BG_JS } from '../src/shader-bg.js';

/**
 * The colours a shader actually paints with. The dark theme writes its lifted brand colours as `oklch()`, and
 * `getComputedStyle` hands those back as `oklch()` too, not as `rgb()`. Reading their digits as r,g,b painted every
 * shader black in dark mode. The runtime now lets a 1x1 canvas convert any computed colour that is not `rgb()`.
 *
 * jsdom has neither WebGL nor a 2D canvas, nor modern colour parsing, so both contexts are faked and the
 * computed colour of the runtime's probe is fed in from a palette, in the order the three slots are read. Every
 * runtime instance (an earlier test's too, whose theme observer stays live) reads its three slots in that order,
 * so cycling the palette gives each one the same colours.
 */

/** The sRGB bytes the fake 2D canvas "paints" for each colour string it is given. */
const CANVAS_BYTES: Record<string, [number, number, number]> = {
  'oklch(0.62 0.21 285)': [94, 141, 226],
  'color(srgb 0.2 0.4 0.6)': [51, 102, 153],
};

let palette: string[] = [];
let reads = 0;
let canvasFills: string[] = [];
let uniforms: Record<string, number[]> = {};

function fakeGl(): unknown {
  const target: Record<string, unknown> = {
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getUniformLocation: (_p: unknown, name: string) => ({ name }),
    uniform3fv: (loc: { name: string }, v: number[]) => {
      uniforms[loc.name] = [...v];
    },
  };
  // Every other WebGL call is a no-op returning a dummy handle.
  return new Proxy(target, { get: (t, k) => (k in t ? t[k as string] : () => ({})) });
}

function fake2d(): unknown {
  let style = '#000';
  return {
    set fillStyle(v: string) {
      style = v;
      canvasFills.push(v);
    },
    get fillStyle() {
      return style;
    },
    clearRect: () => {},
    fillRect: () => {},
    getImageData: () => ({ data: Uint8ClampedArray.from([...(CANVAS_BYTES[style] ?? [0, 0, 0]), 255]) }),
  };
}

beforeEach(() => {
  palette = [];
  reads = 0;
  canvasFills = [];
  uniforms = {};
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (kind: string) {
    return (kind === '2d' ? fake2d() : fakeGl()) as never;
  } as never);
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
    // Only the runtime's colour probe (an aria-hidden span) asks for `.color`; feed it the next colour.
    if (el instanceof HTMLSpanElement && el.getAttribute('aria-hidden') === 'true') {
      return { color: palette[reads++ % 3] ?? 'rgb(0, 0, 0)' } as CSSStyleDeclaration;
    }
    return real(el);
  });
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener: () => {} })) as never;
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-sw-theme');
});

function run(): void {
  document.body.innerHTML = '<div data-sw-component="shader-bg" data-preset="mesh-gradient" data-speed="0" data-colors="primary,secondary,accent"></div>';
  (0, eval)(SHADER_BG_JS);
}

const bytes = (v: number[] | undefined): number[] => (v ?? []).map((x) => Math.round(x * 255));

describe('shader-bg colours (jsdom)', () => {
  it('paints oklch() and color() theme colours in their own colour, not black', () => {
    palette = ['oklch(0.62 0.21 285)', 'rgb(79, 45, 216)', 'color(srgb 0.2 0.4 0.6)'];
    run();
    expect(bytes(uniforms.uC1)).toEqual([94, 141, 226]);
    expect(bytes(uniforms.uC2)).toEqual([79, 45, 216]);
    expect(bytes(uniforms.uC3)).toEqual([51, 102, 153]);
    // The canvas converts the COMPUTED colour (and only the non-rgb ones).
    expect(canvasFills).toContain('oklch(0.62 0.21 285)');
    expect(canvasFills).not.toContain('rgb(79, 45, 216)');
  });

  it('reads an rgb() colour directly, without the canvas, as it always did', () => {
    palette = ['rgb(79, 45, 216)', 'rgba(20, 184, 166, 0.5)', 'rgb(15, 23, 42)'];
    run();
    expect(bytes(uniforms.uC1)).toEqual([79, 45, 216]);
    expect(bytes(uniforms.uC2)).toEqual([20, 184, 166]);
    expect(bytes(uniforms.uC3)).toEqual([15, 23, 42]);
    expect(canvasFills).toEqual([]);
  });

  it('re-reads the colours when the theme flips, so a switch to dark keeps them', async () => {
    palette = ['rgb(79, 45, 216)', 'rgb(109, 91, 245)', 'rgb(20, 184, 166)'];
    run();
    expect(bytes(uniforms.uC1)).toEqual([79, 45, 216]);
    palette = ['oklch(0.62 0.21 285)', 'color(srgb 0.2 0.4 0.6)', 'oklch(0.62 0.21 285)'];
    reads = 0;
    document.documentElement.setAttribute('data-sw-theme', 'dark');
    await new Promise((r) => setTimeout(r, 0)); // let the MutationObserver deliver
    expect(bytes(uniforms.uC1)).toEqual([94, 141, 226]);
    expect(bytes(uniforms.uC2)).toEqual([51, 102, 153]);
  });
});
