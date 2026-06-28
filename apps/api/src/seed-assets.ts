import { optimizeImage, renderTrustedSvgToPng } from '@sitewright/image-pipeline';
import type { ImageAsset } from '@sitewright/schema';
import type { ContentRepository } from './repo/content.js';
import type { ProjectContext } from './repo/context.js';
import type { MediaStorage } from './media/storage.js';

// ---------------------------------------------------------------------------
// Local demo imagery for the Example Project. All art is FIRST-PARTY, generated
// here as abstract, editorial SVG compositions (deep gradient fields, radial
// glows, one bold geometric motif per brand, fine grain) — license-free and
// offline, no remote URLs. Each SVG is rasterized (trusted-input path) → run
// through the real optimize pipeline → stored as a normal media asset, filed
// into virtual folders. The pages/datasets then reference the LOCAL `/media/...`
// URLs (which publish rewrites to `_assets/...`).
//
// Renderer constraints (sharp → libvips → librsvg): shapes, paths, and
// linear/radial gradients ONLY — no <text> (fonts) and no SVG filters
// (feTurbulence/feGaussianBlur support varies). "Glow" is a radial gradient
// fading to transparent; "grain" is a deterministic PRNG dot scatter.
// ---------------------------------------------------------------------------

/** Mulberry32 — a tiny deterministic PRNG so the art (incl. grain) is byte-stable per seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A film-grain pass: `count` tiny dots scattered deterministically across the canvas. */
function grain(w: number, h: number, seed: number, count: number, color = '#ffffff', maxOpacity = 0.07): string {
  const r = rng(seed);
  let dots = '';
  for (let i = 0; i < count; i++) {
    const x = (r() * w).toFixed(1);
    const y = (r() * h).toFixed(1);
    const rad = (0.5 + r() * 0.9).toFixed(2);
    const o = (0.015 + r() * maxOpacity).toFixed(3);
    dots += `<circle cx="${x}" cy="${y}" r="${rad}" fill="${color}" fill-opacity="${o}"/>`;
  }
  return dots;
}

/** Soft radial glow centred at (cx,cy) — a gradient disc fading to fully transparent. */
function glow(id: string, cx: number, cy: number, r: number, color: string, opacity: number): string {
  return (
    `<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${color}" stop-opacity="${opacity}"/>` +
    `<stop offset="0.55" stop-color="${color}" stop-opacity="${(opacity * 0.45).toFixed(3)}"/>` +
    `<stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>` +
    `<!--use--><circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id})"/>`
  );
}

/** Splits the glow helper output into its <defs> part and its shape part. */
function splitGlow(g: string): { def: string; shape: string } {
  const [def, shape] = g.split('<!--use-->');
  return { def: def ?? '', shape: shape ?? '' };
}

/** Edge vignette — darkens the corners so compositions feel finished, not flat.
 * The gradient ships in its own inline `<defs>` block (SVG allows any number of `<defs>`
 * anywhere in the document) so paint servers never sit bare in render content — older
 * librsvg releases only resolve referenced gradients reliably from `<defs>`. */
function vignette(w: number, h: number, strength = 0.22): string {
  return (
    `<defs><radialGradient id="vig" cx="0.5" cy="0.46" r="0.75"><stop offset="0.62" stop-color="#000000" stop-opacity="0"/>` +
    `<stop offset="1" stop-color="#000000" stop-opacity="${strength}"/></radialGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#vig)"/>`
  );
}

/** A brand's art palette: a deep two-stop field, two glow hues, and a light foreground. */
interface ArtPalette {
  bg0: string;
  bg1: string;
  glowA: string;
  glowB: string;
  fg: string;
}

type Motif = 'arcs' | 'waves' | 'chart' | 'grid' | 'embers' | 'rays';

/** The big geometric motif per demo client — one strong idea per cover, drawn large. */
function motifArt(motif: Motif, w: number, h: number, p: ArtPalette, seed: number): string {
  const r = rng(seed);
  switch (motif) {
    case 'arcs': {
      // Concentric sunrise arcs rising from the lower-right — warm, calm, coffee-ripple energy.
      const cx = w * 0.68;
      const cy = h * 0.95;
      return (
        [0, 1, 2, 3, 4]
          .map(
            (i) =>
              `<circle cx="${cx}" cy="${cy}" r="${h * 0.22 + i * h * 0.13}" fill="none" stroke="${p.fg}" ` +
              `stroke-opacity="${(0.68 - i * 0.11).toFixed(2)}" stroke-width="${24 - i * 3}"/>`,
          )
          .join('') + `<circle cx="${cx}" cy="${cy - h * 0.08}" r="${h * 0.085}" fill="${p.fg}" fill-opacity="0.85"/>`
      );
    }
    case 'waves': {
      // Layered breathing ribbons — soft, clinical-calm.
      const ribbon = (y: number, amp: number, sw: number, o: number, color: string): string =>
        `<path d="M ${-w * 0.05} ${y} C ${w * 0.25} ${y - amp}, ${w * 0.45} ${y + amp}, ${w * 0.68} ${y - amp * 0.4} S ${w * 1.02} ${y + amp * 0.5}, ${w * 1.08} ${y - amp * 0.2}" fill="none" stroke="${color}" stroke-opacity="${o}" stroke-width="${sw}" stroke-linecap="round"/>`;
      const floats = [0, 1, 2, 3, 4, 5]
        .map(() => `<circle cx="${(w * (0.12 + r() * 0.76)).toFixed(0)}" cy="${(h * (0.12 + r() * 0.4)).toFixed(0)}" r="${(6 + r() * 12).toFixed(1)}" fill="${p.fg}" fill-opacity="${(0.35 + r() * 0.4).toFixed(2)}"/>`)
        .join('');
      return (
        ribbon(h * 0.52, 130, 46, 0.95, p.glowA) +
        ribbon(h * 0.66, 105, 30, 0.5, p.fg) +
        ribbon(h * 0.79, 80, 20, 0.28, p.fg) +
        ribbon(h * 0.9, 60, 14, 0.15, p.fg) +
        floats
      );
    }
    case 'chart': {
      // An ascending curve over quiet columns — finance without the cliché.
      const bars = [0.32, 0.45, 0.4, 0.58, 0.72, 0.88]
        .map((v, i) => {
          const bw = w * 0.055;
          const x = w * 0.18 + i * w * 0.115;
          return `<rect x="${x}" y="${h - h * 0.62 * v - h * 0.12}" width="${bw}" height="${h * 0.62 * v}" rx="${bw / 2}" fill="${p.fg}" fill-opacity="${(0.1 + i * 0.04).toFixed(2)}"/>`;
        })
        .join('');
      const pts: Array<[number, number]> = [0.3, 0.42, 0.38, 0.55, 0.7, 0.86].map((v, i) => [w * 0.18 + i * w * 0.115 + w * 0.0275, h - h * 0.62 * v - h * 0.16]);
      const path = pts.map((pt, i) => (i === 0 ? `M ${pt[0]} ${pt[1]}` : `L ${pt[0]} ${pt[1]}`)).join(' ');
      const dots = pts.map((pt) => `<circle cx="${pt[0]}" cy="${pt[1]}" r="7" fill="${p.fg}"/>`).join('');
      return bars + `<path d="${path}" fill="none" stroke="${p.fg}" stroke-opacity="0.9" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>` + dots;
    }
    case 'grid': {
      // A blueprint of nested frames with one solid gold block — architectural restraint.
      const fx = w * 0.2;
      const fy = h * 0.18;
      const fw = w * 0.6;
      const fh = h * 0.64;
      return (
        `<rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" fill="none" stroke="${p.fg}" stroke-opacity="0.75" stroke-width="4"/>` +
        `<rect x="${fx + 36}" y="${fy + 36}" width="${fw - 72}" height="${fh - 72}" fill="none" stroke="${p.fg}" stroke-opacity="0.4" stroke-width="2.5"/>` +
        `<line x1="${fx + fw * 0.62}" y1="${fy}" x2="${fx + fw * 0.62}" y2="${fy + fh}" stroke="${p.fg}" stroke-opacity="0.3" stroke-width="2"/>` +
        `<line x1="${fx}" y1="${fy + fh * 0.55}" x2="${fx + fw}" y2="${fy + fh * 0.55}" stroke="${p.fg}" stroke-opacity="0.3" stroke-width="2"/>` +
        `<rect x="${fx + fw * 0.62}" y="${fy + fh * 0.55}" width="${fw * 0.38}" height="${fh * 0.45}" fill="${p.glowB}" fill-opacity="0.85"/>` +
        `<circle cx="${fx + fw * 0.31}" cy="${fy + fh * 0.275}" r="${fh * 0.13}" fill="none" stroke="${p.fg}" stroke-opacity="0.5" stroke-width="3"/>`
      );
    }
    case 'embers': {
      // Rising embers over a glowing heat horizon — each ember is a soft gradient disc with a
      // bright core, so the fire reads even from a thumbnail.
      // The gradients ride in an inline <defs> (legal anywhere; see vignette()).
      const horizon =
        `<defs><radialGradient id="heat" cx="0.5" cy="1" r="1"><stop offset="0" stop-color="${p.glowA}" stop-opacity="0.85"/>` +
        `<stop offset="0.45" stop-color="${p.glowB}" stop-opacity="0.35"/><stop offset="1" stop-color="${p.glowB}" stop-opacity="0"/></radialGradient>` +
        `<radialGradient id="ember" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${p.fg}" stop-opacity="0.95"/>` +
        `<stop offset="0.35" stop-color="${p.glowA}" stop-opacity="0.8"/><stop offset="1" stop-color="${p.glowA}" stop-opacity="0"/></radialGradient></defs>` +
        `<ellipse cx="${w * 0.5}" cy="${h * 1.04}" rx="${w * 0.62}" ry="${h * 0.42}" fill="url(#heat)"/>`;
      let sparks = '';
      for (let i = 0; i < 34; i++) {
        const x = w * (0.08 + r() * 0.84);
        const y = h * (0.1 + r() * 0.78);
        const rise = y / h; // lower embers are bigger + brighter
        const rad = 6 + r() * 26 * rise;
        sparks += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${rad.toFixed(1)}" fill="url(#ember)" fill-opacity="${(0.35 + 0.6 * rise).toFixed(2)}"/>`;
      }
      const core = `<circle cx="${w * 0.5}" cy="${h * 0.86}" r="${h * 0.05}" fill="${p.fg}" fill-opacity="0.95"/><circle cx="${w * 0.5}" cy="${h * 0.86}" r="${h * 0.12}" fill="url(#ember)"/>`;
      return horizon + sparks + core;
    }
    case 'rays': {
      // A fan of light beams from the lower-left + confetti — launch-night energy.
      const ox = w * 0.12;
      const oy = h * 0.95;
      const beams = [-82, -68, -54, -40, -26, -12]
        .map((deg, i) => {
          const rad = (deg * Math.PI) / 180;
          const len = h * 1.15;
          const x2 = ox + Math.cos(rad) * len;
          const y2 = oy + Math.sin(rad) * len;
          return `<line x1="${ox}" y1="${oy}" x2="${x2.toFixed(0)}" y2="${y2.toFixed(0)}" stroke="${i % 2 ? p.glowB : p.fg}" stroke-opacity="${(0.7 - i * 0.08).toFixed(2)}" stroke-width="${28 - i * 3}" stroke-linecap="round"/>`;
        })
        .join('');
      let confetti = '';
      for (let i = 0; i < 18; i++) {
        const x = w * (0.35 + r() * 0.6);
        const y = h * (0.08 + r() * 0.55);
        confetti += `<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${(6 + r() * 8).toFixed(0)}" height="${(6 + r() * 8).toFixed(0)}" rx="2" transform="rotate(${(r() * 80 - 40).toFixed(0)} ${x.toFixed(0)} ${y.toFixed(0)})" fill="${r() > 0.5 ? p.fg : p.glowB}" fill-opacity="${(0.3 + r() * 0.5).toFixed(2)}"/>`;
      }
      return beams + confetti;
    }
  }
}

/** A project cover: deep gradient field + twin glows + the brand motif + grain + vignette. */
function projectCover(p: ArtPalette, motif: Motif, seed: number, w = 1200, h = 840): string {
  const g1 = splitGlow(glow('gA', w * 0.78, h * 0.22, w * 0.55, p.glowA, 0.5));
  const g2 = splitGlow(glow('gB', w * 0.15, h * 0.85, w * 0.5, p.glowB, 0.3));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.bg0}"/><stop offset="1" stop-color="${p.bg1}"/></linearGradient>
    ${g1.def}${g2.def}
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  ${g1.shape}${g2.shape}
  ${motifArt(motif, w, h, p, seed)}
  ${grain(w, h, seed + 7, 850)}
  ${vignette(w, h)}
</svg>`;
}

/** An abstract portrait: a luminous orb on a deep field, a fine orbit ring, per-person geometry. */
function avatarOrb(a: string, b: string, deep: string, seed: number, w = 600, h = 600): string {
  const r = rng(seed);
  const ox = w * (0.42 + r() * 0.16);
  const oy = h * (0.38 + r() * 0.12);
  const orad = w * (0.3 + r() * 0.06);
  const ringRad = orad * (1.32 + r() * 0.18);
  const ringTilt = (r() * 50 - 25).toFixed(0);
  const satAngle = r() * Math.PI * 2;
  const sx = ox + Math.cos(satAngle) * ringRad;
  const sy = oy + Math.sin(satAngle) * ringRad * 0.6;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${deep}"/><stop offset="1" stop-color="${a}" stop-opacity="0.55"/></linearGradient>
    <radialGradient id="orb" cx="0.38" cy="0.32" r="0.85"><stop offset="0" stop-color="${b}"/><stop offset="0.55" stop-color="${a}"/><stop offset="1" stop-color="${deep}"/></radialGradient>
    <radialGradient id="halo" cx="0.5" cy="0.5" r="0.5"><stop offset="0.6" stop-color="${b}" stop-opacity="0.35"/><stop offset="1" stop-color="${b}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <circle cx="${ox}" cy="${oy}" r="${orad * 1.45}" fill="url(#halo)"/>
  <circle cx="${ox}" cy="${oy}" r="${orad}" fill="url(#orb)"/>
  <ellipse cx="${ox}" cy="${oy}" rx="${ringRad}" ry="${ringRad * 0.6}" transform="rotate(${ringTilt} ${ox} ${oy})" fill="none" stroke="#ffffff" stroke-opacity="0.4" stroke-width="2.5"/>
  <circle cx="${sx.toFixed(0)}" cy="${sy.toFixed(0)}" r="9" fill="#ffffff" fill-opacity="0.85" transform="rotate(${ringTilt} ${ox} ${oy})"/>
  ${grain(w, h, seed + 3, 420)}
  ${vignette(w, h, 0.28)}
</svg>`;
}

// ------------------------------------------------------------------ studio scenes
// The About-page gallery: flat-illustration interiors in the brand's ink/indigo
// world — consistent light (a warm window glow), soft shadows, no text.

interface ScenePalette {
  wall0: string;
  wall1: string;
  floor: string;
  ink: string;
  accent: string;
  accent2: string;
  warm: string;
}

const SCENE: ScenePalette = {
  wall0: '#1b1a2e',
  wall1: '#12111f',
  floor: '#0d0c16',
  ink: '#070710',
  accent: '#6366f1',
  accent2: '#38bdf8',
  warm: '#f59e0b',
};

function sceneShell(w: number, h: number, body: string, seed: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${SCENE.wall0}"/><stop offset="1" stop-color="${SCENE.wall1}"/></linearGradient>
    <radialGradient id="roomglow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${SCENE.accent}" stop-opacity="0.35"/><stop offset="1" stop-color="${SCENE.accent}" stop-opacity="0"/></radialGradient>
    <radialGradient id="warmglow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${SCENE.warm}" stop-opacity="0.4"/><stop offset="1" stop-color="${SCENE.warm}" stop-opacity="0"/></radialGradient>
    <linearGradient id="screen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${SCENE.accent}"/><stop offset="1" stop-color="${SCENE.accent2}"/></linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#wall)"/>
  ${body}
  ${grain(w, h, seed, 600)}
  ${vignette(w, h, 0.3)}
</svg>`;
}

/** Desk scene: a glowing monitor on a clean desk, window light, a plant. */
function sceneDesk(w = 1000, h = 750, seed = 41): string {
  const deskY = h * 0.72;
  const body = `
  <circle cx="${w * 0.32}" cy="${h * 0.3}" r="${w * 0.42}" fill="url(#roomglow)"/>
  <!-- window -->
  <g>
    <rect x="${w * 0.06}" y="${h * 0.1}" width="${w * 0.24}" height="${h * 0.42}" rx="10" fill="${SCENE.accent2}" fill-opacity="0.12" stroke="#ffffff" stroke-opacity="0.18" stroke-width="3"/>
    <line x1="${w * 0.18}" y1="${h * 0.1}" x2="${w * 0.18}" y2="${h * 0.52}" stroke="#ffffff" stroke-opacity="0.15" stroke-width="3"/>
    <line x1="${w * 0.06}" y1="${h * 0.31}" x2="${w * 0.3}" y2="${h * 0.31}" stroke="#ffffff" stroke-opacity="0.15" stroke-width="3"/>
  </g>
  <!-- floor + desk -->
  <rect x="0" y="${deskY + h * 0.06}" width="${w}" height="${h - deskY}" fill="${SCENE.floor}"/>
  <rect x="${w * 0.12}" y="${deskY}" width="${w * 0.76}" height="${h * 0.025}" rx="${h * 0.0125}" fill="#2a2840"/>
  <rect x="${w * 0.17}" y="${deskY + h * 0.025}" width="${w * 0.02}" height="${h * 0.16}" fill="#211f33"/>
  <rect x="${w * 0.81}" y="${deskY + h * 0.025}" width="${w * 0.02}" height="${h * 0.16}" fill="#211f33"/>
  <!-- monitor -->
  <g>
    <ellipse cx="${w * 0.5}" cy="${deskY - 2}" rx="${w * 0.17}" ry="8" fill="${SCENE.ink}" fill-opacity="0.5"/>
    <rect x="${w * 0.47}" y="${deskY - h * 0.07}" width="${w * 0.06}" height="${h * 0.06}" fill="#211f33"/>
    <rect x="${w * 0.33}" y="${deskY - h * 0.43}" width="${w * 0.34}" height="${h * 0.36}" rx="14" fill="#211f33"/>
    <rect x="${w * 0.345}" y="${deskY - h * 0.415}" width="${w * 0.31}" height="${h * 0.31}" rx="8" fill="url(#screen)"/>
    <rect x="${w * 0.365}" y="${deskY - h * 0.385}" width="${w * 0.12}" height="${h * 0.022}" rx="${h * 0.011}" fill="#ffffff" fill-opacity="0.9"/>
    <rect x="${w * 0.365}" y="${deskY - h * 0.345}" width="${w * 0.2}" height="${h * 0.013}" rx="${h * 0.0065}" fill="#ffffff" fill-opacity="0.45"/>
    <rect x="${w * 0.365}" y="${deskY - h * 0.32}" width="${w * 0.17}" height="${h * 0.013}" rx="${h * 0.0065}" fill="#ffffff" fill-opacity="0.45"/>
    <rect x="${w * 0.365}" y="${deskY - h * 0.28}" width="${w * 0.08}" height="${h * 0.034}" rx="${h * 0.017}" fill="#ffffff" fill-opacity="0.92"/>
    <rect x="${w * 0.49}" y="${deskY - h * 0.225}" width="${w * 0.15}" height="${h * 0.1}" rx="10" fill="#ffffff" fill-opacity="0.16"/>
    <rect x="${w * 0.365}" y="${deskY - h * 0.225}" width="${w * 0.11}" height="${h * 0.1}" rx="10" fill="#ffffff" fill-opacity="0.1"/>
  </g>
  <!-- keyboard + mug -->
  <rect x="${w * 0.42}" y="${deskY - h * 0.012}" width="${w * 0.16}" height="${h * 0.012}" rx="4" fill="#3a3756"/>
  <g>
    <rect x="${w * 0.66}" y="${deskY - h * 0.045}" width="${w * 0.035}" height="${h * 0.045}" rx="6" fill="${SCENE.warm}"/>
    <path d="M ${w * 0.695} ${deskY - h * 0.038} q ${w * 0.022} 4 0 ${h * 0.026}" fill="none" stroke="${SCENE.warm}" stroke-width="5"/>
  </g>
  <!-- plant -->
  <g>
    <circle cx="${w * 0.88}" cy="${deskY - h * 0.1}" r="${w * 0.09}" fill="url(#warmglow)"/>
    <rect x="${w * 0.855}" y="${deskY - h * 0.075}" width="${w * 0.05}" height="${h * 0.075}" rx="8" fill="#2a2840"/>
    <path d="M ${w * 0.88} ${deskY - h * 0.07} C ${w * 0.85} ${deskY - h * 0.16}, ${w * 0.84} ${deskY - h * 0.2}, ${w * 0.855} ${deskY - h * 0.24}" fill="none" stroke="#34d399" stroke-width="7" stroke-linecap="round"/>
    <path d="M ${w * 0.88} ${deskY - h * 0.07} C ${w * 0.9} ${deskY - h * 0.17}, ${w * 0.92} ${deskY - h * 0.2}, ${w * 0.915} ${deskY - h * 0.25}" fill="none" stroke="#34d399" stroke-width="7" stroke-linecap="round"/>
    <path d="M ${w * 0.88} ${deskY - h * 0.07} C ${w * 0.88} ${deskY - h * 0.18}, ${w * 0.875} ${deskY - h * 0.23}, ${w * 0.885} ${deskY - h * 0.28}" fill="none" stroke="#10b981" stroke-width="7" stroke-linecap="round"/>
  </g>`;
  return sceneShell(w, h, body, seed);
}

/** Whiteboard scene: a wireframe sketch on a board, warm lamp, two stools. */
function sceneBoard(w = 1000, h = 750, seed = 42): string {
  const bx = w * 0.22;
  const by = h * 0.14;
  const bw = w * 0.56;
  const bh = h * 0.46;
  const floorY = h * 0.78;
  const body = `
  <circle cx="${w * 0.5}" cy="${h * 0.35}" r="${w * 0.4}" fill="url(#roomglow)"/>
  <rect x="0" y="${floorY}" width="${w}" height="${h - floorY}" fill="${SCENE.floor}"/>
  <!-- board -->
  <ellipse cx="${w * 0.5}" cy="${floorY + 8}" rx="${bw * 0.42}" ry="9" fill="${SCENE.ink}" fill-opacity="0.5"/>
  <line x1="${w * 0.34}" y1="${by + bh}" x2="${w * 0.3}" y2="${floorY}" stroke="#2a2840" stroke-width="9"/>
  <line x1="${w * 0.66}" y1="${by + bh}" x2="${w * 0.7}" y2="${floorY}" stroke="#2a2840" stroke-width="9"/>
  <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="16" fill="#f4f3fb"/>
  <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="16" fill="none" stroke="#2a2840" stroke-width="5"/>
  <!-- the sketch: a wireframe with a highlighted hero -->
  <rect x="${bx + bw * 0.08}" y="${by + bh * 0.12}" width="${bw * 0.5}" height="${bh * 0.1}" rx="${bh * 0.05}" fill="${SCENE.accent}" fill-opacity="0.9"/>
  <rect x="${bx + bw * 0.08}" y="${by + bh * 0.3}" width="${bw * 0.36}" height="${bh * 0.045}" rx="${bh * 0.0225}" fill="#3f3d5c" fill-opacity="0.5"/>
  <rect x="${bx + bw * 0.08}" y="${by + bh * 0.39}" width="${bw * 0.3}" height="${bh * 0.045}" rx="${bh * 0.0225}" fill="#3f3d5c" fill-opacity="0.35"/>
  <circle cx="${bx + bw * 0.78}" cy="${by + bh * 0.28}" r="${bh * 0.14}" fill="none" stroke="${SCENE.accent2}" stroke-width="6"/>
  <path d="M ${bx + bw * 0.71} ${by + bh * 0.3} l ${bw * 0.045} -${bh * 0.07} l ${bw * 0.035} ${bh * 0.045} l ${bw * 0.05} -${bh * 0.09}" fill="none" stroke="${SCENE.accent2}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="${bx + bw * 0.08}" y="${by + bh * 0.56}" width="${bw * 0.24}" height="${bh * 0.3}" rx="10" fill="${SCENE.warm}" fill-opacity="0.55"/>
  <rect x="${bx + bw * 0.37}" y="${by + bh * 0.56}" width="${bw * 0.24}" height="${bh * 0.3}" rx="10" fill="${SCENE.accent}" fill-opacity="0.35"/>
  <rect x="${bx + bw * 0.66}" y="${by + bh * 0.56}" width="${bw * 0.24}" height="${bh * 0.3}" rx="10" fill="${SCENE.accent2}" fill-opacity="0.3"/>
  <!-- lamp -->
  <circle cx="${w * 0.875}" cy="${h * 0.27}" r="${w * 0.085}" fill="url(#warmglow)"/>
  <circle cx="${w * 0.875}" cy="${h * 0.27}" r="${w * 0.028}" fill="${SCENE.warm}"/>
  <line x1="${w * 0.875}" y1="${h * 0.07}" x2="${w * 0.875}" y2="${h * 0.243}" stroke="#2a2840" stroke-width="6"/>
  <!-- stools -->
  <g>
    <rect x="${w * 0.1}" y="${floorY - h * 0.12}" width="${w * 0.085}" height="${h * 0.025}" rx="${h * 0.0125}" fill="${SCENE.accent}" fill-opacity="0.8"/>
    <line x1="${w * 0.115}" y1="${floorY - h * 0.095}" x2="${w * 0.105}" y2="${floorY}" stroke="#2a2840" stroke-width="7"/>
    <line x1="${w * 0.17}" y1="${floorY - h * 0.095}" x2="${w * 0.18}" y2="${floorY}" stroke="#2a2840" stroke-width="7"/>
  </g>
  <g>
    <rect x="${w * 0.82}" y="${floorY - h * 0.12}" width="${w * 0.085}" height="${h * 0.025}" rx="${h * 0.0125}" fill="${SCENE.accent2}" fill-opacity="0.7"/>
    <line x1="${w * 0.835}" y1="${floorY - h * 0.095}" x2="${w * 0.825}" y2="${floorY}" stroke="#2a2840" stroke-width="7"/>
    <line x1="${w * 0.89}" y1="${floorY - h * 0.095}" x2="${w * 0.9}" y2="${floorY}" stroke="#2a2840" stroke-width="7"/>
  </g>`;
  return sceneShell(w, h, body, seed);
}

/** Moodboard wall: pinned gradient swatches under a wash of light. */
function sceneWall(w = 1000, h = 750, seed = 43): string {
  const r = rng(seed);
  const cards = [
    { x: 0.12, y: 0.14, cw: 0.2, ch: 0.24, f: 'url(#screen)', o: 1, rot: -3 },
    { x: 0.37, y: 0.1, cw: 0.14, ch: 0.32, f: SCENE.warm, o: 0.8, rot: 2 },
    { x: 0.56, y: 0.16, cw: 0.22, ch: 0.2, f: '#f4f3fb', o: 0.95, rot: -1 },
    { x: 0.14, y: 0.48, cw: 0.16, ch: 0.26, f: '#f4f3fb', o: 0.9, rot: 2 },
    { x: 0.36, y: 0.52, cw: 0.22, ch: 0.22, f: SCENE.accent2, o: 0.55, rot: -2 },
    { x: 0.63, y: 0.46, cw: 0.17, ch: 0.3, f: SCENE.accent, o: 0.75, rot: 3 },
  ];
  const swatches = cards
    .map((c) => {
      const x = w * c.x;
      const y = h * c.y;
      const cw = w * c.cw;
      const ch = h * c.ch;
      const cx = x + cw / 2;
      const inner =
        c.f === '#f4f3fb'
          ? `<rect x="${x + cw * 0.14}" y="${y + ch * 0.2}" width="${cw * 0.72}" height="${ch * 0.12}" rx="${ch * 0.06}" fill="#3f3d5c" fill-opacity="0.55" transform="rotate(${c.rot} ${cx} ${y + ch / 2})"/>` +
            `<rect x="${x + cw * 0.14}" y="${y + ch * 0.45}" width="${cw * 0.5}" height="${ch * 0.1}" rx="${ch * 0.05}" fill="#3f3d5c" fill-opacity="0.3" transform="rotate(${c.rot} ${cx} ${y + ch / 2})"/>`
          : '';
      return (
        `<g><rect x="${x + 6}" y="${y + 9}" width="${cw}" height="${ch}" rx="10" fill="${SCENE.ink}" fill-opacity="0.45" transform="rotate(${c.rot} ${cx} ${y + ch / 2})"/>` +
        `<rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="10" fill="${c.f}" fill-opacity="${c.o}" transform="rotate(${c.rot} ${cx} ${y + ch / 2})"/>` +
        inner +
        `<circle cx="${cx}" cy="${y + 4}" r="5.5" fill="#dcd9ee" transform="rotate(${c.rot} ${cx} ${y + ch / 2})"/></g>`
      );
    })
    .join('');
  let tape = '';
  for (let i = 0; i < 7; i++) {
    tape += `<rect x="${(w * (0.1 + r() * 0.75)).toFixed(0)}" y="${(h * (0.82 + r() * 0.08)).toFixed(0)}" width="${(w * 0.05).toFixed(0)}" height="10" rx="5" fill="#ffffff" fill-opacity="${(0.1 + r() * 0.2).toFixed(2)}"/>`;
  }
  const body = `
  <circle cx="${w * 0.45}" cy="${h * 0.32}" r="${w * 0.45}" fill="url(#roomglow)"/>
  <circle cx="${w * 0.85}" cy="${h * 0.75}" r="${w * 0.3}" fill="url(#warmglow)"/>
  ${swatches}
  ${tape}`;
  return sceneShell(w, h, body, seed);
}

/** Still-life scene: keyboard, notebook, and a coffee — warm close-up. */
function sceneStill(w = 1000, h = 750, seed = 44): string {
  const body = `
  <circle cx="${w * 0.7}" cy="${h * 0.25}" r="${w * 0.4}" fill="url(#warmglow)"/>
  <circle cx="${w * 0.2}" cy="${h * 0.75}" r="${w * 0.35}" fill="url(#roomglow)"/>
  <!-- keyboard -->
  <g transform="rotate(-5 ${w * 0.3} ${h * 0.4})">
    <rect x="${w * 0.08}" y="${h * 0.22}" width="${w * 0.44}" height="${h * 0.26}" rx="18" fill="#211f33"/>
    ${Array.from({ length: 4 }, (_, row) =>
      Array.from({ length: 10 }, (_, col) => {
        const kx = w * 0.1 + col * w * 0.041;
        const ky = h * 0.245 + row * h * 0.058;
        const lit = (row === 1 && col === 3) || (row === 2 && col === 7);
        return `<rect x="${kx.toFixed(0)}" y="${ky.toFixed(0)}" width="${(w * 0.033).toFixed(0)}" height="${(h * 0.046).toFixed(0)}" rx="7" fill="${lit ? SCENE.accent : '#ffffff'}" fill-opacity="${lit ? 0.85 : 0.13}"/>`;
      }).join(''),
    ).join('')}
  </g>
  <!-- notebook -->
  <g transform="rotate(6 ${w * 0.72} ${h * 0.55})">
    <rect x="${w * 0.6}" y="${h * 0.3}" width="${w * 0.26}" height="${h * 0.46}" rx="12" fill="#f4f3fb"/>
    <rect x="${w * 0.6}" y="${h * 0.3}" width="${w * 0.045}" height="${h * 0.46}" rx="12" fill="${SCENE.accent}"/>
    <line x1="${w * 0.68}" y1="${h * 0.4}" x2="${w * 0.82}" y2="${h * 0.4}" stroke="#3f3d5c" stroke-opacity="0.5" stroke-width="7" stroke-linecap="round"/>
    <line x1="${w * 0.68}" y1="${h * 0.47}" x2="${w * 0.8}" y2="${h * 0.47}" stroke="#3f3d5c" stroke-opacity="0.3" stroke-width="7" stroke-linecap="round"/>
    <line x1="${w * 0.68}" y1="${h * 0.54}" x2="${w * 0.81}" y2="${h * 0.54}" stroke="#3f3d5c" stroke-opacity="0.3" stroke-width="7" stroke-linecap="round"/>
    <circle cx="${w * 0.71}" cy="${h * 0.66}" r="${h * 0.045}" fill="none" stroke="${SCENE.accent2}" stroke-width="6"/>
    <path d="M ${w * 0.74} ${h * 0.63} l ${w * 0.05} ${h * 0.06}" stroke="${SCENE.accent2}" stroke-width="6" stroke-linecap="round"/>
  </g>
  <!-- coffee -->
  <g>
    <ellipse cx="${w * 0.36}" cy="${h * 0.83}" rx="${w * 0.105}" ry="${h * 0.022}" fill="${SCENE.ink}" fill-opacity="0.55"/>
    <circle cx="${w * 0.36}" cy="${h * 0.76}" r="${w * 0.082}" fill="#2a2840"/>
    <circle cx="${w * 0.36}" cy="${h * 0.76}" r="${w * 0.062}" fill="${SCENE.warm}" fill-opacity="0.85"/>
    <path d="M ${w * 0.345} ${h * 0.655} q ${w * 0.012} -${h * 0.03} 0 -${h * 0.05}" fill="none" stroke="#ffffff" stroke-opacity="0.35" stroke-width="5" stroke-linecap="round"/>
    <path d="M ${w * 0.375} ${h * 0.66} q ${w * 0.012} -${h * 0.025} 0 -${h * 0.045}" fill="none" stroke="#ffffff" stroke-opacity="0.25" stroke-width="5" stroke-linecap="round"/>
  </g>`;
  return sceneShell(w, h, body, seed);
}

/** The hero artwork: floating glass UI panels over an aurora field — the studio's own brand. */
function heroArt(w = 1100, h = 800, seed = 11): string {
  const gA = splitGlow(glow('hA', w * 0.75, h * 0.18, w * 0.65, '#6366f1', 0.95));
  const gB = splitGlow(glow('hB', w * 0.12, h * 0.55, w * 0.6, '#0ea5e9', 0.75));
  const gC = splitGlow(glow('hC', w * 0.65, h * 0.95, w * 0.55, '#a855f7', 0.65));
  const gridLines =
    Array.from({ length: 9 }, (_, i) => `<line x1="${(i + 1) * (w / 10)}" y1="0" x2="${(i + 1) * (w / 10)}" y2="${h}" stroke="#ffffff" stroke-opacity="0.045" stroke-width="1"/>`).join('') +
    Array.from({ length: 7 }, (_, i) => `<line x1="0" y1="${(i + 1) * (h / 8)}" x2="${w}" y2="${(i + 1) * (h / 8)}" stroke="#ffffff" stroke-opacity="0.045" stroke-width="1"/>`).join('');
  const panel = (x: number, y: number, pw: number, ph: number, rot: number, inner: string): string =>
    `<g transform="rotate(${rot} ${x + pw / 2} ${y + ph / 2})">` +
    `<rect x="${x}" y="${y}" width="${pw}" height="${ph}" rx="20" fill="#ffffff" fill-opacity="0.1" stroke="#ffffff" stroke-opacity="0.35" stroke-width="2"/>` +
    inner +
    `</g>`;
  const mainInner =
    `<rect x="${w * 0.255}" y="${h * 0.255}" width="${w * 0.16}" height="${h * 0.028}" rx="${h * 0.014}" fill="#ffffff" fill-opacity="0.9"/>` +
    `<rect x="${w * 0.255}" y="${h * 0.31}" width="${w * 0.26}" height="${h * 0.016}" rx="${h * 0.008}" fill="#ffffff" fill-opacity="0.4"/>` +
    `<rect x="${w * 0.255}" y="${h * 0.345}" width="${w * 0.22}" height="${h * 0.016}" rx="${h * 0.008}" fill="#ffffff" fill-opacity="0.4"/>` +
    `<rect x="${w * 0.255}" y="${h * 0.40}" width="${w * 0.1}" height="${h * 0.042}" rx="${h * 0.021}" fill="url(#cta)"/>` +
    `<rect x="${w * 0.255}" y="${h * 0.49}" width="${w * 0.115}" height="${h * 0.13}" rx="14" fill="#ffffff" fill-opacity="0.1"/>` +
    `<rect x="${w * 0.385}" y="${h * 0.49}" width="${w * 0.115}" height="${h * 0.13}" rx="14" fill="#ffffff" fill-opacity="0.14"/>`;
  const sideInner =
    `<circle cx="${w * 0.715}" cy="${h * 0.42}" r="${h * 0.052}" fill="url(#cta)"/>` +
    `<path d="M ${w * 0.7} ${h * 0.425} l ${w * 0.011} ${h * 0.014} l ${w * 0.019} -${h * 0.028}" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<rect x="${w * 0.665}" y="${h * 0.51}" width="${w * 0.1}" height="${h * 0.015}" rx="${h * 0.0075}" fill="#ffffff" fill-opacity="0.55"/>` +
    `<rect x="${w * 0.665}" y="${h * 0.545}" width="${w * 0.075}" height="${h * 0.015}" rx="${h * 0.0075}" fill="#ffffff" fill-opacity="0.3"/>`;
  const chipInner =
    `<rect x="${w * 0.575}" y="${h * 0.745}" width="${w * 0.05}" height="${h * 0.05}" rx="12" fill="url(#cta)"/>` +
    `<path d="M ${w * 0.645} ${h * 0.79} l ${w * 0.025} -${h * 0.026} l ${w * 0.02} ${h * 0.014} l ${w * 0.03} -${h * 0.032}" fill="none" stroke="#ffffff" stroke-opacity="0.85" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#11102b"/><stop offset="1" stop-color="#080714"/></linearGradient>
    <linearGradient id="cta" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#0ea5e9"/></linearGradient>
    ${gA.def}${gB.def}${gC.def}
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  ${gA.shape}${gB.shape}${gC.shape}
  ${gridLines}
  ${panel(w * 0.21, h * 0.19, w * 0.34, h * 0.49, -2, mainInner)}
  ${panel(w * 0.62, h * 0.33, w * 0.2, h * 0.29, 3, sideInner)}
  ${panel(w * 0.55, h * 0.7, w * 0.16, h * 0.14, -3, chipInner)}
  ${grain(w, h, seed, 900)}
  ${vignette(w, h, 0.25)}
</svg>`;
}

/** A blog cover: deep field + one luminous motif, sized for 16:9 article cards. */
function blogCover(motif: 'speed' | 'design' | 'seo', w = 960, h = 540): string {
  const gA = splitGlow(glow('bA', w * 0.7, h * 0.25, w * 0.55, '#6366f1', 0.6));
  const gB = splitGlow(glow('bB', w * 0.2, h * 0.85, w * 0.45, '#0ea5e9', 0.4));
  let art = '';
  if (motif === 'speed') {
    art = [0, 1, 2]
      .map(
        (i) =>
          `<path d="M ${w * 0.3 + i * w * 0.14} ${h * 0.28} l ${w * 0.13} ${h * 0.22} l -${w * 0.13} ${h * 0.22}" stroke="#ffffff" stroke-opacity="${(0.9 - i * 0.3).toFixed(2)}" stroke-width="${30 - i * 6}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
      )
      .join('');
  } else if (motif === 'design') {
    art = [0, 1, 2]
      .map((row) =>
        [0, 1, 2, 3]
          .map((col) => {
            const x = w * 0.3 + col * w * 0.115;
            const y = h * 0.21 + row * h * 0.21;
            const round = (row + col) % 2 ? w * 0.0425 : 12;
            const o = 0.2 + ((row + col) % 3) * 0.28;
            return `<rect x="${x}" y="${y}" width="${w * 0.085}" height="${w * 0.085}" rx="${round}" fill="#ffffff" fill-opacity="${o.toFixed(2)}"/>`;
          })
          .join(''),
      )
      .join('');
  } else {
    art =
      `<circle cx="${w * 0.45}" cy="${h * 0.46}" r="${h * 0.21}" fill="none" stroke="#ffffff" stroke-opacity="0.9" stroke-width="18"/>` +
      `<line x1="${w * 0.535}" y1="${h * 0.62}" x2="${w * 0.65}" y2="${h * 0.84}" stroke="#ffffff" stroke-opacity="0.9" stroke-width="20" stroke-linecap="round"/>` +
      [0, 1, 2].map((i) => `<rect x="${w * 0.395 + i * w * 0.04}" y="${h * (0.52 - i * 0.09)}" width="${w * 0.024}" height="${h * (0.08 + i * 0.09)}" rx="6" fill="#ffffff" fill-opacity="0.7"/>`).join('');
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#161434"/><stop offset="1" stop-color="#0a0918"/></linearGradient>
    ${gA.def}${gB.def}
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  ${gA.shape}${gB.shape}
  ${art}
  ${grain(w, h, 23, 700)}
  ${vignette(w, h)}
</svg>`;
}

/** A product tile: a lit backdrop, soft floor shadow, and a shaded merch silhouette. */
function productTile(item: 'tee' | 'mug' | 'notebook' | 'poster' | 'stickers' | 'cap', w = 640, h = 640): string {
  const accent = '#4f46e5';
  const accent2 = '#0ea5e9';
  const shade = '#101024';
  const white = '#f7f6fd';
  const shapes: Record<string, string> = {
    tee:
      // a classic tee: shoulders → angled sleeves → straight body, shaded right half + chest mark
      `<path d="M 277 176 Q 320 208 363 176 L 412 198 L 452 268 L 388 296 L 388 452 Q 320 468 252 452 L 252 296 L 188 268 L 228 198 Z" fill="${white}"/>` +
      `<path d="M 320 200 Q 344 198 363 176 L 412 198 L 452 268 L 388 296 L 388 452 Q 354 460 320 461 Z" fill="${shade}" fill-opacity="0.07"/>` +
      `<path d="M 277 176 Q 320 208 363 176" fill="none" stroke="${shade}" stroke-opacity="0.2" stroke-width="7"/>` +
      `<path d="M 252 296 L 252 452" stroke="${shade}" stroke-opacity="0.08" stroke-width="5"/>` +
      `<circle cx="320" cy="312" r="24" fill="${accent}"/>` +
      `<circle cx="320" cy="312" r="24" fill="none" stroke="${accent2}" stroke-opacity="0.6" stroke-width="4"/>`,
    mug:
      `<path d="M 250 240 q 70 -16 140 0 l -8 176 q -62 18 -124 0 Z" fill="${white}"/>` +
      `<path d="M 320 232 q 35 1 70 8 l -8 176 q -31 9 -62 10 Z" fill="${shade}" fill-opacity="0.07"/>` +
      `<ellipse cx="320" cy="240" rx="70" ry="16" fill="#e4e1f5"/>` +
      `<ellipse cx="320" cy="240" rx="54" ry="11" fill="${accent}" fill-opacity="0.85"/>` +
      `<path d="M 392 268 q 58 6 50 62 q -7 46 -58 44" fill="none" stroke="${white}" stroke-width="20"/>` +
      `<path d="M 300 218 q 6 -22 -6 -38" fill="none" stroke="${shade}" stroke-opacity="0.22" stroke-width="7" stroke-linecap="round"/>` +
      `<path d="M 330 216 q 6 -18 -4 -32" fill="none" stroke="${shade}" stroke-opacity="0.15" stroke-width="7" stroke-linecap="round"/>`,
    notebook:
      `<rect x="225" y="185" width="200" height="270" rx="14" fill="${white}" transform="rotate(-3 325 320)"/>` +
      `<rect x="225" y="185" width="200" height="270" rx="14" fill="${shade}" fill-opacity="0.05" transform="rotate(-3 325 320)"/>` +
      `<rect x="225" y="185" width="40" height="270" rx="14" fill="${accent}" transform="rotate(-3 325 320)"/>` +
      `<rect x="380" y="240" width="34" height="90" rx="10" fill="${accent2}" fill-opacity="0.8" transform="rotate(-3 325 320)"/>` +
      Array.from({ length: 5 }, (_, row) =>
        Array.from({ length: 5 }, (_, col) => `<circle cx="${300 + col * 26}" cy="${235 + row * 42}" r="3.4" fill="${shade}" fill-opacity="0.3" transform="rotate(-3 325 320)"/>`).join(''),
      ).join(''),
    poster:
      `<rect x="228" y="150" width="190" height="290" rx="8" fill="${white}" transform="rotate(2 323 295)"/>` +
      `<rect x="252" y="184" width="142" height="74" rx="10" fill="${accent}" transform="rotate(2 323 295)"/>` +
      `<rect x="252" y="184" width="142" height="74" rx="10" fill="none" stroke="${accent2}" stroke-opacity="0.7" stroke-width="4" transform="rotate(2 323 295)"/>` +
      `<rect x="252" y="282" width="116" height="13" rx="6.5" fill="${shade}" fill-opacity="0.45" transform="rotate(2 323 295)"/>` +
      `<rect x="252" y="310" width="142" height="13" rx="6.5" fill="${shade}" fill-opacity="0.3" transform="rotate(2 323 295)"/>` +
      `<rect x="252" y="338" width="92" height="13" rx="6.5" fill="${shade}" fill-opacity="0.2" transform="rotate(2 323 295)"/>` +
      `<circle cx="372" cy="396" r="22" fill="${accent2}" fill-opacity="0.85" transform="rotate(2 323 295)"/>`,
    stickers:
      `<circle cx="262" cy="252" r="62" fill="${white}"/><circle cx="262" cy="252" r="38" fill="${accent}"/>` +
      `<path d="M 244 252 l 12 14 l 24 -28" fill="none" stroke="#ffffff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<rect x="332" y="196" width="116" height="106" rx="24" fill="${white}" transform="rotate(8 390 249)"/>` +
      `<path d="M 360 240 l 28 -38 l 28 38 l -18 0 l 0 32 l -20 0 l 0 -32 Z" fill="${accent2}" transform="rotate(8 390 249)"/>` +
      `<rect x="252" y="338" width="156" height="84" rx="42" fill="${white}" transform="rotate(-6 330 380)"/>` +
      `<circle cx="302" cy="380" r="19" fill="${accent2}" fill-opacity="0.85"/><circle cx="354" cy="376" r="19" fill="${accent}" fill-opacity="0.8"/>`,
    cap:
      `<path d="M 212 332 a 108 102 0 0 1 216 0 Z" fill="${white}"/>` +
      `<path d="M 320 230 a 108 102 0 0 1 108 102 l -108 0 Z" fill="${shade}" fill-opacity="0.07"/>` +
      `<path d="M 320 230 l 0 102" stroke="${shade}" stroke-opacity="0.15" stroke-width="5"/>` +
      `<path d="M 264 244 q 22 -16 56 -14" fill="none" stroke="${shade}" stroke-opacity="0.12" stroke-width="5"/>` +
      `<path d="M 212 332 q 108 34 216 0 l 0 24 q -108 36 -216 0 Z" fill="#e9e6f8"/>` +
      `<path d="M 424 334 q 74 -6 92 30 q -54 24 -98 6" fill="${accent}"/>` +
      `<circle cx="320" cy="288" r="19" fill="${accent}"/>` +
      `<circle cx="320" cy="288" r="19" fill="none" stroke="${accent2}" stroke-opacity="0.6" stroke-width="4"/>`,
  };
  // eslint-disable-next-line security/detect-object-injection -- item is a compile-time literal union
  const art = shapes[item] ?? '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#edebfb"/><stop offset="1" stop-color="#dcd9f2"/></linearGradient>
    <radialGradient id="lit" cx="0.5" cy="0.38" r="0.62"><stop offset="0" stop-color="#ffffff" stop-opacity="0.95"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <circle cx="${w / 2}" cy="${h * 0.42}" r="${w * 0.4}" fill="url(#lit)"/>
  <ellipse cx="${w / 2}" cy="${h * 0.77}" rx="${w * 0.27}" ry="${h * 0.035}" fill="#101024" fill-opacity="0.14"/>
  <ellipse cx="${w / 2}" cy="${h * 0.77}" rx="${w * 0.18}" ry="${h * 0.022}" fill="#101024" fill-opacity="0.12"/>
  <g transform="translate(0 10)">${art}</g>
  ${grain(w, h, 31, 260, '#101024', 0.05)}
</svg>`;
}

// ------------------------------------------------------------------ brand mark
// The Northwind corporate identity — a single cohesive "compass needle" motif drawn three ways:
// a bright app ICON (favicon), a deep-field LOGO tile (preloader + schema.org), and a 1.91:1 OG
// share card. All are pure shapes/paths (NO <text> — the trusted SVG renderer has no fonts), so the
// name is conveyed by the surrounding HTML, never baked into the art (keeps the mark editable + i18n-safe).

const BRAND = { primary: '#4f46e5', secondary: '#0ea5e9', glow: '#6366f1', deep0: '#1d1b3a', deep1: '#0a0918' };

/** The compass needle: a vertical north(bright)/south(dim) diamond on a hub, optionally inside a
 *  ticked ring. Reads as a compass at any size; the bright north point also evokes the brand "N". */
function compassMark(cx: number, cy: number, r: number, ring: boolean, tint = '#ffffff'): string {
  const w = r * 0.34; // needle half-width at the equator
  const needle =
    `<path d="M ${cx} ${cy - r} L ${cx + w} ${cy} L ${cx} ${cy + r} L ${cx - w} ${cy} Z" fill="${tint}" fill-opacity="0.42"/>` +
    `<path d="M ${cx} ${cy - r} L ${cx + w} ${cy} L ${cx - w} ${cy} Z" fill="${tint}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${(r * 0.12).toFixed(1)}" fill="${tint}"/>`;
  if (!ring) return needle;
  const rr = r * 1.5;
  const ticks = [0, 90, 180, 270]
    .map((deg) => {
      const a = (deg * Math.PI) / 180;
      const x1 = cx + Math.cos(a) * rr;
      const y1 = cy + Math.sin(a) * rr;
      const x2 = cx + Math.cos(a) * (rr - r * 0.2);
      const y2 = cy + Math.sin(a) * (rr - r * 0.2);
      return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${tint}" stroke-opacity="0.75" stroke-width="${(r * 0.07).toFixed(1)}" stroke-linecap="round"/>`;
    })
    .join('');
  return (
    `<circle cx="${cx}" cy="${cy}" r="${rr.toFixed(1)}" fill="none" stroke="${tint}" stroke-opacity="0.5" stroke-width="${(r * 0.05).toFixed(1)}"/>` +
    ticks +
    needle
  );
}

/** App icon / favicon: a full-bleed brand-gradient tile + a top-light sheen + the white needle. No
 *  ring (it must stay legible at 16px). Full-bleed so the JPEG fallback (no alpha) still reads. */
function brandIcon(w = 512, h = 512): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${BRAND.primary}"/><stop offset="1" stop-color="${BRAND.secondary}"/></linearGradient>
    <radialGradient id="hl" cx="0.32" cy="0.24" r="0.85"><stop offset="0" stop-color="#ffffff" stop-opacity="0.4"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <rect width="${w}" height="${h}" fill="url(#hl)"/>
  ${compassMark(w / 2, h / 2, h * 0.3, false)}
  ${grain(w, h, 71, 240)}
</svg>`;
}

/** Primary logo tile (preloader + schema.org): a deep brand field + a soft glow + the RINGED, ticked
 *  compass — elegant on the frosted dark preloader overlay and on any light surface alike. */
function brandLogo(w = 512, h = 512): string {
  const g = splitGlow(glow('lg', w * 0.5, h * 0.42, w * 0.52, BRAND.glow, 0.7));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${BRAND.deep0}"/><stop offset="1" stop-color="${BRAND.deep1}"/></linearGradient>
    ${g.def}
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  ${g.shape}
  ${compassMark(w / 2, h / 2, h * 0.25, true)}
  ${grain(w, h, 72, 260)}
  ${vignette(w, h, 0.32)}
</svg>`;
}

/** Open Graph / social share card (1.91:1): a deep field + twin glows + a blueprint grid, the ringed
 *  compass on the left third, and an abstract glass accent arc on the right. No text (see header). */
function brandOg(w = 1200, h = 630): string {
  const gA = splitGlow(glow('oA', w * 0.3, h * 0.28, w * 0.42, BRAND.glow, 0.8));
  const gB = splitGlow(glow('oB', w * 0.86, h * 0.85, w * 0.46, BRAND.secondary, 0.5));
  const grid =
    Array.from({ length: 11 }, (_, i) => `<line x1="${(i + 1) * (w / 12)}" y1="0" x2="${(i + 1) * (w / 12)}" y2="${h}" stroke="#ffffff" stroke-opacity="0.04" stroke-width="1"/>`).join('') +
    Array.from({ length: 5 }, (_, i) => `<line x1="0" y1="${(i + 1) * (h / 6)}" x2="${w}" y2="${(i + 1) * (h / 6)}" stroke="#ffffff" stroke-opacity="0.04" stroke-width="1"/>`).join('');
  const arc =
    `<circle cx="${w * 0.82}" cy="${h * 0.52}" r="${h * 0.34}" fill="none" stroke="#ffffff" stroke-opacity="0.16" stroke-width="2"/>` +
    `<circle cx="${w * 0.82}" cy="${h * 0.52}" r="${h * 0.22}" fill="none" stroke="${BRAND.secondary}" stroke-opacity="0.5" stroke-width="3"/>` +
    `<circle cx="${w * 0.82}" cy="${h * 0.52 - h * 0.22}" r="7" fill="#ffffff" fill-opacity="0.9"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#15132f"/><stop offset="1" stop-color="#080714"/></linearGradient><!-- a touch deeper/cooler than BRAND.deep0/1 for stronger social-card contrast -->
    ${gA.def}${gB.def}
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  ${gA.shape}${gB.shape}
  ${grid}
  ${arc}
  ${compassMark(w * 0.32, h * 0.5, h * 0.2, true)}
  ${grain(w, h, 73, 900)}
  ${vignette(w, h, 0.28)}
</svg>`;
}

// Per-client art palettes — deep fields with two glow hues, all dark-editorial.
const ART = {
  harbor: { bg0: '#2a1505', bg1: '#140a02', glowA: '#f59e0b', glowB: '#b45309', fg: '#fde8c8' },
  vela: { bg0: '#042f2e', bg1: '#021615', glowA: '#2dd4bf', glowB: '#0d9488', fg: '#ccfbf1' },
  lumen: { bg0: '#172554', bg1: '#0a102b', glowA: '#3b82f6', glowB: '#6366f1', fg: '#dbeafe' },
  terra: { bg0: '#292524', bg1: '#171412', glowA: '#a8a29e', glowB: '#d6a35c', fg: '#e7e5e4' },
  flint: { bg0: '#450a0a', bg1: '#1c0404', glowA: '#f97316', glowB: '#ef4444', fg: '#fee2d5' },
  aria: { bg0: '#3b0764', bg1: '#190230', glowA: '#ec4899', glowB: '#a855f7', fg: '#fbe8ff' },
} satisfies Record<string, ArtPalette>;

const MOTIF: Record<keyof typeof ART, Motif> = {
  harbor: 'arcs',
  vela: 'waves',
  lumen: 'chart',
  terra: 'grid',
  flint: 'embers',
  aria: 'rays',
};

interface AssetSpec {
  key: string;
  id: string;
  folder: string;
  alt: string;
  w: number;
  h: number;
  svg: string;
}

/** The 28 demo assets: 3 brand marks (logo/icon/OG), 6 project covers, 4 team portraits, hero +
 * studio art, a 4-shot Studio/ gallery (for the {{#sw-folder}} demo), 3 blog covers, and 6 MINI SHOP
 * product tiles. Exported for tests (count/folder assertions) and offline art review. */
export function exampleAssetSpecs(): AssetSpec[] {
  const proj = (key: keyof typeof ART, seed: number, alt: string): AssetSpec => ({
    key: `proj-${key}`,
    id: `ex-proj-${key}`,
    folder: 'Projects',
    alt,
    w: 1200,
    h: 840,
    // eslint-disable-next-line security/detect-object-injection -- key is a compile-time literal union
    svg: projectCover(ART[key], MOTIF[key], seed),
  });
  const team = (key: string, seed: number, a: string, b: string, deep: string): AssetSpec => ({
    key: `team-${key}`,
    id: `ex-team-${key}`,
    folder: 'Team',
    alt: 'Northwind team member',
    w: 600,
    h: 600,
    svg: avatarOrb(a, b, deep, seed),
  });
  return [
    // Brand/ — the corporate-identity marks wired into Settings → Corporate Identity (logo/icon/image).
    { key: 'brand-logo', id: 'ex-brand-logo', folder: 'Brand', alt: 'Northwind Web Studio logo', w: 512, h: 512, svg: brandLogo() },
    { key: 'brand-icon', id: 'ex-brand-icon', folder: 'Brand', alt: 'Northwind Web Studio icon', w: 512, h: 512, svg: brandIcon() },
    { key: 'brand-og', id: 'ex-brand-og', folder: 'Brand', alt: 'Northwind Web Studio — websites that mean business', w: 1200, h: 630, svg: brandOg() },
    proj('harbor', 101, 'Harbor & Co. — a flavour-led coffee storefront'),
    proj('vela', 102, 'Vela Health — a calm patient portal'),
    proj('lumen', 103, 'Lumen Capital — a data-rich finance site'),
    proj('terra', 104, 'Terra Studio — an image-first architecture portfolio'),
    proj('flint', 105, 'Flint & Steel — a hospitality site with booking'),
    proj('aria', 106, 'Aria Festival — a bold, high-energy events site'),
    team('mara', 201, '#6366f1', '#38bdf8', '#11102b'),
    team('devon', 202, '#0d9488', '#22d3ee', '#021615'),
    team('ines', 203, '#db2777', '#f59e0b', '#2a0a18'),
    team('sol', 204, '#7c3aed', '#ec4899', '#1c0833'),
    { key: 'hero', id: 'ex-hero', folder: 'Brand', alt: 'A recent Northwind website in progress', w: 1100, h: 800, svg: heroArt() },
    { key: 'studio', id: 'ex-studio', folder: 'Brand', alt: 'The Northwind studio', w: 1000, h: 750, svg: sceneDesk() },
    // Studio/ — the About page's {{#sw-folder}} gallery (alt text renders as the lightbox caption).
    { key: 'studio-desk', id: 'ex-studio-desk', folder: 'Studio', alt: 'A quiet corner of the studio', w: 1000, h: 750, svg: sceneDesk(1000, 750, 51) },
    { key: 'studio-meeting', id: 'ex-studio-meeting', folder: 'Studio', alt: 'Sketching flows at the whiteboard', w: 1000, h: 750, svg: sceneBoard() },
    { key: 'studio-wall', id: 'ex-studio-wall', folder: 'Studio', alt: 'The moodboard wall, mid-project', w: 1000, h: 750, svg: sceneWall() },
    { key: 'studio-detail', id: 'ex-studio-detail', folder: 'Studio', alt: 'Tools of the trade', w: 1000, h: 750, svg: sceneStill() },
    // Blog/ — abstract covers, one motif per article topic.
    { key: 'blog-speed', id: 'ex-blog-speed', folder: 'Blog', alt: 'Speed — abstract cover', w: 960, h: 540, svg: blogCover('speed') },
    { key: 'blog-design', id: 'ex-blog-design', folder: 'Blog', alt: 'Design systems — abstract cover', w: 960, h: 540, svg: blogCover('design') },
    { key: 'blog-seo', id: 'ex-blog-seo', folder: 'Blog', alt: 'SEO — abstract cover', w: 960, h: 540, svg: blogCover('seo') },
    // Products/ — MINI SHOP merch tiles.
    { key: 'prod-tee', id: 'ex-prod-tee', folder: 'Products', alt: 'Studio Tee', w: 640, h: 640, svg: productTile('tee') },
    { key: 'prod-mug', id: 'ex-prod-mug', folder: 'Products', alt: 'Ceramic Mug', w: 640, h: 640, svg: productTile('mug') },
    { key: 'prod-notebook', id: 'ex-prod-notebook', folder: 'Products', alt: 'Dot-grid Notebook', w: 640, h: 640, svg: productTile('notebook') },
    { key: 'prod-poster', id: 'ex-prod-poster', folder: 'Products', alt: 'Type Poster', w: 640, h: 640, svg: productTile('poster') },
    { key: 'prod-stickers', id: 'ex-prod-stickers', folder: 'Products', alt: 'Sticker Pack', w: 640, h: 640, svg: productTile('stickers') },
    { key: 'prod-cap', id: 'ex-prod-cap', folder: 'Products', alt: 'Dad Cap', w: 640, h: 640, svg: productTile('cap') },
  ];
}

/**
 * Generates the Example Project's local imagery, files it into virtual folders (Projects/, Team/,
 * Brand/), and returns a `{ key → root-relative URL }` map for the seed content to reference.
 * Each asset is rasterized from first-party SVG → optimized into real AVIF/WebP variants + a JPEG
 * fallback → recorded like a normal upload.
 */
export async function seedExampleAssets(
  ctx: ProjectContext,
  projectSlug: string,
  contentRepo: ContentRepository,
  storage: MediaStorage,
): Promise<Record<string, string>> {
  const urls: Record<string, string> = {};
  const folders = new Set<string>();
  for (const spec of exampleAssetSpecs()) {
    // Best-effort PER ASSET: a single image failing (a sharp/librsvg blip, disk hiccup) must not
    // abort the demo seed — the content seeds regardless, and the failed image just resolves to ''
    // (see exampleEntries/examplePages). On failure, drop the half-written asset dir so no empty
    // directory is orphaned and the asset id stays re-seedable.
    try {
      const png = await renderTrustedSvgToPng(spec.svg, spec.w, spec.h);
      const { assetDir, inputPath } = await storage.stageUpload(projectSlug, spec.id, png);
      try {
        const optimized = await optimizeImage(inputPath, assetDir);
        const asset: ImageAsset = {
          kind: 'image',
          id: spec.id,
          filename: `${spec.key}.png`,
          folder: spec.folder,
          alt: spec.alt,
          bytes: png.length,
          format: 'image/png',
          width: optimized.width,
          height: optimized.height,
          placeholder: optimized.placeholder,
          variants: optimized.variants.map((v) => ({ format: v.format, width: v.width, height: v.height, path: v.path })),
          fallback: optimized.fallback,
          url: `/media/${projectSlug}/${spec.id}/${optimized.fallback}`,
        };
        await contentRepo.put(ctx, 'media', spec.id, asset);
        urls[spec.key] = asset.url;
        folders.add(spec.folder);
      } finally {
        await storage.clearUpload(inputPath);
      }
    } catch {
      await storage.remove(projectSlug, spec.id).catch(() => {});
    }
  }
  // Persist the virtual folder records so the editor's media library shows them as folders.
  for (const path of folders) {
    const id = `exfolder-${path.toLowerCase()}`;
    await contentRepo.put(ctx, 'mediafolder', id, { id, path });
  }
  return urls;
}
