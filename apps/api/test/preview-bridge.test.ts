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

describe('preview bridge — a chrome slot is edited in the SKELETON editor, not on a page', () => {
  it('gates every editable leaf on inForeignSlot, alongside the dataset-row gate it mirrors', () => {
    // A slot's stores are SHARED (website.translations / website.data), so the same string is
    // reachable from every page. Editing it from a page would read as a page-local change while
    // silently rewriting the whole site — so the leaf is wired only where its slot is focused.
    for (const guard of [
      "eachEl('[data-sw-text]', function (el) {",
      "eachEl('[data-sw-translate]', function (el) {",
      "eachEl('[data-sw-html]', function (el) {",
      "eachEl('[data-sw-href]', function (el) {",
      "eachEl('[data-sw-src],[data-sw-bg]', function (el) {",
    ]) {
      expect(PREVIEW_BRIDGE_JS).toContain(guard);
    }
    // five wirings, each returning early for a foreign slot
    expect(PREVIEW_BRIDGE_JS.match(/inForeignSlot\(el\)/g)?.length).toBe(5);
  });

  it('treats every landmark as foreign when no slot is focused (i.e. on a page)', () => {
    // slotFocus '' → slotElementId('') is '' → no landmark id can match, so every slot leaf is skipped.
    expect(PREVIEW_BRIDGE_JS).toContain("if (land.id !== slotElementId(slotFocus)) return true;");
  });

  it('inside the FOCUSED slot, offers only keys that can actually persist', () => {
    // A slot has no page.data, so a BARE data-sw-text/html/src key there resolves to nothing and the
    // edit evaporates on save — the exact dead-directive bug this rule exists to prevent. Only the
    // translation catalog and an explicit website.data.<path> key have a store behind them.
    expect(PREVIEW_BRIDGE_JS).toContain("if (el.hasAttribute('data-sw-translate')) return false;");
    expect(PREVIEW_BRIDGE_JS).toContain("if (v && v.indexOf('website.data.') === 0) return false;");
  });

  it('re-wires when the focus changes, so a newly focused slot is live immediately', () => {
    // Which leaves are editable depends on slotFocus, so a focus change inside content mode has to
    // re-run setEditing — otherwise the slot just opened stays inert until the mode is toggled.
    expect(PREVIEW_BRIDGE_JS).toContain('if (changed && editing) { setEditing(false); setEditing(true); }');
  });

  it('shares ONE landmark selector between focus handling and the gate', () => {
    // Two copies would drift: a slot added to one list and not the other becomes editable from a page.
    expect(PREVIEW_BRIDGE_JS).toContain("var SLOT_SEL = '#main-nav, #sidebar-left, #sidebar-right, #footer, #bottom';");
    expect(PREVIEW_BRIDGE_JS.match(/#main-nav, #sidebar-left, #sidebar-right, #footer, #bottom/g)?.length).toBe(1);
  });
});

describe('preview bridge — clicking an embedded form opens its definition', () => {
  it('posts open-form with the referenced id', () => {
    // `data-sw-form` is kept in preview and stripped on publish, so the id is on the element already.
    expect(PREVIEW_BRIDGE_JS).toContain("post({ type: 'open-form', id: id })");
    expect(PREVIEW_BRIDGE_JS).toContain("closestAttr(e.target, 'data-sw-form')");
  });

  it('cancels the native click so the editor never submits the form it is editing', () => {
    expect(PREVIEW_BRIDGE_JS).toMatch(/function onFormClick\(e\) \{[\s\S]*?e\.preventDefault\(\);\s*e\.stopPropagation\(\);/);
    // capture phase, like the entry/imagemap handlers, so it beats a field focusing instead
    expect(PREVIEW_BRIDGE_JS).toContain("document.addEventListener('click', onFormClick, true)");
    expect(PREVIEW_BRIDGE_JS).toContain("document.removeEventListener('click', onFormClick, true)");
  });

  it('does nothing in source mode, or for a form with no id', () => {
    expect(PREVIEW_BRIDGE_JS).toMatch(/function onFormClick\(e\) \{\s*if \(!editing\) return;/);
    expect(PREVIEW_BRIDGE_JS).toMatch(/var id = el\.getAttribute\('data-sw-form'\) \|\| '';\s*if \(!id\) return;/);
  });

  it('marks a form the way every other actionable region is marked', () => {
    expect(PREVIEW_BRIDGE_JS).toContain("[data-sw-form].sw-form-on{cursor:pointer");
    expect(PREVIEW_BRIDGE_JS).toContain("el.classList.add('sw-form-on')");
  });

  it('stays clickable inside a chrome slot — a form definition is NOT slot-scoped', () => {
    // Translations and website.data are gated on slot focus because they are shared STRINGS edited in
    // the skeleton editor. A form is a project ENTITY: the same definition wherever it is embedded, so
    // the foreign-slot gate must not apply to it.
    const marking = PREVIEW_BRIDGE_JS.slice(PREVIEW_BRIDGE_JS.indexOf("eachEl('[data-sw-form]'"));
    expect(marking.slice(0, 220)).not.toContain('inForeignSlot');
  });
});
