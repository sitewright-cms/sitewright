import { getElementRect, htmlToElement, lerp } from 'imap-shared/utilities'
import ZoomButtons from 'imap/UI/zoomButtons'

export default class ZoomController {
  store = undefined
  mac = navigator.platform.toUpperCase().indexOf('MAC') >= 0

  // Elements
  buttons = undefined
  scrollMessage = undefined

  // Zooming functionality
  currentZoom = 1
  targetZoom = 1
  maxZoom = 4
  zoomMultiplier = 1.45

  // Panning functionality
  ix = 0
  iy = 0

  lastX = 0
  lastY = 0

  targetPanX = 0
  targetPanY = 0

  actualPanX = 0
  actualPanY = 0

  initialPanX = 0
  initialPanY = 0

  panDeltaX = 0
  panDeltaY = 0

  minPanX = 0
  minPanY = 0

  // Pinching functionality
  pinchInitial = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ]
  pinchInitialDistance = 0
  pinchInitialZoom = 0

  // Scroll message timeouts
  showTimeout = undefined
  hideStartTimeout = undefined
  hideEndTimeout = undefined

  constructor(store) {
    this.store = store
    this.setMaxZoom()

    if (!this.store.state.zooming.enable_zooming) return

    this.store.subscribe(this.handleAction.bind(this))

    if (this.store.state.zooming.enable_zoom_buttons) {
      this.createButtons()
    }

    if (this.store.state.zooming.hold_ctrl_to_zoom) {
      this.createScrollMessage()
    }
  }
  // Actions
  handleAction(action) {
    if (action.type == 'failedToZoom') {
      this.displayScrollMessage()
    }
    if (action.type == 'panTo') {
      this.setTargetPan({ x: action.payload.x, y: action.payload.y })
    }
    if (action.type == 'startPan') {
      this.startPan({ x: action.payload.x, y: action.payload.y })
    }
    if (action.type == 'pan') {
      this.pan({ x: action.payload.x, y: action.payload.y })
    }
    if (action.type == 'startPinch') {
      this.startPinch(action.payload.event)
    }
    if (action.type == 'pinch') {
      this.pinch(action.payload.event)
    }
    // 'zoomAtRect' is dispatched but handled elsewhere — no work for this controller.
    if (action.type == 'resize') {
      this.resetZoom(true)
    }
  }

  // UI
  createButtons() {
    this.buttons = new ZoomButtons({
      id: this.store.getID(),
    })
  }
  insertUI() {
    if (!this.store.state.zooming.enable_zooming) return
    if (!this.store.state.zooming.enable_zoom_buttons) return

    if (
      this.store.state.object_list.enable_object_list &&
      this.store.state.object_list.menu_style === 'on-top' &&
      this.store.state.object_list.menu_position === 'right'
    ) {
      this.store.getUIWrap().querySelector('.sw-imap-ui-bottom-left').appendChild(this.buttons.zoomInButton)
      this.store.getUIWrap().querySelector('.sw-imap-ui-bottom-left').appendChild(this.buttons.zoomOutButton)
    } else {
      this.store.getUIWrap().querySelector('.sw-imap-ui-bottom-right').appendChild(this.buttons.zoomInButton)
      this.store.getUIWrap().querySelector('.sw-imap-ui-bottom-right').appendChild(this.buttons.zoomOutButton)
    }
  }
  createScrollMessage() {
    let keyName = 'CTRL'
    if (this.mac) keyName = '⌘'

    let html = ''
    html += '<div class="sw-imap-ui-scroll-message-wrap">'
    html += '   <div class="sw-imap-ui-scroll-message-wrap-inner">'
    html += `       <div class="sw-imap-ui-scroll-message">Hold <div class="sw-imap-ui-scroll-message-button">${keyName}</div> to Zoom</div>`
    html += '   </div>'
    html += '</div>'

    this.scrollMessage = htmlToElement(html)
    this.store.getUIWrap().appendChild(this.scrollMessage)
  }
  displayScrollMessage() {
    this.scrollMessage.style.display = 'block'

    clearTimeout(this.showTimeout)
    clearTimeout(this.hideStartTimeout)
    clearTimeout(this.hideEndTimeout)

    this.showTimeout = setTimeout(() => {
      this.scrollMessage.classList.add('sw-imap-visible')
      this.hideStartTimeout = setTimeout(() => {
        this.scrollMessage.classList.remove('sw-imap-visible')
        this.hideEndTimeout = setTimeout(() => {
          this.scrollMessage.style.display = 'none'
        }, 250)
      }, 1000)
    }, 10)
  }

  // High level functions
  // called by user actions
  resetZoom(animate) {
    this.targetZoom = 1
    this.targetPanX = 0
    this.targetPanY = 0

    if (!animate) {
      this.currentZoom = 1
      this.actualPanX = 0
      this.actualPanY = 0
    }

    this.redraw({ animate: animate })
  }
  zoomIn({ coords, animate = true, targetZoom }) {
    // Check if it's possible to zoom further
    if (this.targetZoom < this.maxZoom) {
      // Adjust zoom
      let endZoom = targetZoom || this.currentZoom * this.zoomMultiplier

      // Focal point
      let zoomAtX = 0,
        zoomAtY = 0

      // If an event exists, it means that the zoom was triggered from the mouse wheel
      if (coords) {
        // Focal point is at event point, relative to the zoomed wrap
        zoomAtX = coords.x
        zoomAtY = coords.y
      } else {
        // Assume that the event happened at the center of the non-zoomed wrap
        zoomAtX = this.store.getCanvasWrapRect().offset.left + this.store.getCanvasWrapRect().width / 2
        zoomAtY = this.store.getCanvasWrapRect().offset.top + this.store.getCanvasWrapRect().height / 2
      }

      this.setTargetZoom({ zoom: endZoom, focalPointX: zoomAtX, focalPointY: zoomAtY, animate: animate })
    }
  }
  zoomOut({ coords, animate }) {
    // Check if it's possible to zoom further
    if (this.targetZoom > 1) {
      // Adjust zoom
      let targetZoom = this.currentZoom / this.zoomMultiplier

      // Focal point
      let zoomAtX = 0,
        zoomAtY = 0

      // If an event exists, it means that the zoom was triggered from the mouse wheel
      if (coords) {
        // Focal point is at event point, relative to the zoomed wrap
        zoomAtX = coords.x
        zoomAtY = coords.y
      } else {
        // Assume that the event happened at the center of the non-zoomed wrap
        zoomAtX = this.store.getCanvasWrapRect().offset.left + this.store.getCanvasWrapRect().width / 2
        zoomAtY = this.store.getCanvasWrapRect().offset.top + this.store.getCanvasWrapRect().height / 2
      }

      this.setTargetZoom({ zoom: targetZoom, focalPointX: zoomAtX, focalPointY: zoomAtY, animate: animate })
    }
  }
  startPan({ x, y }) {
    // Initial event coordinates
    this.ix = x
    this.iy = y

    // Cache the current pan
    this.initialPanX = this.actualPanX
    this.initialPanY = this.actualPanY
  }
  pan({ x, y }) {
    this.panDeltaX = this.ix - x
    this.panDeltaY = this.iy - y

    this.targetPanX = this.initialPanX - this.panDeltaX
    this.targetPanY = this.initialPanY - this.panDeltaY

    this.redraw({ animate: false })
  }
  startPinch(event) {
    this.pinchInitial[0] = { x: event.touches[0].pageX, y: event.touches[0].pageY }
    this.pinchInitial[1] = { x: event.touches[1].pageX, y: event.touches[1].pageY }

    this.initialPanX = this.actualPanX
    this.initialPanY = this.actualPanY

    this.ix = (event.touches[0].pageX + event.touches[1].pageX) / 2
    this.iy = (event.touches[0].pageY + event.touches[1].pageY) / 2

    this.lastX = this.ix
    this.lastY = this.iy

    this.pinchInitialDistance = Math.sqrt(
      Math.pow(this.pinchInitial[1].x - this.pinchInitial[0].x, 2) +
        Math.pow(this.pinchInitial[1].y - this.pinchInitial[0].y, 2)
    )
    this.pinchInitialZoom = this.currentZoom
  }
  pinch(event) {
    let eventX = (event.touches[0].pageX + event.touches[1].pageX) / 2
    let eventY = (event.touches[0].pageY + event.touches[1].pageY) / 2

    // Pan
    this.actualPanX += eventX - this.lastX
    this.actualPanY += eventY - this.lastY

    this.lastX = eventX
    this.lastY = eventY

    // Zoom
    let distance = Math.sqrt(
      Math.pow(event.touches[1].pageX - event.touches[0].pageX, 2) +
        Math.pow(event.touches[1].pageY - event.touches[0].pageY, 2)
    )
    let delta = distance / this.pinchInitialDistance

    this.setTargetZoom({ zoom: this.pinchInitialZoom * delta, focalPointX: eventX, focalPointY: eventY })
  }

  // Low level functions
  // calculate actual scale and translate values
  // and apply them
  setTargetPan({ x, y, redraw = true }) {
    // x and y are coordinates in pixels on the image map, AFTER the desired zoom is applied
    // from them we calculate the actual offset (panX, panY)
    let panX = -x + this.store.getCanvasWrapRect().width / 2
    let panY = -y + this.store.getCanvasWrapRect().height / 2

    this.targetPanX = panX
    this.targetPanY = panY

    if (redraw) this.redraw({ animate: true })
  }
  setTargetZoom({ zoom, focalPointX, focalPointY, animate = true, redraw = true }) {
    // focalPointX and focalPointY are coordinates, to which the zoom will move
    // but it will not hard pan to those coordinates

    // Stop interpolation at the actual pan
    this.targetPanX = this.actualPanX
    this.targetPanY = this.actualPanY

    // Limit the zoom level
    this.targetZoom = zoom
    if (this.targetZoom > this.maxZoom) this.targetZoom = this.maxZoom
    if (this.targetZoom < 1) this.targetZoom = 1

    // Calculate base zoom offset
    let baseOffsetX =
      (this.store.getCanvasWrapRect().width * this.targetZoom -
        this.store.getCanvasWrapRect().width * this.currentZoom) /
      2
    let baseOffsetY =
      (this.store.getCanvasWrapRect().height * this.targetZoom -
        this.store.getCanvasWrapRect().height * this.currentZoom) /
      2

    // Focal point
    if (focalPointX && focalPointY) {
      let scaleWrapRect = getElementRect(this.store.getScaleWrap())
      let fx = focalPointX - scaleWrapRect.offset.left
      let fy = focalPointY - scaleWrapRect.offset.top

      // Calculate focal offset
      let focalOffsetX =
        baseOffsetX *
        (((this.store.getCanvasWrapRect().width * this.currentZoom) / 2 - fx) /
          ((this.store.getCanvasWrapRect().width * this.currentZoom) / 2))
      let focalOffsetY =
        baseOffsetY *
        (((this.store.getCanvasWrapRect().height * this.currentZoom) / 2 - fy) /
          ((this.store.getCanvasWrapRect().height * this.currentZoom) / 2))

      this.targetPanX -= baseOffsetX
      this.targetPanY -= baseOffsetY
      this.targetPanX += focalOffsetX
      this.targetPanY += focalOffsetY
    }

    if (redraw) this.redraw({ animate: animate })
  }
  redraw({ animate = false }) {
    this.limit()
    this.interpolate(animate)

    // Let everyone know that zoom updated
    this.store.dispatch('zoomUpdate')

    // Draw
    this.store.getScaleWrap().style.transform = `scale(${this.currentZoom}, ${this.currentZoom})`
    this.store.getTranslateWrap().style.transform = `translate(${this.actualPanX}px, ${this.actualPanY}px)`

    // Repeat
    if (animate) {
      if (
        this.currentZoom != this.targetZoom ||
        this.actualPanX != this.targetPanX ||
        this.actualPanY != this.targetPanY
      ) {
        window.requestAnimationFrame(() => {
          this.redraw({ animate })
        })
      }
    }
  }
  setMaxZoom() {
    if (!this.store.state.zooming.enable_zooming) this.maxZoom = 1

    if (this.store.getImage() && this.store.state.zooming.limit_max_zoom_to_image_size) {
      this.maxZoom = this.store.getImage().naturalWidth / this.store.getCanvasWrapRect().width
    } else {
      this.maxZoom = this.store.state.zooming.max_zoom
    }
    if (this.maxZoom < 1) this.maxZoom = 1
  }

  // Redraw methods
  limit() {
    // Limit zoom level, actual pan and target pan
    this.minPanX = this.store.getCanvasWrapRect().width - this.store.getCanvasWrapRect().width * this.targetZoom
    this.minPanY = this.store.getCanvasWrapRect().height - this.store.getCanvasWrapRect().height * this.targetZoom

    if (this.targetPanX > 0) this.targetPanX = 0
    if (this.targetPanY > 0) this.targetPanY = 0
    if (this.targetPanX < this.minPanX) this.targetPanX = this.minPanX
    if (this.targetPanY < this.minPanY) this.targetPanY = this.minPanY
  }
  interpolate(animate) {
    if (animate) {
      this.currentZoom = lerp(this.currentZoom, this.targetZoom, 0.1)
      this.actualPanX = lerp(this.actualPanX, this.targetPanX, 0.1)
      this.actualPanY = lerp(this.actualPanY, this.targetPanY, 0.1)

      // Complete the interpolation if threshold is reached
      if (Math.abs(this.currentZoom - this.targetZoom) < 0.001) this.currentZoom = this.targetZoom
      if (Math.abs(this.actualPanX - this.targetPanX) < 1) this.actualPanX = this.targetPanX
      if (Math.abs(this.actualPanY - this.targetPanY) < 1) this.actualPanY = this.targetPanY
    } else {
      this.currentZoom = this.targetZoom
      this.actualPanX = this.targetPanX
      this.actualPanY = this.targetPanY
    }
  }
  updateStore() {}
}
