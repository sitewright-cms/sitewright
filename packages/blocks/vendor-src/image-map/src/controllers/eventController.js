import { getEventCoordinates, isMobile } from 'imap-shared/utilities'
import * as consts from 'imap/consts'

export default class EventController {
  store = undefined

  action = consts.ACTION_IDLE
  actionStart = consts.ACTION_IDLE

  eventCoordinates = { x: 0, y: 0 }
  eventCoordinatesStart = { x: 0, y: 0 }
  eventCoordinatesPrevious = { x: 0, y: 0 }
  eventDirection = undefined

  UIRects = []
  UIRectUnderEvent = undefined
  UIRectUnderEventStart = undefined
  UIClickedRect = undefined

  isEventOverTooltip = undefined
  isEventOverCanvas = undefined

  objectIndexUnderEvent = undefined
  objectIndexUnderEventPrevious = undefined
  objectIndexUnderEventStart = undefined
  objectIdClicked = undefined

  menuListItemIDUnderEvent = undefined
  menuListItemIDUnderEventPrevious = undefined

  mac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
  ctrlKeyDown = false
  cmdKeyDown = false

  canPinch = false

  constructor(store) {
    this.store = store
    this.createEvents()
  }
  buildUIModel() {
    // This is the order in which the rects will be tested

    if (this.store.getAreTooltipsFullscreen()) {
      this.UIRects[consts.RECT_BUTTON_CLOSE_TOOLTIP_FULLSCREEN] = () => {
        return this.store.getTooltipCloseButtonRect()
      }
      this.UIRects[consts.RECT_OPENED_FULLSCREEN_TOOLTIP] = () => {
        return this.store.getOpenedFullscreenTooltipRect()
      }
    }

    if (this.store.state.fullscreen.enable_fullscreen_mode) {
      this.UIRects[consts.RECT_BUTTON_FULLSCREEN] = () => {
        return this.store.getFullscreenButtonRect()
      }
    }

    if (this.store.state.zooming.enable_zooming) {
      if (this.store.state.zooming.enable_zoom_buttons) {
        this.UIRects[consts.RECT_BUTTON_ZOOM_IN] = () => {
          return this.store.getZoomInButtonRect()
        }
        this.UIRects[consts.RECT_BUTTON_ZOOM_OUT] = () => {
          return this.store.getZoomOutButtonRect()
        }
      }

      if (this.store.state.zooming.enable_navigator) {
        this.UIRects[consts.RECT_NAVIGATOR] = () => {
          return this.store.getNavigatorRect()
        }
      }
    }

    if (this.store.state.artboards.length > 1) {
      this.UIRects[consts.RECT_ARTBOARD_SELECT_MENU] = () => {
        return this.store.getArtboardSelectRect()
      }
    }

    if (this.store.state.object_list.enable_object_list) {
      this.UIRects[consts.RECT_MENU] = () => {
        return this.store.getMenuRect()
      }
      this.UIRects[consts.RECT_BUTTON_OPEN_MENU] = () => {
        return this.store.getOpenMenuButtonRect()
      }
      this.UIRects[consts.RECT_BUTTON_CLOSE_MENU] = () => {
        return this.store.getCloseMenuButtonRect()
      }
    }
  }
  createEvents() {
    this.boundHandleEventStart = this.handleEventStart.bind(this)
    this.boundHandleEventMove = this.handleEventMove.bind(this)
    this.boundHandleEventEnd = this.handleEventEnd.bind(this)
    this.boundHandleEventKeyDown = this.handleEventKeyDown.bind(this)
    this.boundHandleEventKeyUp = this.handleEventKeyUp.bind(this)
    this.boundHandleEventResize = this.handleEventResize.bind(this)
    this.boundHandleEventWheel = this.handleEventWheel.bind(this)
    this.boundHandleEventChange = this.handleEventChange.bind(this)

    if (isMobile()) {
      document.addEventListener('touchstart', this.boundHandleEventStart, { passive: false })
      document.addEventListener('touchmove', this.boundHandleEventMove, { passive: false })
      document.addEventListener('touchend', this.boundHandleEventEnd, { passive: false })
    } else {
      document.addEventListener('mousedown', this.boundHandleEventStart, { passive: false })
      document.addEventListener('mousemove', this.boundHandleEventMove, { passive: false })
      document.addEventListener('mouseup', this.boundHandleEventEnd, { passive: false })
    }

    document.addEventListener('keydown', this.boundHandleEventKeyDown, { passive: false })
    document.addEventListener('keyup', this.boundHandleEventKeyUp, { passive: false })
    document.addEventListener('wheel', this.boundHandleEventWheel, { passive: false })
    document.addEventListener('change', this.boundHandleEventChange, { passive: false })

    const resizeObserver = new ResizeObserver(this.boundHandleEventResize)
    if (this.store.getContainer().parentElement) resizeObserver.observe(this.store.getContainer().parentElement)
  }
  removeEvents() {
    if (isMobile()) {
      document.removeEventListener('touchstart', this.boundHandleEventStart, { passive: false })
      document.removeEventListener('touchmove', this.boundHandleEventMove, { passive: false })
      document.removeEventListener('touchend', this.boundHandleEventEnd, { passive: false })
    } else {
      document.removeEventListener('mousedown', this.boundHandleEventStart, { passive: false })
      document.removeEventListener('mousemove', this.boundHandleEventMove, { passive: false })
      document.removeEventListener('mouseup', this.boundHandleEventEnd, { passive: false })
    }

    document.removeEventListener('keydown', this.boundHandleEventKeyDown, { passive: false })
    document.removeEventListener('keyup', this.boundHandleEventKeyUp, { passive: false })
    document.removeEventListener('wheel', this.boundHandleEventWheel, { passive: false })
    document.removeEventListener('change', this.boundHandleEventChange, { passive: false })
    window.removeEventListener('resize', this.boundHandleEventResize, { passive: false })
  }

  handleEventStart(e) {
    this.updateFlagsAndVariables(e)
    this.doStartAction()
    this.doMenuStart(e)
  }
  handleEventMove(e) {
    this.updateFlagsAndVariables(e)
    if (this.doAction(e)) {
      this.objectIdUnderEventPrevious = false
      this.store.dispatch('unhighlightAllObjects')
      return
    }
    if (this.doMenuMove(e)) return
    this.doMouseOverObject(e)
  }
  async handleEventEnd(e) {
    this.updateFlagsAndVariables(e)
    if (this.doEndAction()) return
    if (await this.doMenuEnd(e)) return
    if (this.doClickUI(e)) return
    if (this.doClickObject()) return
  }
  handleEventKeyDown(e) {
    this.updateFlagsAndVariables(e)
  }
  handleEventKeyUp(e) {
    this.updateFlagsAndVariables(e)

    if (e.code == 'Escape') {
      this.store.dispatch('closeFullscreen')
    }

    if (document.querySelector(`[data-sw-imap-id="${this.store.getID()}"] input:focus`)) {
      this.store.dispatch('updateSearch', {
        searchString: document.querySelector(`[data-sw-imap-id="${this.store.getID()}"] input:focus`).value,
      })
    }
  }
  handleEventResize() {
    this.store.dispatch('beforeResize')
    this.store.dispatch('resize')
  }
  handleEventWheel(e) {
    this.updateFlagsAndVariables(e)

    // Never zoom if the mouse is over a UI element
    if (this.UIRectUnderEvent) return

    // Zooming
    if (this.isEventOverCanvas && this.store.state.zooming.enable_zooming) {
      if (this.store.state.zooming.hold_ctrl_to_zoom) {
        if ((this.mac && this.cmdKeyDown) || (!this.mac && this.ctrlKeyDown)) {
          this.doZoom(e)
        } else {
          this.store.dispatch('failedToZoom')
        }
      } else {
        this.doZoom(e)
      }
    }
  }
  handleEventChange(e) {
    if (e.target.classList.contains('sw-imap-ui-layers-select') && e.target.closest(`[data-sw-imap-id="${this.store.getID()}"]`)) {
      this.store.dispatch('changeArtboard', { artboardId: e.target.value, zoomOut: true })
    }

    if (e.target.closest(`[data-sw-imap-id="${this.store.getID()}"] .sw-imap-search-box-input-wrap`)) {
      this.store.dispatch('updateSearch', { searchString: e.target.value })
    }
  }

  updateFlagsAndVariables(e) {
    // Handle key press
    if (e.type == 'keydown' || e.type == 'keyup') {
      this.ctrlKeyDown = e.ctrlKey
      this.cmdKeyDown = e.metaKey
      return
    }

    // Store event coords
    this.eventCoordinates = getEventCoordinates(e)
    if (e.type == 'mousedown' || e.type == 'touchstart') this.eventCoordinatesStart = this.eventCoordinates

    // Is event over UI?
    this.UIRectUnderEvent = this.getUIRectNameUnderEvent(e)
    if (e.type == 'mousedown' || e.type == 'touchstart') this.UIRectUnderEventStart = this.UIRectUnderEvent
    this.UIClickedRect = this.UIRectUnderEvent === this.UIRectUnderEventStart ? this.UIRectUnderEvent : false
    this.menuListItemIDUnderEvent = this.getMenuListItemIdUnderEvent(e)

    // Is event in canvas?
    this.isEventOverCanvas = this.isPointInsideRect(this.eventCoordinates, this.getZoomedCanvasRect())

    // Is event over tooltip?
    this.isEventOverTooltip = this.store.getTooltipController().isPointInsideVisibleTooltip({ x: this.eventCoordinates.x, y: this.eventCoordinates.y }) || this.isEventOverVisibleTooltip(e)

    // Is event over an object?
    this.objectIdUnderEvent = this.getObjectIdUnderEvent(e)

    if (e.type == 'mousedown' || e.type == 'touchstart') this.objectIdUnderEventStart = this.objectIdUnderEvent
    this.objectIdClicked = this.objectIdUnderEvent === this.objectIdUnderEventStart ? this.objectIdUnderEvent : false
    if (e.type == 'mousemove' || e.type == 'touchmove') this.objectIdUnderEventStart = false

    // Can pinch?
    this.canPinch = this.getCanPinch(e)

    this.updateStickyTooltipsConfig()

    // Calculate mouse direction
    let dx = this.eventCoordinates.x - this.eventCoordinatesPrevious.x
    let dy = this.eventCoordinates.y - this.eventCoordinatesPrevious.y
    if (dx > 0 && Math.abs(dx) > Math.abs(dy)) this.eventDirection = consts.MOUSE_DIRECTION_RIGHT
    if (dx < 0 && Math.abs(dx) > Math.abs(dy)) this.eventDirection = consts.MOUSE_DIRECTION_LEFT
    if (dy > 0 && Math.abs(dy) > Math.abs(dx)) this.eventDirection = consts.MOUSE_DIRECTION_DOWN
    if (dy < 0 && Math.abs(dy) > Math.abs(dx)) this.eventDirection = consts.MOUSE_DIRECTION_UP

    // Store event coords for the next cycle
    this.eventCoordinatesPrevious = { ...this.eventCoordinates }
  }

  // Actions
  doStartAction() {
    if (this.UIRectUnderEvent === consts.RECT_NAVIGATOR) {
      this.actionStart = consts.ACTION_PAN_ON_NAVIGATOR
      return
    }

    if (this.UIRectUnderEvent) return
    if (this.isEventOverTooltip) return

    if (this.canPinch) {
      this.actionStart = consts.ACTION_PINCH
      return
    }
    if (this.isEventOverCanvas) {
      this.actionStart = consts.ACTION_PAN
      return
    }
  }
  doAction(e) {
    if (this.actionStart === consts.ACTION_PINCH) {
      this.action = consts.ACTION_PINCH
      this.store.dispatch('startPinch', { event: e })
    }
    if (this.actionStart === consts.ACTION_PAN_ON_NAVIGATOR) {
      this.action = consts.ACTION_PAN_ON_NAVIGATOR
    }
    if (this.actionStart === consts.ACTION_PAN) {
      this.action = consts.ACTION_PAN
      this.store.dispatch('startPan', { x: this.eventCoordinates.x, y: this.eventCoordinates.y })
    }

    this.actionStart = consts.ACTION_IDLE

    if (this.action === consts.ACTION_PINCH) {
      this.store.dispatch('pinch', { event: e })
      this.preventDefault(e)
      return true
    }
    if (this.action === consts.ACTION_PAN_ON_NAVIGATOR) {
      this.store.dispatch('panOnNavigator', { x: this.eventCoordinates.x, y: this.eventCoordinates.y })
      this.preventDefault(e)
      return true
    }
    if (this.action === consts.ACTION_PAN) {
      this.store.dispatch('pan', { x: this.eventCoordinates.x, y: this.eventCoordinates.y })
      if (!this.isPanLimitReached()) this.preventDefault(e)
      return true
    }

    return false
  }
  doEndAction() {
    this.actionStart = consts.ACTION_IDLE

    if (this.action == consts.ACTION_PINCH) {
      if (!this.canPinch) {
        this.action = consts.ACTION_IDLE
      }

      if (this.isEventOverCanvas && !this.UIRectUnderEvent) {
        // transition to panning
        this.action = consts.ACTION_PAN
        this.store.dispatch('startPan', this.eventCoordinates)
      }

      return true
    }

    if (this.action !== consts.ACTION_IDLE) {
      this.action = consts.ACTION_IDLE
      return true
    }

    return false
  }
  doClickUI(e) {
    if (this.UIClickedRect) {
      if (this.UIClickedRect === consts.RECT_BUTTON_FULLSCREEN) {
        if (this.store.getIsFullscreen()) {
          this.store.dispatch('closeFullscreen')
        } else {
          this.store.dispatch('goFullscreen')
        }
      }
      if (this.UIClickedRect === consts.RECT_BUTTON_ZOOM_IN) {
        this.store.dispatch('zoomIn', {})
      }
      if (this.UIClickedRect === consts.RECT_BUTTON_ZOOM_OUT) {
        this.store.dispatch('zoomOut', {})
      }
      if (e.target.classList.contains('sw-imap-clear-search')) {
        this.store.dispatch('clearSearch')
      }
      if (this.UIClickedRect == consts.RECT_OPENED_FULLSCREEN_TOOLTIP) {
        if (
          (e.target.closest('.sw-imap-tooltip-content') === null && !e.target.classList.contains('sw-imap-tooltip-content')) ||
          e.target.closest('.sw-imap-tooltip-close-button') ||
          e.target.classList.contains('sw-imap-tooltip-close-button')
        ) {
          this.store.dispatch('closeFullscreenTooltip')
        } else {
          return false
        }
      }
      // if (this.UIClickedRect == consts.RECT_OPENED_FULLSCREEN_TOOLTIP) {
      //   if (
      //     (e.target.closest('.sw-imap-tooltip-content') === null && !e.target.classList.contains('sw-imap-tooltip-content')) ||
      //     e.target.closest('.sw-imap-tooltip-close-button') ||
      //     e.target.classList.contains('sw-imap-tooltip-close-button')
      //   ) {
      //     this.store.dispatch('closeFullscreenTooltip')
      //   } else {
      //     return false
      //   }
      // }
      if (this.UIClickedRect == consts.RECT_BUTTON_OPEN_MENU) {
        this.store.dispatch('openMenu')
      }
      if (this.UIClickedRect == consts.RECT_BUTTON_CLOSE_MENU) {
        this.store.dispatch('closeMenu')
        this.preventDefault(e)
        return true
      }
      if (this.UIClickedRect == consts.RECT_ARTBOARD_SELECT_MENU) {
        this.store.dispatch('unhighlightAllObjects')
        return false
      }
      if (e.target.closest('.sw-imap-search-box-input-wrap')) {
        return true
      }

      this.store.dispatch('unhighlightAllObjects')
      this.preventDefault(e)
      return true
    }

    return false
  }
  async doClickObject() {
    if (this.objectIdClicked !== false && this.getDistanceBetweenCoordinates(this.eventCoordinates, this.eventCoordinatesStart) < 10) {
      await this.store.dispatch('clickObject', { objectId: this.objectIdUnderEvent })

      if (this.store.getImageMap().config.zooming.zoom_on_object_click) {
        await this.store.dispatch('focusObject', { objectId: this.objectIdUnderEvent, showTooltip: false })
      }

      await this.store.dispatch('unhighlightAllObjects')
      this.store.dispatch('highlightObject', {
        objectId: this.objectIdUnderEvent,
        showTooltip: true,
        hideAllTooltips: false,
      })
      return true
    }
    return false
  }
  async doMouseOverObject() {
    // Exception when tooltips are sticky
    // Prevent a race condition when the tooltip is limited by screen
    // and gets under the mouse
    if (this.store.getTooltipController().stickyTooltips && this.isEventOverTooltip && !this.store.getAreTooltipsFullscreen()) {
      this.store.dispatch('updateTooltipPositions')
      return
    }

    // If sticky tooltips are on, update tooltip position
    if (this.store.getTooltipController().stickyTooltips && !this.store.getAreTooltipsFullscreen()) {
      this.store.dispatch('updateTooltipPositions')
    }

    // If there is a tooltip under the event, return
    if (this.isEventOverTooltip) return false

    // If object under event is the same, return
    if (this.objectIdUnderEventPrevious === this.objectIdUnderEvent) return false

    if (this.objectIdUnderEvent !== false) {
      this.objectIdUnderEventPrevious = this.objectIdUnderEvent
      await this.store.dispatch('unhighlightAllObjects')
      let showTooltip = true
      if (this.store.state.tooltips.show_tooltips == 'click') showTooltip = false
      this.store.dispatch('highlightObject', {
        objectId: this.objectIdUnderEvent,
        showTooltip: showTooltip,
        hideAllTooltips: false,
      })

      return true
    }

    if (this.objectIdUnderEvent === false) {
      this.objectIdUnderEventPrevious = false
      this.store.dispatch('unhighlightAllObjects')
    }

    return false
  }
  doMenuStart() {
    if (this.UIRectUnderEvent !== consts.RECT_MENU) return false
  }
  doMenuMove() {
    // If the menu list item is the same, return
    if (this.menuListItemIDUnderEventPrevious === this.menuListItemIDUnderEvent) return false

    // If there is a menu list item under event, highlight the object
    if (this.menuListItemIDUnderEvent) {
      if (!isMobile()) {
        this.menuListItemIDUnderEventPrevious = this.menuListItemIDUnderEvent
        this.store.dispatch('unhighlightAllObjects')

        if (!this.store.getObject({ id: this.menuListItemIDUnderEvent }).static) {
          this.store.dispatch('highlightObject', { objectId: this.menuListItemIDUnderEvent, showTooltip: false })
        }

        return true
      }
    }

    if (this.menuListItemIDUnderEvent === false) {
      this.objectIdUnderEventPrevious = null
      this.menuListItemIDUnderEventPrevious = false
      return false
    }

    return false
  }
  async doMenuEnd(e) {
    if (this.getDistanceBetweenCoordinates(this.eventCoordinates, this.eventCoordinatesStart) > 10) return
    if (this.UIRectUnderEvent !== consts.RECT_MENU) return false

    if (e.target.classList.contains('sw-imap-object-list-item-artboard') || e.target.closest('.sw-imap-object-list-item-artboard')) {
      this.store.dispatch('toggleArtboard', { artboardId: this.menuListItemIDUnderEvent })
      this.preventDefault(e)
      return true
    }

    if (e.target.classList.contains('sw-imap-object-list-item-group') || e.target.closest('.sw-imap-object-list-item-group')) {
      this.store.dispatch('toggleGroup', { groupId: this.menuListItemIDUnderEvent })
      this.preventDefault(e)
      return true
    }

    if (this.menuListItemIDUnderEvent) {
      if (this.store.getObject({ id: this.menuListItemIDUnderEvent }).actions.click === 'change-artboard') {
        // Exception when the object's action is to change the artboard
        // prevent the double change of artboard
        // zoom out, because clicking an object like this does not focus on it, since the artboard changes
        await this.store.dispatch('changeArtboard', {
          artboardId: this.store.getObject({ id: this.menuListItemIDUnderEvent }).actions.artboard,
          zoomOut: true,
        })
        this.preventDefault(e)
        return true
      } else {
        await this.store.dispatch('changeArtboard', {
          artboardId: this.store.getArtboardIdForObject({ id: this.menuListItemIDUnderEvent }),
          zoomOut: false,
        })
      }

      if (!this.store.getObject({ id: this.menuListItemIDUnderEvent }).static) {
        if (this.store.getImageMap().config.zooming.zoom_on_object_click) {
          await this.store.dispatch('focusObject', { objectId: this.menuListItemIDUnderEvent })
        }
        await this.store.dispatch('highlightObject', {
          objectId: this.menuListItemIDUnderEvent,
          showTooltip: true,
          hideAllTooltips: true,
        })
        await this.store.dispatch('clickObject', { objectId: this.menuListItemIDUnderEvent })
      }

      this.preventDefault(e)
      return true
    }

    return false
  }
  doZoom(e) {
    let shouldAnimate = this.action == consts.ACTION_PAN ? false : true

    if (e.deltaY > 0) {
      this.store.dispatch('zoomOut', { coords: this.eventCoordinates, animate: shouldAnimate })
    } else {
      this.store.dispatch('zoomIn', { coords: this.eventCoordinates, animate: shouldAnimate })
    }

    this.preventDefault(e)

    if (this.action == consts.ACTION_PAN) {
      this.store.dispatch('startPan', this.eventCoordinates)
    }
  }

  // Helpers
  preventDefault(e) {
    if (e.cancelable) e.preventDefault()
  }
  getUIRectNameUnderEvent() {
    let orderedRectNames = [
      consts.RECT_OPENED_FULLSCREEN_TOOLTIP,
      consts.RECT_BUTTON_FULLSCREEN,
      consts.RECT_BUTTON_ZOOM_IN,
      consts.RECT_BUTTON_ZOOM_OUT,
      consts.RECT_NAVIGATOR,
      consts.RECT_ARTBOARD_SELECT_MENU,
      consts.RECT_MENU,
      consts.RECT_BUTTON_OPEN_MENU,
      consts.RECT_BUTTON_CLOSE_MENU,
    ]

    let result = false

    for (let rectName of orderedRectNames) {
      if (this.UIRects[rectName]) {
        if (this.isPointInsideRect(this.eventCoordinates, this.UIRects[rectName]())) {
          this.UIRectUnderEvent = rectName
          result = rectName
        }
      }
    }

    return result
  }
  isPointInsideRect(point, rect) {
    if (!rect) return false

    return point.x > rect.offset.left && point.x < rect.offset.left + rect.offsetWidth && point.y > rect.offset.top && point.y < rect.offset.top + rect.offsetHeight
  }
  getObjectIdUnderEvent(e) {
    // Check if the event target is NOT an object
    let id
    if (e.target.dataset.parentId) id = e.target.dataset.parentId
    else if (e.target.closest('[data-parent-id]')?.dataset.parentId) id = e.target.closest('[data-parent-id]')?.dataset.parentId
    else if (e.target.dataset.objectId) id = e.target.dataset.objectId
    else if (e.target.closest('[data-object-id]')?.dataset.objectId) id = e.target.closest('[data-object-id]')?.dataset.objectId
    if (!id) return false

    // Check if the event target belongs to another image map
    let targetImageMapId = e.target.dataset.swImapId || e.target.closest('[data-sw-imap-id]')?.dataset.swImapId

    if (targetImageMapId !== undefined && targetImageMapId + '' !== this.store.getID()) return false
    return id
  }
  isEventOverVisibleTooltip(e) {
    if (e.target.classList.contains('sw-imap-tooltip') || e.target.closest('.sw-imap-tooltip')) return true
  }
  getMenuListItemIdUnderEvent(e) {
    // Check if the event target is NOT a menu list item
    const listItemId = e.target.dataset.listItemId || e.target.closest('[data-list-item-id]')?.dataset.listItemId
    if (!listItemId) return false

    // Check if the object belongs to this image map
    const imageMapId = e.target.dataset.swImapId || e.target.closest('[data-list-item-id]')?.dataset.swImapId
    if (imageMapId !== this.store.getID()) return false

    return e.target.dataset.listItemId || e.target.closest('[data-list-item-id]')?.dataset.listItemId
  }
  getDistanceBetweenCoordinates(coord1, coord2) {
    return Math.sqrt(Math.pow(coord2.x - coord1.x, 2) + Math.pow(coord2.y - coord1.y, 2))
  }
  getZoomedCanvasRect() {
    if (this.store.getIsFullscreen()) {
      let objectMenuWidth = 0
      if (this.store.state.object_list.enable_object_list && !this.store.getIsMenuMobile()) {
        objectMenuWidth = 224
      }
      return {
        offset: {
          left: 0,
          top: window.scrollY,
        },
        offsetWidth: window.innerWidth - objectMenuWidth,
        offsetHeight: window.innerHeight,
      }
    } else {
      return this.store.getCanvasWrapRect()
    }
  }
  getCanPinch(e) {
    if (
      e.touches?.length == 2 &&
      this.isPointInsideRect({ x: e.touches[0].pageX, y: e.touches[0].pageY }, this.getZoomedCanvasRect()) &&
      this.isPointInsideRect({ x: e.touches[1].pageX, y: e.touches[1].pageY }, this.getZoomedCanvasRect())
    ) {
      return true
    } else {
      return false
    }
  }
  isPanLimitReached() {
    if (
      (this.eventDirection == consts.MOUSE_DIRECTION_UP && this.store.getPan().y > this.store.getMinPan().y) ||
      (this.eventDirection == consts.MOUSE_DIRECTION_DOWN && this.store.getPan().y < 0) ||
      (this.eventDirection == consts.MOUSE_DIRECTION_LEFT && this.store.getPan().x > this.store.getMinPan().y) ||
      (this.eventDirection == consts.MOUSE_DIRECTION_RIGHT && this.store.getPan().x < 0)
    ) {
      return false
    }

    return true
  }
  updateStickyTooltipsConfig() {
    if (this.UIRectUnderEvent === consts.RECT_MENU) {
      this.store.getTooltipController().disableStickyTooltips()
    } else {
      this.store.getTooltipController().resetStickyTooltips()
    }
  }
}
