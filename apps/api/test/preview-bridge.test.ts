import { describe, it, expect } from 'vitest';
import { PREVIEW_BRIDGE_JS } from '../src/http/preview-bridge.js';

/**
 * The bridge is a STRING of browser JS injected into the editor's preview iframe, so it cannot be
 * imported and called. These guard the contract the editor depends on: the messages it posts, and
 * the fact that the handlers are actually wired up (a handler defined and never registered is the
 * failure mode a source-level assertion has to rule out).
 */
describe('preview bridge — opening an image map in the Studio', () => {
  it('posts open-imagemap for a click on a stored map', () => {
    expect(PREVIEW_BRIDGE_JS).toContain("post({ type: 'open-imagemap', id: id })");
    // Resolved from the marker the render pass keeps in preview — the id IS the stored entity.
    expect(PREVIEW_BRIDGE_JS).toContain("closestAttr(e.target, 'data-sw-imagemap')");
  });

  it('registers and unregisters the handler with the other edit-mode listeners', () => {
    expect(PREVIEW_BRIDGE_JS).toContain("document.addEventListener('click', onImageMapClick, true)");
    expect(PREVIEW_BRIDGE_JS).toContain("document.removeEventListener('click', onImageMapClick, true)");
  });

  it('opens nothing when the map has no stored id (a config inlined in the page)', () => {
    // An inlined config has no entity behind it, so there is no Studio to open — the click must fall
    // through to the map's own behaviour rather than opening the wrong map or an empty editor.
    expect(PREVIEW_BRIDGE_JS).toMatch(/var id = el\.getAttribute\('data-sw-imagemap'\) \|\| '';\s*if \(!id\) return;/);
  });

  it('takes the click in the CAPTURE phase, ahead of the hotspot it sits on', () => {
    // A hotspot's own click follows its link. In the editor, editing the map has to win.
    const handler = PREVIEW_BRIDGE_JS.slice(PREVIEW_BRIDGE_JS.indexOf('function onImageMapClick'));
    expect(handler.slice(0, 400)).toContain('e.preventDefault()');
    expect(handler.slice(0, 400)).toContain('e.stopPropagation()');
  });
});
