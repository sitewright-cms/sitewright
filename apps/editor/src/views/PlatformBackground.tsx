import { useEffect, useRef, useState } from 'react';
import { api, type PlatformBackground as PlatformBg } from '../api';
import { shaderRenderer, paletteFromSlots, editorIsDark } from '../lib/shader-engine';

/** Fired after an admin sets/clears the platform background, so the live canvas refetches immediately. */
export const PLATFORM_BG_EVENT = 'sw:platform-bg-changed';

const DPR = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
// Same runtime defaults the published shader uses for un-authored knobs.
const SPEED = 1;
const INTENSITY = 0.5;

/**
 * The admin-set WebGL background behind the WHOLE editor SPA — mounted at the app root (in main.tsx), so
 * it also sits behind the login / register / force-password screens (which render before the app shell).
 * Fetches the (public, pre-auth) config from /auth/config; when set, paints a fixed full-viewport canvas
 * with the chosen shader preset and adds `sw-platform-bg` to <html> (which zeroes the static gradient so
 * the animation shows through). `auto` color slots track the user's light/dark choice live. Respects
 * `prefers-reduced-motion` (one static frame) and pauses on a hidden tab. No-op when WebGL is
 * unavailable or nothing is configured.
 */
export function PlatformBackground() {
  const [config, setConfig] = useState<PlatformBg | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Load the config (pre-auth) + refetch when an admin changes it in this tab.
  useEffect(() => {
    let alive = true;
    const load = () => {
      api.loginConfig()
        .then((c) => { if (alive) setConfig(c.platformBackground); })
        .catch(() => { if (alive) setConfig(null); });
    };
    load();
    window.addEventListener(PLATFORM_BG_EVENT, load);
    return () => { alive = false; window.removeEventListener(PLATFORM_BG_EVENT, load); };
  }, []);

  // Toggle the shell class so the body gradient yields to the canvas only while a background is active.
  useEffect(() => {
    const on = !!config && !!shaderRenderer();
    document.documentElement.classList.toggle('sw-platform-bg', on);
    return () => document.documentElement.classList.remove('sw-platform-bg');
  }, [config]);

  // Render loop — mirrors the picker preview: the shared offscreen renderer blitted onto the fixed canvas.
  useEffect(() => {
    const cv = canvasRef.current;
    const r = shaderRenderer();
    if (!config || !cv || !r) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches);
    const angleRad = (config.angle * Math.PI) / 180;
    let palette = paletteFromSlots(config.colors, editorIsDark());
    let raf = 0;
    let last = 0;
    let time = 0.8;
    let running = false;

    const paint = () => {
      const w = Math.max(2, Math.round(cv.clientWidth * DPR));
      const h = Math.max(2, Math.round(cv.clientHeight * DPR));
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      if (r.draw(config.preset, w, h, { time, mouse: [0, 0], intensity: INTENSITY, angle: angleRad, interact: 0, ...palette })) {
        ctx.drawImage(r.canvas, 0, 0, w, h);
      }
    };
    const frame = (now: number) => {
      if (!running) return;
      const dt = Math.min((now - last) / 1000 || 0, 0.05);
      last = now;
      time += dt * SPEED;
      paint();
      raf = requestAnimationFrame(frame);
    };
    const start = () => { if (running || reduce) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); };
    const stop = () => { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; };
    const onVis = () => { if (document.hidden) stop(); else start(); };

    // `auto` slots re-resolve on a theme flip (and repaint immediately when paused/reduced).
    const mo = new MutationObserver(() => { palette = paletteFromSlots(config.colors, editorIsDark()); paint(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const ro = 'ResizeObserver' in window ? new ResizeObserver(() => paint()) : null;
    ro?.observe(cv);
    document.addEventListener('visibilitychange', onVis);

    paint(); // first frame (also the only one under reduced-motion)
    if (!document.hidden) start(); // don't spin a RAF loop when mounted into an already-hidden tab
    return () => {
      stop();
      mo.disconnect();
      ro?.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [config]);

  if (!config || !shaderRenderer()) return null;
  return <canvas ref={canvasRef} aria-hidden className="sw-platform-canvas" />;
}
