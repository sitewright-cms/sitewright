// Editor-side WebGL helper for the Background preset PICKER. Reuses the EXACT GLSL shipped to sites
// (SHADER_BG_PRESETS + prelude/main from @sitewright/blocks) so the picker preview can never drift
// from the published runtime.
//
// One shared offscreen WebGL context renders any preset, then callers blit it onto plain 2D canvases
// (thumbnails + the large preview). This mirrors the prototype: a single GL context for the whole
// grid, so we never approach the browser's ~16 live-context cap.

import { SHADER_VERT, SHADER_PRELUDE, SHADER_MAIN, shaderPresetByKey } from '@sitewright/blocks';

export type RGB = [number, number, number];

/** The three palette slots a preset reads (uC1/uC2/uC3). */
export interface ShaderPalette {
  c1: RGB;
  c2: RGB;
  c3: RGB;
}

/** Per-frame draw inputs (mirrors the published runtime's uniforms). */
export interface ShaderDrawOpts extends ShaderPalette {
  time: number;
  mouse: [number, number];
  intensity: number;
  /** radians */
  angle: number;
  /** 1 = pointer-reactive, 0 = inert */
  interact: number;
}

interface Program {
  p: WebGLProgram;
  quad: WebGLBuffer;
  aPos: number;
  u: Record<'time' | 'res' | 'mouse' | 'c1' | 'c2' | 'c3' | 'intensity' | 'interact' | 'angle', WebGLUniformLocation | null>;
}

class OffscreenShaderRenderer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  private cache = new Map<string, Program | null>();

  constructor() {
    this.canvas = document.createElement('canvas');
    const opts: WebGLContextAttributes = { antialias: false, depth: false, preserveDrawingBuffer: true, premultipliedAlpha: false };
    const gl = (this.canvas.getContext('webgl', opts) || this.canvas.getContext('experimental-webgl', opts)) as WebGLRenderingContext | null;
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
  }

  private program(key: string): Program | null {
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const gl = this.gl;
    const preset = shaderPresetByKey(key);
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, SHADER_VERT);
    gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, SHADER_PRELUDE + preset.glsl + SHADER_MAIN);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      this.cache.set(key, null);
      return null;
    }
    const p = gl.createProgram()!;
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteProgram(p);
      this.cache.set(key, null);
      return null;
    }
    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const prog: Program = {
      p,
      quad,
      aPos: gl.getAttribLocation(p, 'aPos'),
      u: {
        time: gl.getUniformLocation(p, 'uTime'),
        res: gl.getUniformLocation(p, 'uRes'),
        mouse: gl.getUniformLocation(p, 'uMouse'),
        c1: gl.getUniformLocation(p, 'uC1'),
        c2: gl.getUniformLocation(p, 'uC2'),
        c3: gl.getUniformLocation(p, 'uC3'),
        intensity: gl.getUniformLocation(p, 'uIntensity'),
        interact: gl.getUniformLocation(p, 'uInteract'),
        angle: gl.getUniformLocation(p, 'uAngle'),
      },
    };
    this.cache.set(key, prog);
    return prog;
  }

  /** Render a preset at w×h into the shared offscreen canvas. Returns false if the shader won't compile. */
  draw(key: string, w: number, h: number, o: ShaderDrawOpts): boolean {
    const gl = this.gl;
    const prog = this.program(key);
    if (!prog) return false;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.useProgram(prog.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, prog.quad);
    gl.enableVertexAttribArray(prog.aPos);
    gl.vertexAttribPointer(prog.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1f(prog.u.time, o.time);
    gl.uniform2f(prog.u.res, w, h);
    const ca = Math.cos(o.angle);
    const sa = Math.sin(o.angle);
    gl.uniform2f(prog.u.mouse, o.mouse[0] * ca + o.mouse[1] * sa, -o.mouse[0] * sa + o.mouse[1] * ca);
    gl.uniform3fv(prog.u.c1, o.c1);
    gl.uniform3fv(prog.u.c2, o.c2);
    gl.uniform3fv(prog.u.c3, o.c3);
    gl.uniform1f(prog.u.intensity, o.intensity);
    gl.uniform1f(prog.u.interact, o.interact);
    gl.uniform1f(prog.u.angle, o.angle);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  }
}

let shared: OffscreenShaderRenderer | null | undefined;

/** The shared offscreen renderer (lazily created); null when WebGL is unavailable. */
export function shaderRenderer(): OffscreenShaderRenderer | null {
  if (shared === undefined) {
    try {
      shared = new OffscreenShaderRenderer();
    } catch {
      shared = null;
    }
  }
  return shared;
}

// --- color helpers ----------------------------------------------------------
let probe: HTMLSpanElement | null = null;
function cssToRGB(value: string): RGB {
  if (!probe) {
    probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:0;height:0;pointer-events:none';
    document.body.appendChild(probe);
  }
  probe.style.color = '';
  probe.style.color = value;
  const m = getComputedStyle(probe).color.replace(/[^0-9.,]/g, '').split(',');
  return [Number(m[0] ?? 0) / 255, Number(m[1] ?? 0) / 255, Number(m[2] ?? 0) / 255];
}

const FALLBACK_PALETTE: Record<keyof ShaderPalette, string> = { c1: '#4f46e5', c2: '#0ea5e9', c3: '#1f2937' };

/** The project CI palette as the runtime would read it (primary/secondary/neutral), with defaults. */
export function ciPalette(): ShaderPalette {
  return {
    c1: cssToRGB(`var(--sw-color-primary, ${FALLBACK_PALETTE.c1})`),
    c2: cssToRGB(`var(--sw-color-secondary, ${FALLBACK_PALETTE.c2})`),
    c3: cssToRGB(`var(--sw-color-neutral, ${FALLBACK_PALETTE.c3})`),
  };
}

/** Convert three literal CSS colors (e.g. user-picked hex) to a palette. */
export function paletteFromColors(c1: string, c2: string, c3: string): ShaderPalette {
  return { c1: cssToRGB(c1), c2: cssToRGB(c2), c3: cssToRGB(c3) };
}
