// Builds the proposed `sc_floorplan` image map config, validates it against the real ImageMapSchema,
// and renders it through the real embed + runtime into a standalone HTML file for a local screenshot.
//   node imagemap.mjs   → writes ../sc-assets/sc_floorplan.json and ../sc-assets/imagemap-harness.html
import { writeFileSync } from 'node:fs';
import { ImageMapSchema } from '/workspace/sitewright/packages/schema/dist/image-map.js';
import { renderImageMapMarkup } from '/workspace/sitewright/packages/blocks/dist/image-map-embed.js';
import { componentAssets } from '/workspace/sitewright/packages/blocks/dist/components.js';

const OUT = '/tmp/claude-1000/-workspace-sitewright/ec7958e0-e951-4975-95e7-a51a6bdd4286/scratchpad/sc-assets';
const INK = '#4F2DD8';
const TEAL = '#14B8A6';

const room = (id, title, x, y, w, h, body, color = INK) => ({
  id,
  title,
  type: 'rect',
  x, y, width: w, height: h,
  default_style: { background_color: color, background_opacity: 0.1, border_radius: 10, border_width: 2, border_color: color, border_opacity: 0.55 },
  mouseover_style: { background_color: color, background_opacity: 0.32, border_radius: 10, border_width: 2, border_color: color, border_opacity: 1 },
  tooltip_style: { background_color: '#0F172A', border_radius: 12, padding: 12, width: 240, auto_width: false },
  tooltip_content: [
    { type: 'Heading', text: title, style: { fontFamily: 'inherit', fontSize: 17, lineHeight: 'normal', color: '#ffffff', textAlign: 'left' } },
    { type: 'Paragraph', text: body, style: { fontFamily: 'inherit', fontSize: 14, lineHeight: 21, color: '#E2E8F0', textAlign: 'left' } },
  ],
});
const label = (id, text, x, y) => ({
  id, title: `${text} (label)`, type: 'text', static: true, x, y,
  text: { text, font_family: 'inherit', font_size: 15, font_weight: 600, text_color: '#0F172A', text_opacity: 0.85 },
  tooltip: { enable_tooltip: false },
});

const config = {
  id: 'sc_floorplan',
  general: { name: 'Studio floor plan', width: 1000, height: 600, ui_theme: 'light' },
  tooltips: { enable_tooltips: true, show_tooltips: 'mouseover', tooltip_animation: 'fade-up' },
  zooming: { enable_zooming: false },
  object_list: { enable_object_list: false },
  artboards: [
    {
      id: 'ground',
      title: 'Ground floor',
      background_type: 'color',
      background_color: '#F8FAFC',
      width: 1000,
      height: 600,
      children: [
        room('studio-a', 'Studio A', 3, 4, 44, 52, 'Twelve desks, north light, two screens per desk.'),
        room('studio-b', 'Studio B', 50, 4, 47, 52, 'The quiet room. Headphones on, notifications off.'),
        room('reception', 'Reception', 3, 60, 28, 36, 'Visitors sign in here. Parcels too.', TEAL),
        room('kitchen', 'Kitchen', 34, 60, 30, 36, 'Coffee, a long table and the lunch rota.', TEAL),
        room('meeting', 'Meeting room', 67, 60, 30, 36, 'Seats eight, with a screen and a whiteboard wall.'),
        label('l-studio-a', 'Studio A', 25, 30),
        label('l-studio-b', 'Studio B', 73.5, 30),
        label('l-reception', 'Reception', 17, 78),
        label('l-kitchen', 'Kitchen', 49, 78),
        label('l-meeting', 'Meeting room', 82, 78),
      ],
    },
    {
      id: 'first',
      title: 'First floor',
      background_type: 'color',
      background_color: '#F8FAFC',
      width: 1000,
      height: 600,
      children: [
        room('library', 'Library', 3, 4, 56, 44, 'Books, two sofas and the printer.'),
        room('booths', 'Phone booths', 62, 4, 35, 44, 'Four booths for calls. First come, first served.', TEAL),
        room('terrace', 'Roof terrace', 3, 52, 94, 44, 'Open from May to September.', TEAL),
        label('l-library', 'Library', 31, 26),
        label('l-booths', 'Phone booths', 79.5, 26),
        label('l-terrace', 'Roof terrace', 50, 74),
      ],
    },
  ],
};

const parsed = ImageMapSchema.safeParse(config);
if (!parsed.success) {
  console.error(JSON.stringify(parsed.error.issues, null, 2));
  process.exit(1);
}
writeFileSync(`${OUT}/sc_floorplan.json`, JSON.stringify(config, null, 2));
const markup = renderImageMapMarkup({ id: config.id, config: parsed.data });
const { css, js } = componentAssets(['ImageMap']);
const triggers = ['Studio A', 'Studio B', 'Reception', 'Kitchen', 'Meeting room']
  .map((t) => `<li data-sw-imap-trigger-object-on-mouseover="${t}" style="cursor:pointer;padding:6px">${t}</li>`)
  .join('');
writeFileSync(
  `${OUT}/imagemap-harness.html`,
  `<!doctype html><html><head><meta charset="utf-8"><style>${css}body{font-family:Inter,system-ui,sans-serif;margin:24px;width:1100px}</style></head>
<body><div style="display:grid;grid-template-columns:3fr 1fr;gap:16px"><div>${markup}</div><ul>${triggers}<li data-sw-imap-change-artboard="First floor" style="cursor:pointer;padding:6px">→ First floor</li></ul></div><script>${js}</script></body></html>`,
);
console.log('ok', markup.length, 'chars of markup');
