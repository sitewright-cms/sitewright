// A curated subset of Lucide icons (ISC license — https://lucide.dev), inlined
// as SVG so only the used icons ship — no icon-font download (Lighthouse-optimal),
// framework-free, license-clean. Each value is the inner markup of a 24x24,
// stroke-based (`currentColor`) icon; the Icon block wraps it in an <svg>.
//
// NOTE: Lucide intentionally excludes brand logos (trademarks), so social-media
// icons need a separate set (e.g. simple-icons) — a follow-up. Extend ICONS to
// add more built-ins, or wire an opt-in full set later.
const ICONS = new Map<string, string>([
  ['menu', '<line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="18" y2="18"/>'],
  ['x', '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'],
  ['search', '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'],
  ['chevron-down', '<path d="m6 9 6 6 6-6"/>'],
  ['chevron-up', '<path d="m18 15-6-6-6 6"/>'],
  ['chevron-left', '<path d="m15 18-6-6 6-6"/>'],
  ['chevron-right', '<path d="m9 18 6-6-6-6"/>'],
  ['arrow-right', '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>'],
  ['arrow-left', '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>'],
  ['arrow-up-right', '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>'],
  ['check', '<path d="M20 6 9 17l-5-5"/>'],
  ['mail', '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>'],
  ['phone', '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>'],
  ['map-pin', '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>'],
  ['external-link', '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'],
  ['calendar', '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>'],
  ['clock', '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'],
  ['star', '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>'],
]);

/** Names of the built-in icons (for the editor's icon picker). */
export const ICON_NAMES: readonly string[] = [...ICONS.keys()];

/** Inner SVG markup for a built-in icon, or `undefined` if the name is unknown. */
export function iconBody(name: string): string | undefined {
  return ICONS.get(name);
}
