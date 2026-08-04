// The imperative actions a map supports. Upstream published these on `window.ImageMapPro` for
// author JavaScript to call; here they are module-internal and driven by the declarative
// `data-sw-imap-*` attribute API in ./html.js.
//
// Upstream repeated the same 20-line body nine times, differing only in which store action runs.
// The shared shapes are factored out below: `objectAction` (resolve object → switch to its
// artboard → queue a dispatch) and `mapAction` (queue a dispatch on the map itself).
import { isMobile } from 'imap-shared/utilities'
import { queueAction } from 'imap/scripts/actionQueue'
import { getMap } from 'imap/runtime'

/**
 * Run `run(map, obj)` against the object titled `objectTitle`, after bringing its artboard into
 * view. Returns false when the map, the object, or its artboard can't be resolved.
 */
async function objectAction(name, imageMapName, objectTitle, run) {
  const map = getMap(imageMapName)
  if (!map) return false

  const obj = map.store.getObjectByTitle({ title: objectTitle })
  if (!obj) return false

  const artboardId = map.store.getArtboardIdForObject({ id: obj.id })
  if (!artboardId) return false

  await map.store.dispatch('changeArtboard', { artboardId, zoomOut: true })
  queueAction({ name, action: () => run(map, obj) })
  return true
}

/** Queue a store dispatch against the map itself (no object involved). */
function mapAction(name, imageMapName, run) {
  const map = getMap(imageMapName)
  if (!map) return false

  queueAction({ name, action: () => run(map) })
  return true
}

export const highlightObject = (imageMapName, objectTitle) =>
  objectAction('highlightObject', imageMapName, objectTitle, (map, obj) =>
    map.store.dispatch('highlightObject', { objectId: obj.id, showTooltip: false, hideAllTooltips: false })
  )

export const unhighlightObject = (imageMapName, objectTitle) =>
  objectAction('unhighlightObject', imageMapName, objectTitle, (map, obj) =>
    map.store.dispatch('unhighlightObject', { objectId: obj.id })
  )

export const focusObject = (imageMapName, objectTitle) =>
  objectAction('focusObject', imageMapName, objectTitle, (map, obj) =>
    map.store.dispatch('focusObject', { objectId: obj.id, showTooltip: false })
  )

export const showTooltip = (imageMapName, objectTitle) =>
  objectAction('showTooltip', imageMapName, objectTitle, async (map, obj) => {
    // Sticky tooltips are suspended for the duration so an explicitly requested tooltip opens
    // regardless of the map's stickiness setting, then the setting is restored.
    map.store.getTooltipController().disableStickyTooltips()
    await map.store.dispatch('showTooltip', { objectId: obj.id })
    map.store.getTooltipController().resetStickyTooltips()
  })

export const hideTooltip = (imageMapName, objectTitle) =>
  objectAction('hideTooltip', imageMapName, objectTitle, (map, obj) =>
    map.store.dispatch('hideTooltip', { objectId: obj.id })
  )

export const zoomIn = (imageMapName) => mapAction('zoomIn', imageMapName, (map) => map.store.dispatch('zoomIn', {}))

export const zoomOut = (imageMapName) => mapAction('zoomOut', imageMapName, (map) => map.store.dispatch('zoomOut', {}))

export const flashObjects = (imageMapName) =>
  mapAction('flashObjects', imageMapName, (map) => map.store.dispatch('flashObjects', {}))

export function changeArtboard(imageMapName, artboardTitle) {
  const map = getMap(imageMapName)
  if (!map) return false

  const artboard = map.store.getArtboardByTitle({ title: artboardTitle })
  if (!artboard) return false

  queueAction({
    name: 'changeArtboard',
    action: () => map.store.dispatch('changeArtboard', { artboardId: artboard.id, zoomOut: true }),
  })
  return true
}

export function reInitMap(imageMapName) {
  const map = getMap(imageMapName)
  if (!map) return false

  map.init()
  return true
}

export { isMobile }
