// The marker artwork the runtime draws for a PIN.
//
// Authored for this platform. The upstream default was a Font Awesome glyph that carried its own
// licence banner into every published page; nothing third-party ships from here.
//
// GEOMETRY MATTERS: the tip sits at the BOTTOM CENTRE of the 24×24 viewBox (12, 23), because the
// runtime anchors a pin by offsetting it a full icon-height upward (`margin-top: -icon_size`) so
// that the tip — not the centre — lands on the hotspot's coordinate.
//
// ★ The Studio draws the SAME artwork on its canvas, from `IMAGE_MAP_PIN_ICON` in @sitewright/schema.
// A bundled runtime cannot import TypeScript, so that constant is a copy; `image-map.test.ts` pins
// the two together and fails if they drift. Change one, change the other.
export const PIN_ICON_PATH =
  'M12 1a8 8 0 0 0-8 8c0 5.4 6.9 13.1 7.2 13.4a1 1 0 0 0 1.6 0C13.1 22.1 20 14.4 20 9a8 8 0 0 0-8-8zm0 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6z'

export const PIN_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${PIN_ICON_PATH}"/></svg>`
