import * as consts from 'imap/consts'
import * as editorConsts from 'imap-shared/consts'
import { getElementRect, isMobile } from 'imap-shared/utilities'

export default {
  getImageMap: function () {
    return this.imageMap
  },
  getID: function (state) {
    return state.id + ''
  },
  getName: function (state) {
    return state.general.name
  },
  getObject: function (state, { id }) {
    let result
    traverseObjects(state.artboards, (obj) => {
      if (obj.id === id) {
        result = obj
        return true
      }
    })
    return result
  },
  getObjectByTitle: function (state, { title }) {
    let result
    traverseObjects(state.artboards, (obj) => {
      if (obj.title === title) {
        result = obj
        return true
      }
    })
    return result
  },
  getObjects: function () {
    let result = []
    traverseObjects([this.getArtboard()], (obj) => {
      if (obj.type !== editorConsts.OBJECT_ARTBOARD) result.push(obj)
    })
    return result
  },
  getArtboard: function (state) {
    return state.artboards.filter((o) => o.id === this.getArtboardController().currentArtboardId)[0]
  },
  getArtboards: function (state) {
    return state.artboards
  },
  getArtboardByTitle: function (state, { title }) {
    return state.artboards.filter((o) => o.title === title)[0]
  },
  getArtboardIdForObject: function (state, { id }) {
    let artboardId

    for (let artboard of state.artboards) {
      traverseObjects([artboard], (obj) => {
        if (obj.id === id) {
          artboardId = artboard.id
          return true
        }
      })
    }

    return artboardId
  },
  getChildrenDeep: function (state, { id }) {
    let obj = this.getObject({ id })
    let result = []
    traverseObjects(obj.children, (o) => {
      result.push(o)
    })
    return result
  },
  getParent: function (state, { id }) {
    return this.getObject({ id: this.getObject({ id }).parent_id })
  },

  // Controllers
  getEventController: function () {
    return this.imageMap.eventController
  },
  getZoomController: function () {
    return this.imageMap.zoomController
  },
  getTooltipController: function () {
    return this.imageMap.tooltipController
  },
  getArtboardController: function () {
    return this.imageMap.artboardController
  },
  getObjectController: function () {
    return this.imageMap.objectController
  },
  getNavigatorController: function () {
    return this.imageMap.navigatorController
  },
  getMenuController: function () {
    return this.imageMap.menuController
  },
  getFullscreenController: function () {
    return this.imageMap.fullscreenController
  },

  // Flags & variables
  getIsFullscreen: function () {
    return this.imageMap.fullscreenController.isFullscreen
  },
  getZoom: function () {
    return this.imageMap.zoomController.currentZoom
  },
  getMaxZoom: function () {
    return this.imageMap.zoomController.maxZoom
  },
  getPan: function () {
    return {
      x: this.imageMap.zoomController.actualPanX,
      y: this.imageMap.zoomController.actualPanY,
    }
  },
  getMinPan: function () {
    return {
      x: this.imageMap.zoomController.minPanX,
      y: this.imageMap.zoomController.minPanY,
    }
  },
  getEventCoordinates: function () {
    return {
      x: this.imageMap.eventController.eventCoordinates.x,
      y: this.imageMap.eventController.eventCoordinates.y,
    }
  },
  getIsMenuMobile: function () {
    let containerWidth = parseInt(this.getContainer().getBoundingClientRect().width) || this.getArtboard().width

    if (isMobile() || containerWidth / 3 < 240) {
      return true
    } else {
      return false
    }
  },
  getAreTooltipsFullscreen: function () {
    return this.imageMap.tooltipController.tooltipsAreFullscreen
  },
  getCurrentArtboard: function () {
    return this.imageMap.artboardController.currentArtboardId
  },
  getIsThereFullscreenTooltipOpen: function () {
    if (this.imageMap.tooltipController.tooltipsAreFullscreen && this.imageMap.tooltipController.openedTooltips.length > 0) return true
    return false
  },

  // Elements
  getImage: function () {
    return this.imageMap.image
  },
  getContainer: function () {
    return this.imageMap.containerEl
  },
  getCanvasWrap: function () {
    return this.imageMap.canvasWrap
  },
  getScaleWrap: function () {
    return this.imageMap.scaleWrap
  },
  getTranslateWrap: function () {
    return this.imageMap.translateWrap
  },
  getUIWrap: function () {
    return this.imageMap.UIWrap
  },

  // Rects
  getCanvasWrapRect: function () {
    if (!this.imageMap.cacheController.getValue(consts.RECT_CANVAS_WRAP)) {
      this.imageMap.cacheController.setValue(consts.RECT_CANVAS_WRAP, getElementRect(this.imageMap.canvasWrap))
    }
    return this.imageMap.cacheController.getValue(consts.RECT_CANVAS_WRAP)
  },
  getNavigatorRect: function () {
    if (!this.imageMap.cacheController.getValue(consts.RECT_NAVIGATOR)) {
      this.imageMap.cacheController.setValue(consts.RECT_NAVIGATOR, getElementRect(this.imageMap.navigatorController.navigator.element))
    }
    return this.imageMap.cacheController.getValue(consts.RECT_NAVIGATOR)
  },
  getTooltipsContainerRect: function () {
    if (!this.imageMap.cacheController.getValue(consts.RECT_TOOLTIPS_CONTAINER)) {
      this.imageMap.cacheController.setValue(consts.RECT_TOOLTIPS_CONTAINER, getElementRect(this.imageMap.tooltipController.container))
    }
    return this.imageMap.cacheController.getValue(consts.RECT_TOOLTIPS_CONTAINER)
  },
  getFullscreenButtonRect: function () {
    if (!this.imageMap.cacheController.getValue(consts.RECT_BUTTON_FULLSCREEN)) {
      this.imageMap.cacheController.setValue(consts.RECT_BUTTON_FULLSCREEN, getElementRect(this.imageMap.fullscreenController.button.element))
    }
    return this.imageMap.cacheController.getValue(consts.RECT_BUTTON_FULLSCREEN)
  },
  getZoomInButtonRect: function () {
    if (!this.imageMap.cacheController.getValue(consts.RECT_BUTTON_ZOOM_IN)) {
      this.imageMap.cacheController.setValue(consts.RECT_BUTTON_ZOOM_IN, getElementRect(this.imageMap.zoomController.buttons.zoomInButton))
    }
    return this.imageMap.cacheController.getValue(consts.RECT_BUTTON_ZOOM_IN)
  },
  getZoomOutButtonRect: function () {
    if (!this.imageMap.cacheController.getValue(consts.RECT_BUTTON_ZOOM_OUT)) {
      this.imageMap.cacheController.setValue(consts.RECT_BUTTON_ZOOM_OUT, getElementRect(this.imageMap.zoomController.buttons.zoomOutButton))
    }
    return this.imageMap.cacheController.getValue(consts.RECT_BUTTON_ZOOM_OUT)
  },
  getArtboardSelectRect: function () {
    if (!this.imageMap.cacheController.getValue(consts.RECT_ARTBOARD_SELECT_MENU)) {
      this.imageMap.cacheController.setValue(consts.RECT_ARTBOARD_SELECT_MENU, getElementRect(this.imageMap.artboardController.artboardMenu.element))
    }
    return this.imageMap.cacheController.getValue(consts.RECT_ARTBOARD_SELECT_MENU)
  },
  getTooltipCloseButtonRect: function () {
    return {
      offset: {
        left: window.innerWidth - 44,
        top: window.scrollY,
      },
      offsetWidth: 44,
      offsetHeight: 44,
    }
  },
  getOpenMenuButtonRect: function () {
    if (!this.imageMap.cacheController.getValue(consts.RECT_BUTTON_OPEN_MENU)) {
      this.imageMap.cacheController.setValue(consts.RECT_BUTTON_OPEN_MENU, getElementRect(this.imageMap.menuController.openButton.element))
    }
    return this.imageMap.cacheController.getValue(consts.RECT_BUTTON_OPEN_MENU)
  },
  getCloseMenuButtonRect: function () {
    if (!this.imageMap.cacheController.getValue(consts.RECT_BUTTON_CLOSE_MENU)) {
      this.imageMap.cacheController.setValue(consts.RECT_BUTTON_CLOSE_MENU, getElementRect(this.imageMap.menuController.closeButton.element))
    }
    return this.imageMap.cacheController.getValue(consts.RECT_BUTTON_CLOSE_MENU)
  },
  getMenuRect: function () {
    if (!this.imageMap.cacheController.getValue(consts.RECT_MENU)) {
      this.imageMap.cacheController.setValue(consts.RECT_MENU, getElementRect(this.imageMap.menuController.menu.element))
    }
    return this.imageMap.cacheController.getValue(consts.RECT_MENU)
  },
  getOpenedFullscreenTooltipRect: function () {
    let openedTooltipId = this.imageMap.tooltipController.openedTooltips.values().next().value
    if (openedTooltipId && !this.imageMap.cacheController.getValue(consts.RECT_OPENED_FULLSCREEN_TOOLTIP)) {
      let element = this.imageMap.tooltipController.getTooltipElement(openedTooltipId)
      let rect = getElementRect(element)
      this.imageMap.cacheController.setValue(consts.RECT_OPENED_FULLSCREEN_TOOLTIP, rect)
    }

    return this.imageMap.cacheController.getValue(consts.RECT_OPENED_FULLSCREEN_TOOLTIP)
  },
}

function traverseObjects(objects, callback) {
  for (let obj of objects) {
    if (obj.children) {
      traverseObjects(obj.children, callback)
    }
    if (callback(obj)) break
  }
}
