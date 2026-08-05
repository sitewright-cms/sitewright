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

  it('marks a map the way every other region is marked', () => {
    // A region an author can act on is OUTLINED at rest and tinted on hover; a map was the one
    // clickable thing on the page with no affordance at all, so nothing said it could be opened.
    expect(PREVIEW_BRIDGE_JS).toContain("[data-sw-imagemap].sw-imap-on{cursor:pointer;outline:2px dashed #14b8a6");
    // Teal, like a dataset row: both mean "a click opens a dedicated editor", not "edit in place".
    expect(PREVIEW_BRIDGE_JS).toContain("[data-sw-entry].sw-entry-on{cursor:pointer;outline:2px dashed #14b8a6");
    // An INSET tint, not a background: the map paints its own image over the element's background.
    expect(PREVIEW_BRIDGE_JS).toContain('[data-sw-imagemap].sw-imap-on:hover{box-shadow:inset 0 0 0 9999px');
    // Applied and removed with the other content-mode affordances…
    expect(PREVIEW_BRIDGE_JS).toContain("el.classList.add('sw-imap-on')");
    expect(PREVIEW_BRIDGE_JS).toContain("el.classList.remove('sw-imap-on')");
    // …and only for a STORED map, or the outline would promise an editor that never opens.
    expect(PREVIEW_BRIDGE_JS).toMatch(/if \(on && \(el\.getAttribute\('data-sw-imagemap'\) \|\| ''\)\)/);
  });

  it('lists a map in the Regions rail, and the rail opens it', () => {
    expect(PREVIEW_BRIDGE_JS).toContain('[data-sw-control],[data-sw-entry],[data-sw-imagemap]');
    expect(PREVIEW_BRIDGE_JS).toContain("kind: 'imagemap'");
    // Locating it from the rail does what a click does.
    expect(PREVIEW_BRIDGE_JS).toMatch(/kind === 'imagemap'[\s\S]{0,120}open-imagemap/);
  });

  it('takes the click in the CAPTURE phase, ahead of the hotspot it sits on', () => {
    // A hotspot's own click follows its link. In the editor, editing the map has to win.
    const handler = PREVIEW_BRIDGE_JS.slice(PREVIEW_BRIDGE_JS.indexOf('function onImageMapClick'));
    expect(handler.slice(0, 400)).toContain('e.preventDefault()');
    expect(handler.slice(0, 400)).toContain('e.stopPropagation()');
  });
});
