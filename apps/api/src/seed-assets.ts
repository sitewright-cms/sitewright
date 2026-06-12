import { optimizeImage, renderTrustedSvgToPng } from '@sitewright/image-pipeline';
import type { ImageAsset } from '@sitewright/schema';
import type { ContentRepository } from './repo/content.js';
import type { ProjectContext } from './repo/context.js';
import type { MediaStorage } from './media/storage.js';

// ---------------------------------------------------------------------------
// Local demo imagery for the Example Project. All art is FIRST-PARTY, generated
// here as flat web-development-themed SVG illustrations (browser mockups, a code
// workspace, abstract "team" tiles) — license-free and offline, no remote URLs.
// Each SVG is rasterized (trusted-input path) → run through the real optimize
// pipeline → stored as a normal media asset, filed into virtual folders. The
// pages/datasets then reference the LOCAL `/media/...` URLs (which publish
// rewrites to `_assets/...`). Shapes only — no <text> — so rasterization never
// depends on fonts being installed in the container.
// ---------------------------------------------------------------------------

interface Palette {
  base: string; // page background
  panel: string; // card / browser body
  accent: string; // primary brand
  accent2: string; // secondary brand
  ink: string; // dark footer / strong elements
}

/** A flat "client website" shown inside a browser window — varied per palette. */
function siteMockup(p: Palette, w = 900, h = 650): string {
  const r = 18;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${p.base}"/>
  <g transform="translate(40 40)">
    <rect width="${w - 80}" height="${h - 80}" rx="${r}" fill="${p.panel}" stroke="${p.accent2}" stroke-opacity="0.25"/>
    <!-- browser chrome -->
    <rect width="${w - 80}" height="44" rx="${r}" fill="${p.accent}"/>
    <rect y="22" width="${w - 80}" height="22" fill="${p.accent}"/>
    <circle cx="26" cy="22" r="6" fill="#ffffff" fill-opacity="0.9"/>
    <circle cx="48" cy="22" r="6" fill="#ffffff" fill-opacity="0.6"/>
    <circle cx="70" cy="22" r="6" fill="#ffffff" fill-opacity="0.4"/>
    <rect x="110" y="13" width="${w - 80 - 150}" height="18" rx="9" fill="#ffffff" fill-opacity="0.85"/>
    <!-- hero band -->
    <rect x="0" y="44" width="${w - 80}" height="190" fill="${p.accent2}" fill-opacity="0.16"/>
    <rect x="48" y="96" width="300" height="22" rx="6" fill="${p.ink}" fill-opacity="0.8"/>
    <rect x="48" y="130" width="420" height="12" rx="6" fill="${p.ink}" fill-opacity="0.35"/>
    <rect x="48" y="150" width="360" height="12" rx="6" fill="${p.ink}" fill-opacity="0.35"/>
    <rect x="48" y="184" width="150" height="34" rx="17" fill="${p.accent}"/>
    <rect x="${w - 80 - 300}" y="80" width="252" height="120" rx="12" fill="${p.accent}" fill-opacity="0.85"/>
    <!-- card row -->
    ${[0, 1, 2]
      .map((i) => {
        const cw = (w - 80 - 96 - 40) / 3;
        const x = 48 + i * (cw + 20);
        return `<g transform="translate(${x} 274)">
        <rect width="${cw}" height="150" rx="12" fill="${p.base}" stroke="${p.accent2}" stroke-opacity="0.3"/>
        <rect x="16" y="16" width="40" height="40" rx="10" fill="${p.accent2}"/>
        <rect x="16" y="72" width="${cw - 60}" height="12" rx="6" fill="${p.ink}" fill-opacity="0.5"/>
        <rect x="16" y="94" width="${cw - 90}" height="10" rx="5" fill="${p.ink}" fill-opacity="0.25"/>
        <rect x="16" y="112" width="${cw - 110}" height="10" rx="5" fill="${p.ink}" fill-opacity="0.25"/>
      </g>`;
      })
      .join('')}
    <!-- footer -->
    <rect x="0" y="${h - 80 - 56}" width="${w - 80}" height="56" rx="0" fill="${p.ink}"/>
    <rect x="0" y="${h - 80 - 56}" width="${w - 80}" height="14" fill="${p.ink}"/>
  </g>
</svg>`;
}

/** A web-development workspace: a browser preview beside a code panel. */
function heroScene(p: Palette, w = 1000, h = 720): string {
  const codeLines = [0.7, 0.45, 0.6, 0.3, 0.55, 0.4, 0.65, 0.35];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${p.accent}"/><stop offset="1" stop-color="${p.accent2}"/>
  </linearGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
  <rect width="${w}" height="${h}" fill="${p.ink}" fill-opacity="0.12"/>
  <!-- code editor panel -->
  <g transform="translate(70 110)">
    <rect width="430" height="500" rx="16" fill="${p.ink}"/>
    <rect width="430" height="40" rx="16" fill="#ffffff" fill-opacity="0.08"/>
    <circle cx="24" cy="20" r="6" fill="${p.accent2}"/><circle cx="46" cy="20" r="6" fill="#ffffff" fill-opacity="0.5"/>
    ${codeLines
      .map((wd, i) => `<rect x="28" y="${70 + i * 46}" width="${Math.round(360 * wd)}" height="14" rx="7" fill="${i % 3 === 0 ? p.accent2 : '#ffffff'}" fill-opacity="${i % 3 === 0 ? 0.9 : 0.3}"/>`)
      .join('')}
  </g>
  <!-- browser preview panel -->
  <g transform="translate(540 150)">
    <rect width="390" height="430" rx="16" fill="${p.panel}"/>
    <rect width="390" height="38" rx="16" fill="${p.accent}"/>
    <circle cx="22" cy="19" r="5" fill="#ffffff" fill-opacity="0.8"/>
    <rect x="60" y="56" width="240" height="20" rx="6" fill="${p.ink}" fill-opacity="0.75"/>
    <rect x="60" y="88" width="300" height="10" rx="5" fill="${p.ink}" fill-opacity="0.3"/>
    <rect x="60" y="120" width="270" height="120" rx="12" fill="url(#g)"/>
    <rect x="60" y="260" width="130" height="120" rx="12" fill="${p.accent2}" fill-opacity="0.25"/>
    <rect x="210" y="260" width="120" height="120" rx="12" fill="${p.accent}" fill-opacity="0.25"/>
  </g>
</svg>`;
}

/** A calm studio/desk scene (monitor + plant + window). */
function studioScene(p: Palette, w = 800, h = 700): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${p.base}"/>
  <rect x="60" y="60" width="280" height="200" rx="10" fill="${p.accent2}" fill-opacity="0.18" stroke="${p.accent}" stroke-opacity="0.3"/>
  <line x1="200" y1="60" x2="200" y2="260" stroke="${p.accent}" stroke-opacity="0.25" stroke-width="4"/>
  <line x1="60" y1="160" x2="340" y2="160" stroke="${p.accent}" stroke-opacity="0.25" stroke-width="4"/>
  <!-- desk -->
  <rect x="0" y="${h - 120}" width="${w}" height="120" fill="${p.ink}" fill-opacity="0.08"/>
  <rect x="0" y="${h - 124}" width="${w}" height="8" fill="${p.accent}" fill-opacity="0.4"/>
  <!-- monitor -->
  <g transform="translate(${w / 2 - 170} ${h - 124 - 300})">
    <rect width="340" height="220" rx="14" fill="${p.ink}"/>
    <rect x="16" y="16" width="308" height="160" rx="6" fill="${p.accent}" fill-opacity="0.9"/>
    <rect x="34" y="40" width="150" height="14" rx="7" fill="#ffffff" fill-opacity="0.85"/>
    <rect x="34" y="66" width="260" height="10" rx="5" fill="#ffffff" fill-opacity="0.4"/>
    <rect x="34" y="86" width="220" height="10" rx="5" fill="#ffffff" fill-opacity="0.4"/>
    <rect x="34" y="118" width="90" height="26" rx="13" fill="${p.accent2}"/>
    <rect x="150" y="220" width="40" height="40" fill="${p.ink}"/>
    <rect x="110" y="258" width="120" height="14" rx="7" fill="${p.ink}"/>
  </g>
  <!-- plant -->
  <g transform="translate(${w - 150} ${h - 124 - 150})">
    <rect x="20" y="100" width="60" height="50" rx="8" fill="${p.accent}" fill-opacity="0.5"/>
    <ellipse cx="50" cy="70" rx="44" ry="60" fill="${p.accent2}" fill-opacity="0.7"/>
    <ellipse cx="24" cy="86" rx="24" ry="40" fill="${p.accent2}" fill-opacity="0.5"/>
    <ellipse cx="76" cy="86" rx="24" ry="40" fill="${p.accent2}" fill-opacity="0.5"/>
  </g>
</svg>`;
}

/** An abstract "team" tile: a soft gradient with a simple person silhouette. */
function avatarTile(a: string, b: string, w = 480, h = 480): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/>
  </linearGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#a)"/>
  <circle cx="${w / 2}" cy="${h * 0.4}" r="${w * 0.16}" fill="#ffffff" fill-opacity="0.92"/>
  <path d="M ${w / 2 - w * 0.27} ${h} a ${w * 0.27} ${w * 0.30} 0 0 1 ${w * 0.54} 0 Z" fill="#ffffff" fill-opacity="0.92"/>
</svg>`;
}

/** A whiteboard/meeting scene: a board with sketch shapes, two chairs, a side table. */
function meetingScene(p: Palette, w = 800, h = 600): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${p.base}"/>
  <rect x="${w / 2 - 240}" y="60" width="480" height="300" rx="14" fill="#ffffff" stroke="${p.ink}" stroke-opacity="0.15" stroke-width="3"/>
  <rect x="${w / 2 - 200}" y="100" width="180" height="16" rx="8" fill="${p.accent}" fill-opacity="0.8"/>
  <rect x="${w / 2 - 200}" y="136" width="240" height="10" rx="5" fill="${p.ink}" fill-opacity="0.3"/>
  <rect x="${w / 2 - 200}" y="156" width="210" height="10" rx="5" fill="${p.ink}" fill-opacity="0.3"/>
  <circle cx="${w / 2 + 120}" cy="160" r="48" fill="${p.accent2}" fill-opacity="0.4"/>
  <path d="M ${w / 2 + 96} 172 l 18 -26 l 14 14 l 22 -30" stroke="${p.accent}" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="${w / 2 - 200}" y="220" width="120" height="90" rx="10" fill="${p.accent2}" fill-opacity="0.25"/>
  <rect x="${w / 2 - 60}" y="220" width="120" height="90" rx="10" fill="${p.accent}" fill-opacity="0.2"/>
  <rect x="0" y="${h - 90}" width="${w}" height="90" fill="${p.ink}" fill-opacity="0.08"/>
  <rect x="${w / 2 - 300}" y="${h - 200}" width="90" height="110" rx="12" fill="${p.accent}" fill-opacity="0.55"/>
  <rect x="${w / 2 + 210}" y="${h - 200}" width="90" height="110" rx="12" fill="${p.accent2}" fill-opacity="0.55"/>
</svg>`;
}

/** A moodboard wall: pinned swatches and type cards in the brand palette. */
function moodboardScene(p: Palette, w = 800, h = 600): string {
  const cards = [
    { x: 70, y: 70, w: 180, h: 130, f: p.accent, o: 0.85 },
    { x: 280, y: 90, w: 140, h: 180, f: p.accent2, o: 0.7 },
    { x: 450, y: 60, w: 200, h: 120, f: p.ink, o: 0.8 },
    { x: 90, y: 240, w: 150, h: 170, f: p.accent2, o: 0.35 },
    { x: 300, y: 300, w: 200, h: 130, f: p.accent, o: 0.4 },
    { x: 530, y: 220, w: 160, h: 200, f: p.accent, o: 0.6 },
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${p.base}"/>
  ${cards
    .map(
      (c) =>
        `<g><rect x="${c.x + 5}" y="${c.y + 7}" width="${c.w}" height="${c.h}" rx="10" fill="${p.ink}" fill-opacity="0.12"/>` +
        `<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="10" fill="${c.f}" fill-opacity="${c.o}"/>` +
        `<circle cx="${c.x + c.w / 2}" cy="${c.y}" r="6" fill="${p.ink}" fill-opacity="0.5"/></g>`,
    )
    .join('')}
  <rect x="120" y="470" width="${w - 240}" height="14" rx="7" fill="${p.ink}" fill-opacity="0.25"/>
</svg>`;
}

/** A close-up desk still life: keyboard, notebook, coffee — flat shapes. */
function deskDetailScene(p: Palette, w = 800, h = 600): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${p.panel}"/>
  <rect width="${w}" height="${h}" fill="${p.accent2}" fill-opacity="0.08"/>
  <g transform="translate(80 120) rotate(-4)">
    <rect width="380" height="150" rx="14" fill="${p.ink}"/>
    ${Array.from({ length: 4 }, (_, r) => Array.from({ length: 10 }, (_, c) => `<rect x="${16 + c * 35}" y="${16 + r * 33}" width="28" height="26" rx="6" fill="#ffffff" fill-opacity="0.14"/>`).join('')).join('')}
  </g>
  <g transform="translate(520 100) rotate(6)">
    <rect width="190" height="250" rx="10" fill="#ffffff" stroke="${p.accent}" stroke-opacity="0.4" stroke-width="3"/>
    <line x1="24" y1="52" x2="166" y2="52" stroke="${p.ink}" stroke-opacity="0.3" stroke-width="6" stroke-linecap="round"/>
    <line x1="24" y1="92" x2="150" y2="92" stroke="${p.ink}" stroke-opacity="0.2" stroke-width="6" stroke-linecap="round"/>
    <line x1="24" y1="132" x2="160" y2="132" stroke="${p.ink}" stroke-opacity="0.2" stroke-width="6" stroke-linecap="round"/>
    <circle cx="60" cy="195" r="22" fill="${p.accent}" fill-opacity="0.7"/>
  </g>
  <g transform="translate(330 380)">
    <ellipse cx="70" cy="120" rx="78" ry="14" fill="${p.ink}" fill-opacity="0.12"/>
    <rect x="20" y="20" width="100" height="100" rx="14" fill="${p.accent}"/>
    <path d="M 120 45 q 44 8 0 52" stroke="${p.accent}" stroke-width="12" fill="none"/>
    <ellipse cx="70" cy="22" rx="50" ry="12" fill="${p.ink}" fill-opacity="0.5"/>
  </g>
</svg>`;
}

/** An abstract blog cover: brand gradient + a per-topic geometric motif (shapes only). */
function blogCover(p: Palette, motif: 'speed' | 'design' | 'seo', w = 960, h = 540): string {
  let art = '';
  if (motif === 'speed') {
    art = [0, 1, 2]
      .map((i) => `<path d="M ${220 + i * 160} 160 l 120 110 l -120 110" stroke="#ffffff" stroke-opacity="${0.9 - i * 0.25}" stroke-width="34" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`)
      .join('');
  } else if (motif === 'design') {
    art = [0, 1, 2]
      .map((r) => [0, 1, 2, 3].map((c) => `<rect x="${280 + c * 110}" y="${120 + r * 110}" width="86" height="86" rx="${(r + c) % 2 ? 43 : 14}" fill="#ffffff" fill-opacity="${0.25 + ((r + c) % 3) * 0.25}"/>`).join(''))
      .join('');
  } else {
    art =
      `<circle cx="430" cy="250" r="110" fill="none" stroke="#ffffff" stroke-opacity="0.9" stroke-width="26"/>` +
      `<line x1="515" y1="335" x2="640" y2="455" stroke="#ffffff" stroke-opacity="0.9" stroke-width="30" stroke-linecap="round"/>` +
      [0, 1, 2].map((i) => `<rect x="${360 + i * 50}" y="${290 - i * 55}" width="32" height="${55 + i * 55}" rx="8" fill="#ffffff" fill-opacity="0.65"/>`).join('');
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${p.accent}"/><stop offset="1" stop-color="${p.accent2}"/>
  </linearGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <rect width="${w}" height="${h}" fill="${p.ink}" fill-opacity="0.15"/>
  ${art}
</svg>`;
}

/** A flat product tile for the MINI SHOP: soft backdrop + a simple merch silhouette. */
function productTile(p: Palette, item: 'tee' | 'mug' | 'notebook' | 'poster' | 'stickers' | 'cap', w = 640, h = 640): string {
  const white = '#ffffff';
  const shapes: Record<string, string> = {
    tee:
      `<path d="M 200 200 l 80 -50 q 40 26 80 0 l 80 50 l -36 70 l -34 -18 l 0 168 l -100 0 l 0 -168 l -34 18 Z" fill="${white}"/>` +
      `<circle cx="320" cy="300" r="26" fill="${p.accent}" fill-opacity="0.85"/>`,
    mug:
      `<rect x="220" y="210" width="170" height="200" rx="20" fill="${white}"/>` +
      `<path d="M 390 250 q 70 10 0 110" stroke="${white}" stroke-width="26" fill="none"/>` +
      `<rect x="250" y="250" width="110" height="16" rx="8" fill="${p.accent}" fill-opacity="0.8"/>`,
    notebook:
      `<rect x="210" y="180" width="220" height="280" rx="14" fill="${white}"/>` +
      `<rect x="210" y="180" width="36" height="280" rx="14" fill="${p.accent}" fill-opacity="0.85"/>` +
      Array.from({ length: 5 }, (_, r) => Array.from({ length: 6 }, (_, c) => `<circle cx="${280 + c * 26}" cy="${230 + r * 40}" r="3.5" fill="${p.ink}" fill-opacity="0.35"/>`).join('')).join(''),
    poster:
      `<rect x="220" y="150" width="200" height="300" rx="6" fill="${white}"/>` +
      `<rect x="246" y="190" width="148" height="60" rx="8" fill="${p.accent}" fill-opacity="0.85"/>` +
      `<rect x="246" y="270" width="120" height="14" rx="7" fill="${p.ink}" fill-opacity="0.4"/>` +
      `<rect x="246" y="300" width="148" height="14" rx="7" fill="${p.ink}" fill-opacity="0.3"/>` +
      `<rect x="246" y="330" width="96" height="14" rx="7" fill="${p.ink}" fill-opacity="0.2"/>`,
    stickers:
      `<circle cx="260" cy="250" r="60" fill="${white}"/><circle cx="260" cy="250" r="34" fill="${p.accent}" fill-opacity="0.85"/>` +
      `<rect x="330" y="200" width="110" height="100" rx="22" fill="${white}" transform="rotate(8 385 250)"/>` +
      `<path d="M 350 230 l 24 -34 l 24 34 l -16 0 l 0 30 l -16 0 l 0 -30 Z" fill="${p.accent2}" transform="rotate(8 385 250)"/>` +
      `<rect x="250" y="340" width="150" height="80" rx="40" fill="${white}" transform="rotate(-6 325 380)"/>` +
      `<circle cx="300" cy="380" r="18" fill="${p.accent2}" fill-opacity="0.8"/><circle cx="350" cy="378" r="18" fill="${p.accent}" fill-opacity="0.7"/>`,
    cap:
      `<path d="M 210 330 a 110 105 0 0 1 220 0 Z" fill="${white}"/>` +
      `<path d="M 210 330 q 110 36 220 0 l 0 22 q -110 38 -220 0 Z" fill="${white}" fill-opacity="0.85"/>` +
      `<path d="M 425 330 q 70 -4 86 28 q -50 22 -92 6" fill="${p.accent}" fill-opacity="0.8"/>` +
      `<circle cx="320" cy="280" r="20" fill="${p.accent}" fill-opacity="0.85"/>`,
  };
  // eslint-disable-next-line security/detect-object-injection -- item is a compile-time literal union
  const art = shapes[item] ?? '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${p.base}"/>
  <circle cx="${w / 2}" cy="${h / 2}" r="225" fill="${p.accent2}" fill-opacity="0.16"/>
  <g transform="translate(0 10)">${art}</g>
</svg>`;
}

// Brand palettes — one per demo client, plus the studio's own indigo→sky.
const BRAND: Palette = { base: '#eef2ff', panel: '#ffffff', accent: '#4f46e5', accent2: '#0ea5e9', ink: '#1e1b4b' };
const P = {
  harbor: { base: '#faf7f2', panel: '#fffdf8', accent: '#b45309', accent2: '#f59e0b', ink: '#44403c' },
  vela: { base: '#f0fdfa', panel: '#ffffff', accent: '#0d9488', accent2: '#2dd4bf', ink: '#134e4a' },
  lumen: { base: '#f8fafc', panel: '#ffffff', accent: '#1e3a8a', accent2: '#3b82f6', ink: '#0f172a' },
  terra: { base: '#fafaf9', panel: '#ffffff', accent: '#57534e', accent2: '#a8a29e', ink: '#292524' },
  flint: { base: '#fef2f2', panel: '#fffafa', accent: '#b91c1c', accent2: '#f97316', ink: '#450a0a' },
  aria: { base: '#faf5ff', panel: '#ffffff', accent: '#7e22ce', accent2: '#ec4899', ink: '#3b0764' },
} satisfies Record<string, Palette>;

interface AssetSpec {
  key: string;
  id: string;
  folder: string;
  alt: string;
  w: number;
  h: number;
  svg: string;
}

/** The 25 demo assets: 6 project mockups, 4 team tiles, hero + studio scenes, a 4-shot Studio/
 * gallery (for the {{#sw-folder}} demo), 3 blog covers, and 6 MINI SHOP product tiles. */
function specs(): AssetSpec[] {
  const proj = (key: keyof typeof P, alt: string): AssetSpec => ({
    key: `proj-${key}`,
    id: `ex-proj-${key}`,
    folder: 'Projects',
    alt,
    w: 900,
    h: 650,
    svg: siteMockup(Reflect.get(P, key) as Palette),
  });
  const team = (key: string, a: string, b: string): AssetSpec => ({
    key: `team-${key}`,
    id: `ex-team-${key}`,
    folder: 'Team',
    alt: 'Northwind team member',
    w: 480,
    h: 480,
    svg: avatarTile(a, b),
  });
  return [
    proj('harbor', 'Harbor & Co. — a flavour-led coffee storefront'),
    proj('vela', 'Vela Health — a calm patient portal'),
    proj('lumen', 'Lumen Capital — a data-rich finance site'),
    proj('terra', 'Terra Studio — an image-first architecture portfolio'),
    proj('flint', 'Flint & Steel — a hospitality site with booking'),
    proj('aria', 'Aria Festival — a bold, high-energy events site'),
    team('mara', '#6366f1', '#0ea5e9'),
    team('devon', '#0d9488', '#22d3ee'),
    team('ines', '#db2777', '#f59e0b'),
    team('sol', '#7c3aed', '#ec4899'),
    { key: 'hero', id: 'ex-hero', folder: 'Brand', alt: 'A recent Northwind website in progress', w: 1000, h: 720, svg: heroScene(BRAND) },
    { key: 'studio', id: 'ex-studio', folder: 'Brand', alt: 'The Northwind studio', w: 800, h: 700, svg: studioScene(BRAND) },
    // Studio/ — the About page's {{#sw-folder}} gallery (alt text renders as the lightbox caption).
    { key: 'studio-desk', id: 'ex-studio-desk', folder: 'Studio', alt: 'A quiet corner of the studio', w: 800, h: 700, svg: studioScene(BRAND) },
    { key: 'studio-meeting', id: 'ex-studio-meeting', folder: 'Studio', alt: 'Sketching flows at the whiteboard', w: 800, h: 600, svg: meetingScene(BRAND) },
    { key: 'studio-wall', id: 'ex-studio-wall', folder: 'Studio', alt: 'The moodboard wall, mid-project', w: 800, h: 600, svg: moodboardScene(BRAND) },
    { key: 'studio-detail', id: 'ex-studio-detail', folder: 'Studio', alt: 'Tools of the trade', w: 800, h: 600, svg: deskDetailScene(BRAND) },
    // Blog/ — abstract covers, one motif per article topic.
    { key: 'blog-speed', id: 'ex-blog-speed', folder: 'Blog', alt: 'Speed — abstract cover', w: 960, h: 540, svg: blogCover(BRAND, 'speed') },
    { key: 'blog-design', id: 'ex-blog-design', folder: 'Blog', alt: 'Design systems — abstract cover', w: 960, h: 540, svg: blogCover(BRAND, 'design') },
    { key: 'blog-seo', id: 'ex-blog-seo', folder: 'Blog', alt: 'SEO — abstract cover', w: 960, h: 540, svg: blogCover(BRAND, 'seo') },
    // Products/ — MINI SHOP merch tiles.
    { key: 'prod-tee', id: 'ex-prod-tee', folder: 'Products', alt: 'Studio Tee', w: 640, h: 640, svg: productTile(BRAND, 'tee') },
    { key: 'prod-mug', id: 'ex-prod-mug', folder: 'Products', alt: 'Ceramic Mug', w: 640, h: 640, svg: productTile(BRAND, 'mug') },
    { key: 'prod-notebook', id: 'ex-prod-notebook', folder: 'Products', alt: 'Dot-grid Notebook', w: 640, h: 640, svg: productTile(BRAND, 'notebook') },
    { key: 'prod-poster', id: 'ex-prod-poster', folder: 'Products', alt: 'Type Poster', w: 640, h: 640, svg: productTile(BRAND, 'poster') },
    { key: 'prod-stickers', id: 'ex-prod-stickers', folder: 'Products', alt: 'Sticker Pack', w: 640, h: 640, svg: productTile(BRAND, 'stickers') },
    { key: 'prod-cap', id: 'ex-prod-cap', folder: 'Products', alt: 'Dad Cap', w: 640, h: 640, svg: productTile(BRAND, 'cap') },
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
  for (const spec of specs()) {
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
