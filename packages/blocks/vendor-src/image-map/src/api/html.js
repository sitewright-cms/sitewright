// The declarative attribute API: wire ordinary page elements to objects in a map, with no
// JavaScript. This is the runtime's ONLY public surface — a published Sitewright site runs no
// tenant JS on the document origin, so upstream's `window.ImageMapPro.*` imperative API has no
// caller and is module-internal here (see ./functions.js).
//
//   <li data-sw-imap-highlight-object-on-mouseover="Ninth Floor">Ninth Floor</li>
//   <button data-sw-imap-change-artboard="Second Floor">Second floor</button>
//
// Add `data-sw-imap-map="<map name>"` to target a specific map when the page hosts several;
// without it the binding resolves to the first map on the page.
//
// Upstream spelled this out as 591 lines: a hand-written pair of handlers per attribute, each
// repeating the same resolve-object → switch-artboard → queue-dispatch body, plus a full second
// set of pre-6.0 aliases (`*-shape-*`, `open-tooltip-*`, `close-tooltip-*`, `go-to-floor`) that
// were rewritten onto the modern names at bind time. The aliases are dropped — Sitewright has no
// pre-6.0 markup — and the rest is the table below.
import { ready } from 'imap-shared/utilities'
import * as consts from 'imap/consts'
import { subscribe, getMap } from 'imap/runtime'
import { queueAction } from 'imap/scripts/actionQueue'

/**
 * The bindings. `run` acts on the resolved object; `out`, when present, names a map-wide store
 * action bound to `mouseout` on the same element, so a hover highlight releases when the pointer
 * leaves. Each entry binds `data-sw-imap-<attr>-on-mouseover` and `data-sw-imap-<attr>-on-click`.
 */
const BINDINGS = [
  {
    attr: 'highlight-object',
    run: (map, obj) =>
      map.store.dispatch('highlightObject', { objectId: obj.id, showTooltip: false, hideAllTooltips: false }),
    out: 'unhighlightAllObjects',
  },
  {
    attr: 'unhighlight-object',
    run: (map, obj) => map.store.dispatch('unhighlightObject', { objectId: obj.id }),
  },
  {
    // "Trigger" is highlight WITH the object's tooltip — the full hover effect.
    attr: 'trigger-object',
    run: (map, obj) =>
      map.store.dispatch('highlightObject', { objectId: obj.id, showTooltip: true, hideAllTooltips: false }),
    out: 'unhighlightAllObjects',
  },
  {
    attr: 'untrigger-object',
    run: (map, obj) => map.store.dispatch('unhighlightObject', { objectId: obj.id }),
  },
  {
    attr: 'show-tooltip',
    run: async (map, obj) => {
      map.store.getTooltipController().disableStickyTooltips()
      await map.store.dispatch('showTooltip', { objectId: obj.id })
      map.store.getTooltipController().resetStickyTooltips()
    },
    out: 'hideAllTooltips',
  },
  {
    attr: 'hide-tooltip',
    run: (map, obj) => map.store.dispatch('hideTooltip', { objectId: obj.id }),
  },
  {
    attr: 'focus-object',
    run: (map, obj) => map.store.dispatch('focusObject', { objectId: obj.id, showTooltip: false }),
  },
]

/** The map an element targets: `data-sw-imap-map`, else the first map on the page. */
function mapFor(el) {
  return getMap(el.dataset.swImapMap)
}

/** Resolve the object an element names, bring its artboard into view, then queue `run`. */
async function actOnObject(el, objectTitle, name, run) {
  const map = mapFor(el)
  if (!map) return

  const obj = map.store.getObjectByTitle({ title: objectTitle })
  if (!obj) return

  const artboardId = map.store.getArtboardIdForObject({ id: obj.id })
  if (!artboardId) return

  await map.store.dispatch('changeArtboard', { artboardId, zoomOut: true })
  queueAction({ name, action: () => run(map, obj) })
}

// Which bindings each element already has. `mapInit` fires once PER MAP, so a page with two maps
// ran the whole bind pass twice upstream and every trigger fired twice. Kept in a WeakMap rather
// than an attribute so no bookkeeping of ours lands in the published DOM.
const bound = new WeakMap()

function claim(el, key) {
  let keys = bound.get(el)
  if (!keys) bound.set(el, (keys = new Set()))
  if (keys.has(key)) return false
  keys.add(key)
  return true
}

function bindAll() {
  for (const { attr, run, out } of BINDINGS) {
    for (const [event, suffix] of [
      ['mouseover', 'on-mouseover'],
      ['click', 'on-click'],
    ]) {
      const name = `${attr}-${suffix}`
      for (const el of document.querySelectorAll(`[data-sw-imap-${name}]`)) {
        if (!claim(el, name)) continue

        const title = el.getAttribute(`data-sw-imap-${name}`)
        el.addEventListener(event, () => actOnObject(el, title, attr, run))

        // The hover release partner, on the mouseover binding only.
        if (event === 'mouseover' && out) {
          el.addEventListener('mouseout', () => {
            const map = mapFor(el)
            if (map) queueAction({ name: out, action: () => map.store.dispatch(out) })
          })
        }
      }
    }
  }

  // Artboard ("floor") switching by title.
  for (const el of document.querySelectorAll('[data-sw-imap-change-artboard]')) {
    if (!claim(el, 'change-artboard')) continue

    const title = el.getAttribute('data-sw-imap-change-artboard')
    el.addEventListener('click', () => {
      const map = mapFor(el)
      if (!map) return
      const artboard = map.store.getArtboardByTitle({ title })
      if (!artboard) return
      queueAction({
        name: 'changeArtboard',
        action: () => map.store.dispatch('changeArtboard', { artboardId: artboard.id, zoomOut: true }),
      })
    })
  }
}

/**
 * Start watching for maps and wire any `data-sw-imap-*` elements once one initialises.
 *
 * Deliberately an exported CALL rather than a side-effecting module body: `@sitewright/blocks`
 * declares `"sideEffects": false`, so a bare `import 'imap/api/html'` is dropped from the bundle
 * as dead weight and the whole attribute API silently disappears.
 */
export function installAttributeApi() {
  ready(() => {
    subscribe((action) => {
      if (action.type === consts.HOOK_MAP_INIT) bindAll()
    })
  })
}
