import * as consts from 'imap/consts'
import { trigger } from 'imap/runtime'

// Store actions. `store.dispatch(name, payload)` calls one with ({ commit, state, store }, payload)
// and returns its result, then notifies subscribers.
//
// Many entries are intentionally EMPTY: they exist so dispatch has something to call and so the
// subscribers (controllers) get told the action happened — the controllers do the work in their
// own handleAction. Those are marked "notification only" below.
//
// Every action that does work is a PLAIN ASYNC FUNCTION. Upstream wrapped each body in
// `new Promise(async (resolve) => { … resolve() })`, which is the no-async-promise-executor
// antipattern and cost it three real hangs: `init` and `zoomUpdate` never called resolve() at all,
// and `highlightObject` returned early — without resolving — when the object was on another
// artboard, which could wedge the action queue that awaits it. An async function always settles,
// and a throw rejects instead of vanishing.

let storedPageloadAnimation = ''

export default {
  init: async ({ store }) => {
    storedPageloadAnimation = store.state.objectConfig.pageload_animation
  },
  beforeResize: () => {}, // notification only
  resize: () => {}, // notification only
  zoomIn: async ({ store }, { coords, animate = true, targetZoom }) => {
    await store.getZoomController().zoomIn({ coords, animate, targetZoom })
  },
  zoomOut: async ({ store }, { coords, animate = true }) => {
    await store.getZoomController().zoomOut({ coords, animate })
  },
  failedToZoom: () => {}, // notification only
  goFullscreen: async ({ store }) => {
    store.getFullscreenController().goFullscreen()
  },
  closeFullscreen: async ({ store }) => {
    store.getFullscreenController().closeFullscreen()
  },
  panTo: () => {}, // notification only
  startPan: () => {}, // notification only
  pan: () => {}, // notification only
  panOnNavigator: () => {}, // notification only
  startPinch: () => {}, // notification only
  pinch: () => {}, // notification only
  zoomAtRect: () => {}, // notification only
  highlightObject: async ({ store }, { objectId, showTooltip = true, hideAllTooltips = true }) => {
    // An object on another artboard isn't rendered — nothing to highlight. (Upstream returned here
    // from inside a Promise executor, leaving the promise pending forever.)
    if (store.getArtboardIdForObject({ id: objectId }) !== store.getArtboard().id) return
    await store.getObjectController().highlightObject(objectId)
    if (hideAllTooltips) await store.getTooltipController().hideAllTooltips()
    if (showTooltip) await store.getTooltipController().showTooltip(objectId)
  },
  unhighlightObject: async ({ store }, { objectId }) => {
    await store.getObjectController().unhighlightObject(objectId)
    await store.getTooltipController().hideTooltip(objectId)
  },
  unhighlightAllObjects: async ({ store }) => {
    await store.getObjectController().unhighlightAllObjects()
    await store.getTooltipController().hideAllTooltips()
  },
  focusObject: async ({ state, store }, { objectId, showTooltip = false }) => {
    if (!state.zooming.enable_zooming) return

    const coordsAndZoom = store.getObjectController().getFocusObjectCoordsAndZoom(objectId)
    store.getZoomController().setTargetZoom({ zoom: coordsAndZoom.zoom, redraw: false })
    store.getZoomController().setTargetPan({ x: coordsAndZoom.pan.x, y: coordsAndZoom.pan.y })
    store.getMenuController().hideMobileMenu()

    // Always yield one frame — the pan/zoom targets set above have to take effect before anything
    // queued behind this action runs (and before a tooltip is positioned against them). Upstream
    // resolved inside a requestAnimationFrame callback for the same reason.
    await new Promise((resolve) => requestAnimationFrame(resolve))
    if (!showTooltip) return
    await store.getTooltipController().hideAllTooltips()
    await store.getTooltipController().showTooltip(objectId)
  },
  clickObject: async ({ store }, { objectId }) => {
    store.getObjectController().performClickAction(objectId)
  },
  updateTooltipPositions: () => {}, // notification only
  closeFullscreenTooltip: () => {}, // notification only
  zoomUpdate: async ({ state, store }) => {
    trigger({
      type: consts.HOOK_ZOOM_PAN_UPDATE,
      payload: {
        map: state.general.name,
        zoom: store.getZoomController().currentZoom,
        pan: { x: store.getZoomController().actualPanX, y: store.getZoomController().actualPanY },
      },
    })
  },
  changeArtboard: async ({ state, store }, { artboardId, zoomOut = false }) => {
    if (store.getArtboard().id === artboardId) return

    await store.getTooltipController().hideAllTooltips()
    store.getArtboardController().changeArtboard(artboardId)
    await store.getImageMap().updateImage()
    await store.getImageMap().setBackground()
    store.getObjectController().createObjects()
    store.getObjectController().insertObjects()
    store.getNavigatorController().createUI()

    // Tooltips are rebuilt below; drop the stale open set first or the new ones inherit it.
    store.getTooltipController().openedTooltips.clear()

    if (zoomOut) store.getZoomController().resetZoom(true)
    await store.getTooltipController().createTooltips()
    await store.getMenuController().updateItems()

    trigger({
      type: consts.HOOK_ARTBOARD_CHANGE,
      payload: {
        map: state.general.name,
        artboard: store.getArtboard().title || artboardId,
      },
    })
  },
  updateSearch: () => {}, // notification only
  clearSearch: () => {}, // notification only
  openMenu: () => {}, // notification only
  closeMenu: () => {}, // notification only
  toggleGroup: async ({ store }, { groupId }) => {
    await store.getMenuController().menu.list.toggleGroup(groupId)
  },
  toggleArtboard: async ({ store }, { artboardId }) => {
    await store.getMenuController().menu.list.toggleArtboard(artboardId)
  },
  showTooltip: async ({ store }, { objectId }) => {
    await store.getTooltipController().showTooltip(objectId)
  },
  hideTooltip: async ({ store }, { objectId }) => {
    await store.getTooltipController().hideTooltip(objectId)
  },
  hideAllTooltips: async ({ store }) => {
    await store.getTooltipController().hideAllTooltips()
  },
  flashObjects: async ({ store }) => {
    store.state.objectConfig.pageload_animation = 'flash'
    store.getObjectController().stylesheet.innerHTML +=
      '.sw-imap-object.sw-imap-object-pageload-animation{transition-duration:350ms}'
    store.getObjectController().animateObjects()
  },
  disablePageloadAnimation: async ({ store }) => {
    if (!storedPageloadAnimation) storedPageloadAnimation = store.state.objectConfig.pageload_animation
    store.state.objectConfig.pageload_animation = 'none'
  },
  enablePageloadAnimation: async ({ store }) => {
    if (storedPageloadAnimation) store.state.objectConfig.pageload_animation = storedPageloadAnimation
  },
}
