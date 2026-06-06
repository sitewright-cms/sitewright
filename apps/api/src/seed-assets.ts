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

/** The 12 demo assets: 6 project mockups, 4 team tiles, a hero + a studio scene. */
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
      const { assetDir, inputPath } = await storage.stageUpload(ctx.projectId, spec.id, png);
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
          url: `/media/${ctx.projectId}/${spec.id}/${optimized.fallback}`,
        };
        await contentRepo.put(ctx, 'media', spec.id, asset);
        urls[spec.key] = asset.url;
        folders.add(spec.folder);
      } finally {
        await storage.clearUpload(inputPath);
      }
    } catch {
      await storage.remove(ctx.projectId, spec.id).catch(() => {});
    }
  }
  // Persist the virtual folder records so the editor's media library shows them as folders.
  for (const path of folders) {
    const id = `exfolder-${path.toLowerCase()}`;
    await contentRepo.put(ctx, 'mediafolder', id, { id, path });
  }
  return urls;
}
