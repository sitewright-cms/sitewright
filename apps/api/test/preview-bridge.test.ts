import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
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
    // A region an author can act on is boxed at rest and tinted on hover — in the OVERLAY (see the
    // "never restyles the page" suite below). A map was the one clickable thing on the page with no
    // affordance at all, so nothing said it could be opened.
    expect(PREVIEW_BRIDGE_JS).toContain('[data-sw-imagemap].sw-imap-on,[data-sw-form].sw-form-on{cursor:pointer}');
    // Applied and removed with the other content-mode affordances…
    expect(PREVIEW_BRIDGE_JS).toContain("el.classList.add('sw-imap-on')");
    expect(PREVIEW_BRIDGE_JS).toContain("el.classList.remove('sw-imap-on')");
    // …and only for a STORED map, or the marker would promise an editor that never opens.
    expect(PREVIEW_BRIDGE_JS).toMatch(/if \(on && \(el\.getAttribute\('data-sw-imagemap'\) \|\| ''\)\) \{ el\.classList\.add\('sw-imap-on'\)/);
    // …and it joins the at-rest layer, in the teal a dataset row uses ("a click opens an editor").
    expect(PREVIEW_BRIDGE_JS).toContain("restPush(el, 'entry')");
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
    expect(PREVIEW_BRIDGE_JS).toContain('[data-sw-imagemap].sw-imap-on,[data-sw-form].sw-form-on{cursor:pointer}');
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

describe('preview bridge — the affordances never restyle the page', () => {
  /**
   * ★ THE INVARIANT: an editable region is MARKED, not MODIFIED.
   *
   * The affordances used to be CSS on the host — a dashed outline, a 2px border-radius, a hover
   * background, an inset box-shadow. Each of those overwrote a property the site had authored, so
   * turning on content mode changed what the page LOOKED like: rounded cards went square, a hover
   * blanked a coloured card's background to a pale wash, and on an image-backed element the tint was
   * invisible (which is why images had already been forced onto an inset shadow — which in turn
   * replaced whatever shadow they were designed with). Everything now paints in a fixed overlay.
   *
   * The check is structural rather than a list of remembered rules: pull every selector in the
   * injected stylesheet that targets a HOST element (a data-sw-* attribute or an on-state class) and
   * assert its declaration block sets nothing but `cursor`. A new affordance written the old way
   * fails here, whatever it is called.
   */
  const HOST_SELECTOR = /(\[data-sw-|\.sw-(edit|tr|link|img|entry|imap|form)-on)/;
  /** Editor-OWNED markup, stripped before publish — styling those is not restyling the page. */
  const EDITOR_OWNED = /\.sw-(ov|tb|pop|rz|slot|control-on|flash)/;

  /** Every `selector{decls}` pair in the bridge's stylesheet strings. */
  function rules(): { sel: string; decls: string }[] {
    const out: { sel: string; decls: string }[] = [];
    for (const m of PREVIEW_BRIDGE_JS.matchAll(/'([^']*?\{[^']*?\})'/g)) {
      for (const r of (m[1] ?? '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        out.push({ sel: (r[1] ?? '').trim(), decls: (r[2] ?? '').trim() });
      }
    }
    return out;
  }

  it('sets NOTHING but cursor on an element the page owns', () => {
    const hostRules = rules().filter((r) => HOST_SELECTOR.test(r.sel) && !EDITOR_OWNED.test(r.sel));
    expect(hostRules.length, 'the host rules should still exist — this test would pass vacuously').toBeGreaterThan(0);
    for (const r of hostRules) {
      const props = r.decls
        .split(';')
        .map((d) => d.split(':')[0]?.trim())
        .filter((p): p is string => !!p);
      // `display:none` on [data-sw-control] is the one exception, and it is not the page's element:
      // the control chip is editor-only markup that publish removes entirely.
      const allowed = r.sel.includes('data-sw-control') ? ['cursor', 'display'] : ['cursor'];
      expect(props.filter((prop) => !allowed.includes(prop)), `${r.sel} { ${r.decls} }`).toEqual([]);
    }
  });

  it('paints the at-rest marker, the hover tint and the locate flash in the OVERLAY', () => {
    // A fixed, pointer-events:none layer over the document — so a tint COMPOSITES over whatever the
    // element paints (a photo, a gradient, a video) instead of replacing its background.
    expect(PREVIEW_BRIDGE_JS).toContain('.sw-ov-rest{position:fixed;inset:0;pointer-events:none');
    expect(PREVIEW_BRIDGE_JS).toContain('.sw-ov-r{position:fixed;box-sizing:border-box;border:2px dashed #6366f1');
    expect(PREVIEW_BRIDGE_JS).toContain('.sw-ov-fill{position:fixed;pointer-events:none');
    expect(PREVIEW_BRIDGE_JS).toContain('.sw-ov-flash{position:fixed;pointer-events:none');
    // …and the focused slot's ring, for the same reason: a landmark is a real element with real styling.
    expect(PREVIEW_BRIDGE_JS).toContain('.sw-slot-ring{position:fixed;pointer-events:none');
  });

  it('the at-rest layer is built from what setEditing ACTUALLY wired, and cleared with it', () => {
    // Not from a querySelectorAll of every data-sw-* on the page: a leaf inside a dataset row, or a
    // chrome slot's shared string viewed from a page, is deliberately NOT editable here. Marking those
    // would advertise an edit that does not exist.
    expect(PREVIEW_BRIDGE_JS).toContain("restPush(el, 'text')");
    expect(PREVIEW_BRIDGE_JS).toContain("restPush(el, 'translate')");
    expect(PREVIEW_BRIDGE_JS).toContain("restPush(el, 'entry')");
    // applySlotFocus re-runs the wiring as setEditing(false)+setEditing(true), so the list must be
    // reset each pass or it doubles on every focus change.
    expect(PREVIEW_BRIDGE_JS).toMatch(/if \(on\) ensureStyle\(\);[\s\S]{0,400}?clearRest\(\);/);
  });

  it('repaints the fixed boxes when the layout moves under them', () => {
    // They are position:fixed over content that scrolls, reflows and grows as it is typed into. Without
    // a repaint they would be correct on arrival and progressively wrong from then on.
    expect(PREVIEW_BRIDGE_JS).toContain('scheduleRest()');
    expect(PREVIEW_BRIDGE_JS).toContain("document.addEventListener('input', scheduleRest, true)");
    expect(PREVIEW_BRIDGE_JS).toContain('new ResizeObserver(scheduleRest)');
    expect(PREVIEW_BRIDGE_JS).toContain("document.removeEventListener('input', scheduleRest, true)");
    // Coalesced to one frame — a scroll fires a burst of events, not one.
    expect(PREVIEW_BRIDGE_JS).toMatch(/restTick = true;\s*requestAnimationFrame/);
  });

  it('bounds the repaint: viewport-culled and capped', () => {
    // A page can carry hundreds of regions. Reads all happen before writes, so a repaint costs one
    // layout pass rather than one per box.
    expect(PREVIEW_BRIDGE_JS).toContain('REST_MAX = 400');
    expect(PREVIEW_BRIDGE_JS).toContain('REST_MARGIN = 400');
    expect(PREVIEW_BRIDGE_JS).toMatch(/hits\.length < REST_MAX/);
  });
});

describe('preview bridge — moving between chrome slots, and modals that live in one', () => {
  it('offers "Edit <slot>" on every landmark EXCEPT the one already being edited', () => {
    // It used to bail on `if (slotFocus) return`, so inside a slot editor there was no way to reach
    // another slot at all — you closed it and went back to Settings. Now only the focused slot is
    // skipped, because you are already in it.
    expect(PREVIEW_BRIDGE_JS).toContain("if (!meta || meta[0] === slotFocus) { hideSlotButton(); return; }");
    expect(PREVIEW_BRIDGE_JS).toContain("b.textContent = 'Edit ' + meta[2]");
    expect(PREVIEW_BRIDGE_JS).toContain("post({ type: 'edit-slot', slot: key })");
  });

  it('a receded OTHER slot stays hoverable while its CONTENTS stay inert', () => {
    // .sw-slot-dim is pointer-events:none, which would swallow the hover the offer depends on. The
    // other landmarks get a variant that takes pointer events on the LANDMARK and denies them to every
    // descendant — so the band can offer to be edited without its receded nav being clickable.
    expect(PREVIEW_BRIDGE_JS).toContain('.sw-slot-other{opacity:.25;filter:grayscale(1);pointer-events:auto;cursor:pointer}');
    expect(PREVIEW_BRIDGE_JS).toContain('.sw-slot-other *{pointer-events:none}');
    expect(PREVIEW_BRIDGE_JS).toContain("el.className += ' sw-slot-other'");
    // …and the reset must clear it, or a landmark stays dimmed after the focus moves on.
    expect(PREVIEW_BRIDGE_JS).toContain('sw-slot-(dim|target|other)');
  });

  it('follows an open modal into the TOP LAYER, where z-index does not reach', () => {
    // A site-wide <dialog> is authored in the Bottom slot and stays a DOM descendant of #bottom when
    // shown — so the slot lookup already resolved it. What did not work was being SEEN: the top layer
    // paints above every z-index, so the pill sat behind the modal it was labelling. It moves into the
    // dialog instead, which is the only way to share that layer.
    expect(PREVIEW_BRIDGE_JS).toContain("if (tag === 'dialog' && el.hasAttribute('open')) return el;");
    expect(PREVIEW_BRIDGE_JS).toContain("el.matches(':popover-open')");
    expect(PREVIEW_BRIDGE_JS).toContain('if (b.parentNode !== parent) parent.appendChild(b);');
    // …and it anchors to the MODAL's box: the landmark holding a set of dialogs is usually 0-height.
    expect(PREVIEW_BRIDGE_JS).toContain('var anchor = host || land;');
  });

  it(':popover-open is probed defensively — an older engine must not break the offer', () => {
    expect(PREVIEW_BRIDGE_JS).toMatch(/try \{ if \(el\.matches\(':popover-open'\)\) return el; \} catch \(err\)/);
  });
});

describe('preview bridge — the injected string is real JavaScript', () => {
  /**
   * ★ THE BRIDGE IS ONE BIG TEMPLATE LITERAL, so a stray BACKTICK inside it — most easily a `code
   * span` written into a comment — terminates the string early. TypeScript then reports a cascade of
   * TS1005/TS1443 errors hundreds of lines away from the cause, and when the file happens to stay
   * parseable the damage is silent: the browser receives truncated JS and the whole editor preview
   * goes inert with no error anyone connects to a comment.
   *
   * This caught it three times in one day, so it stops being a thing anyone has to remember.
   */
  it('parses, so no comment can have terminated the template literal', () => {
    expect(() => new Script(PREVIEW_BRIDGE_JS)).not.toThrow();
    expect(PREVIEW_BRIDGE_JS.trimEnd().endsWith('})();')).toBe(true); // the whole IIFE, not a prefix
  });

  it('has no UNESCAPED backtick inside the literal — checked in the SOURCE, where escaping is visible', () => {
    // Read the .ts, not the exported string: by the time the literal is evaluated a legitimate \` and a
    // string-terminating ` are the same character, so only the source can tell them apart.
    const src = readFileSync(new URL('../src/http/preview-bridge.ts', import.meta.url), 'utf8');
    const lines = src.split('\n');
    const open = lines.findIndex((l) => l.includes('PREVIEW_BRIDGE_JS = `'));
    const close = lines.findIndex((l) => l.trim() === '})();`;');
    expect(open, 'the literal delimiters moved — update this guard').toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
    const offenders = lines
      .slice(open + 1, close)
      .map((line, i) => ({ line: open + 2 + i, text: line }))
      .filter(({ text }) => /(^|[^\\])`/.test(text));
    expect(offenders.map((o) => `${o.line}: ${o.text.trim().slice(0, 80)}`)).toEqual([]);
  });
});

describe('preview bridge — markers TRACK an animating element', () => {
  /**
   * ★ A TRANSFORM CHANGES NO LAYOUT SIZE, so a ResizeObserver never fires for one — and transform is
   * what nearly every animation here animates (scroll-reveal, parallax, a carousel, a marquee, a hover
   * lift). The markers were therefore not merely late on animated elements: they did not update AT ALL
   * until the next scroll or resize.
   */
  it('starts a tracking loop from the events a transform actually fires', () => {
    // transitionRUN, not transitionEND: by the time a transition ends the marker has already been
    // wrong for its entire duration.
    expect(PREVIEW_BRIDGE_JS).toContain("document.addEventListener('animationstart', trackMotion, true)");
    expect(PREVIEW_BRIDGE_JS).toContain("document.addEventListener('transitionrun', trackMotion, true)");
    expect(PREVIEW_BRIDGE_JS).toContain("document.addEventListener('transitionstart', trackMotion, true)");
    // …and unregisters them, and cancels the loop, when content mode goes off.
    expect(PREVIEW_BRIDGE_JS).toContain("document.removeEventListener('animationstart', trackMotion, true)");
    expect(PREVIEW_BRIDGE_JS).toContain('if (motionRaf) { cancelAnimationFrame(motionRaf); motionRaf = 0; }');
  });

  it('settles on REST, not on a timer', () => {
    // paintRest reports whether anything MOVED; the loop stops after N still frames with no running
    // animation. A timer would either cut an animation off or burn frames after it ended.
    expect(PREVIEW_BRIDGE_JS).toContain('MOTION_SETTLE_FRAMES');
    expect(PREVIEW_BRIDGE_JS).toMatch(/if \(moved \|\| pageIsAnimating\(\)\) motionStill = 0;\s*else motionStill\+\+;/);
    expect(PREVIEW_BRIDGE_JS).toMatch(/if \(motionStill >= MOTION_SETTLE_FRAMES\)/);
    expect(PREVIEW_BRIDGE_JS).toContain("anims[i].playState === 'running'");
  });

  it('does not chase an INFINITE animation at full frame rate forever', () => {
    // A marquee never settles. Keep tracking, but drop to a coarse interval rather than burning a
    // frame callback for the life of the tab.
    expect(PREVIEW_BRIDGE_JS).toContain('MOTION_FULL_RATE_MS');
    expect(PREVIEW_BRIDGE_JS).toMatch(/now - motionSince > MOTION_FULL_RATE_MS/);
  });

  it('observes the marked ELEMENTS, not only <body>', () => {
    // A region that changes size while the document does not — an accordion opening, a textarea
    // growing — is invisible to a body-level observer.
    expect(PREVIEW_BRIDGE_JS).toMatch(/for \(var ri = 0; ri < restList\.length; ri\+\+\) \{ try \{ restRO\.observe\(restList\[ri\]\.el\); \}/);
  });
});
