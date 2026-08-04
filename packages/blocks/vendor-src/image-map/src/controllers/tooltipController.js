import { getElementRect, hexToRgb, isMobile, isPointInsidePolygon } from 'imap-shared/utilities'
import * as consts from 'imap/consts'
import * as editorConsts from 'imap-shared/consts'
import Tooltip from 'imap/UI/tooltip/tooltip'
import TooltipFullscreen from 'imap/UI/tooltip/tooltipFullscreen'
import { trigger } from 'imap/runtime'

/*

Controls everything related to tooltips, like creating, showing, hiding, calculating properties, etc

*/

export default class TooltipController {
  store = undefined
  tooltipsAreFullscreen = false

  // The tooltip container
  container = document.createElement('div')

  // Current mouse coords
  // used to update tooltip position
  mouseCoords = { x: 0, y: 0 }

  // Array containing all Tooltip objects
  tooltips = []

  // Array containing indices of opened tooltips
  openedTooltips = new Set()

  // Allows to temporarily disable sticky tooltips
  stickyTooltips = undefined

  // Cache for quick calculations
  tooltipElements = {}

  // Timeouts for the tooltip in/out animation
  tooltipAnimationTimeouts = {}

  bodyOverflow = undefined

  constructor(store) {
    this.store = store

    if (!this.store.state.tooltips.enable_tooltips) return

    this.store.subscribe(this.handleAction.bind(this))

    // This is needed to enable and reset sticky tooltips by the API and the event controller
    this.stickyTooltips = this.store.state.tooltips.sticky_tooltips
    if (isMobile()) {
      this.stickyTooltips = false
    }

    // No sticky tooltips on mobile!
    if (isMobile()) {
      this.disableStickyTooltips()
    }

    // Fullscreen tooltips flag
    if (this.store.state.tooltips.fullscreen_tooltips === 'always' || (this.store.state.tooltips.fullscreen_tooltips === 'mobile-only' && isMobile())) {
      this.tooltipsAreFullscreen = true
    }

    this.setupContainer()
    this.createTooltips()
  }
  async handleAction(action) {
    if (action.type === 'updateTooltipPositions') {
      this.updateAllTooltipPositions()
    }
    if (action.type === 'closeFullscreenTooltip') {
      this.hideAllTooltips()
    }
    if (action.type === 'zoomUpdate') {
      this.updateAllTooltipPositions()
    }
  }
  disableStickyTooltips() {
    this.stickyTooltips = false
  }
  resetStickyTooltips() {
    if (isMobile()) return
    this.stickyTooltips = this.store.state.tooltips.sticky_tooltips
  }

  // Create various elements
  setupContainer() {
    // Drop the container left by a previous init of THIS map. Scoped to the map's own root:
    // upstream searched the whole document by map id, so two maps whose configs shared an id —
    // which is the default, `id: 0` — meant the second one's init deleted the first one's
    // tooltips. Containment is the fix; the ids being unique is then just a nicety.
    this.store
      .getImageMap()
      .root.querySelectorAll('.sw-imap-tooltips-container')
      .forEach((el) => el.remove())

    // Create new container
    this.container.classList.add('sw-imap-tooltips-container')
    this.container.dataset.swImapId = this.store.getID()

    // Add display:block to the container in case another plugin tries to hide it
    this.container.style.setProperty('display', 'block', 'important')
    this.container.style.setProperty('pointer-events', 'none', 'important')

    // If tooltips are fullscreen, add class to the container
    if (this.tooltipsAreFullscreen) {
      this.container.classList.add('is-fullscreen')
      let color_bg = hexToRgb(this.store.state.tooltips.fullscreen_background) || { r: 0, b: 0, g: 0 }
      this.container.style.background = `rgba(${color_bg.r}, ${color_bg.g}, ${color_bg.b}, ${this.store.state.tooltips.fullscreen_background_opacity})`
    }
  }
  createTooltips() {
    let html = ''

    for (let obj of this.store.getObjects()) {
      if (obj.parent) obj = this.store.getObject({ id: obj.parent })

      if (!obj.tooltip.enable_tooltip) continue

      // Text objects don't have tooltips
      if (obj.type === editorConsts.OBJECT_TEXT) continue

      // Create a Tooltip object
      let tooltip = undefined
      if (this.tooltipsAreFullscreen) {
        tooltip = new TooltipFullscreen({
          style: obj.tooltip_style,
          content: obj.tooltip_content,
          animation: this.store.state.tooltips.tooltip_animation,
          id: obj.id,
        })
      } else {
        tooltip = new Tooltip({
          style: obj.tooltip_style,
          content: obj.tooltip_content,
          animation: this.store.state.tooltips.tooltip_animation,
          id: obj.id,
          title: obj.title,
        })
      }

      // Store the tooltip object for future reference
      this.tooltips[obj.id] = tooltip

      // Get html
      html += tooltip.html()
    }

    // Add the tooltips to the container
    this.container.innerHTML = html

    // Sticky tooltips class
    if (this.stickyTooltips) {
      this.container.classList.add('sw-imap-sticky-tooltips')
    }

    // Clear cache
    this.tooltipElements = {}
  }
  getTooltipElement(id) {
    id = this.store.getObject({ id }).parent || id

    // Cache
    if (!this.tooltipElements[id]) {
      this.tooltipElements[id] = this.container.querySelector(`[data-tooltip-id="${id}"]`)
    }

    return this.tooltipElements[id]
  }

  // Show/hide tooltips
  showTooltip(id) {
    // if (window.startchanging) debugger
    id = this.store.getObject({ id }).parent || id

    // Check if tooltip element exists
    if (!this.getTooltipElement(id)) return

    // Check if object exists
    if (!this.store.getObject({ id })) return

    // Not an async executor: the body awaits nothing, and `resolve` is handed to
    // requestAnimationFrame so the promise settles once the tooltip has been laid out.
    return new Promise((resolve) => {
      let object = this.store.getObject({ id })

      // If the object doesn't have tooltip enabled, then return
      if (!object.tooltip.enable_tooltip) {
        resolve()
        return
      }

      // i = the index of the tooltip
      if (object.type === editorConsts.OBJECT_TEXT) {
        resolve()
        return
      }

      // If the tooltip is already visible, then return
      if (this.openedTooltips.has(id)) {
        resolve()
        return
      }

      // Add tooltip to the list of opened tooltips
      this.openedTooltips.add(id)

      // Show fullscreen or normal tooltips
      if ((this.store.state.tooltips.fullscreen_tooltips === 'mobile-only' && isMobile()) || this.store.state.tooltips.fullscreen_tooltips === 'always') {
        // Fullscreen tooltips
        this.animateFullscreenTooltipIn(id)
        requestAnimationFrame(resolve)
      } else {
        // Normal tooltips
        let el = this.getTooltipElement(id)
        clearTimeout(this.tooltipAnimationTimeouts[id])
        el.style.display = 'inline-block'
        el.style.transitionProperty = 'none'
        el.style.transform = 'none'
        this.updateTooltipPosition(id)
        this.animateTooltipIn(id)
        requestAnimationFrame(resolve)
      }

      // Send event
      trigger({
        type: consts.HOOK_TOOLTIP_SHOW,
        payload: {
          map: this.store.state.general.name,
          object: this.store.getObject({ id }).title,
        },
      })
    })
  }
  hideTooltip(id) {
    id = this.store.getObject({ id }).parent || id

    return new Promise((resolve) => {
      let object = this.store.getObject({ id })
      if (object.type === editorConsts.OBJECT_TEXT) {
        resolve()
        return
      }

      // Remove from the list of opened tooltips
      if (!this.openedTooltips.has(id)) {
        resolve()
        return
      } else {
        this.openedTooltips.delete(id)
      }

      // Hide mobile tooltip
      if ((this.store.state.tooltips.fullscreen_tooltips === 'mobile-only' && isMobile()) || this.store.state.tooltips.fullscreen_tooltips === 'always') {
        this.animateFullscreenTooltipOut(id)
        requestAnimationFrame(resolve)
      } else {
        // Hide normal tooltip
        this.animateTooltipOut(id)
        requestAnimationFrame(resolve)
      }

      // Send event
      trigger({
        type: consts.HOOK_TOOLTIP_HIDE,
        payload: {
          map: this.store.state.general.name,
          object: this.store.getObject({ id }).title,
        },
      })
    })
  }
  hideAllTooltips() {
    return new Promise((resolve) => {
      this.openedTooltips.forEach((id) => this.hideTooltip(id))
      requestAnimationFrame(resolve)
    })
  }
  updateTooltipPosition(id) {
    if (this.tooltipsAreFullscreen) return
    id = this.store.getObject({ id }).parent || id

    let tooltipEl = this.getTooltipElement(id)
    let objectRect = this.getObjectVisibleRect(id)

    let distance = 20
    let tooltipRect = tooltipEl.getBoundingClientRect()

    // Calculate and set the position
    let pos = { x: 0, y: 0 }
    if (this.tooltips[id].style.position === 'left') {
      pos.x = objectRect.x - distance - tooltipRect.width
      pos.y = objectRect.y + objectRect.height / 2 - tooltipRect.height / 2
    }
    if (this.tooltips[id].style.position === 'right') {
      pos.x = objectRect.x + objectRect.width + distance
      pos.y = objectRect.y + objectRect.height / 2 - tooltipRect.height / 2
    }
    if (this.tooltips[id].style.position === 'top') {
      pos.x = objectRect.x + objectRect.width / 2 - tooltipRect.width / 2
      pos.y = objectRect.y - distance - tooltipRect.height
    }
    if (this.tooltips[id].style.position === 'bottom') {
      pos.x = objectRect.x + objectRect.width / 2 - tooltipRect.width / 2
      pos.y = objectRect.y + objectRect.height + distance
    }

    // Apply offset
    pos.x += (this.tooltips[id].style.offset_x / 100) * this.store.getCanvasWrapRect().width
    pos.y += (this.tooltips[id].style.offset_y / 100) * this.store.getCanvasWrapRect().height

    // Set
    tooltipEl.parentNode.style.left = pos.x + this.store.getCanvasWrapRect().offset.left - this.store.getTooltipsContainerRect().offset.left + 'px'
    tooltipEl.parentNode.style.top = pos.y + this.store.getCanvasWrapRect().offset.top - this.store.getTooltipsContainerRect().offset.top + 'px'

    // Constrain
    if (this.store.state.tooltips.constrain_tooltips) {
      tooltipRect = tooltipEl.getBoundingClientRect()

      if (tooltipRect.x < 0) pos.x -= tooltipRect.x
      if (tooltipRect.y < 0) pos.y -= tooltipRect.y
      if (tooltipRect.x + tooltipRect.width > window.innerWidth) pos.x += window.innerWidth - (tooltipRect.x + tooltipRect.width)
      if (tooltipRect.y + tooltipRect.height > window.innerHeight) pos.y += window.innerHeight - (tooltipRect.y + tooltipRect.height)

      tooltipEl.parentNode.style.left = pos.x + this.store.getCanvasWrapRect().offset.left - this.store.getTooltipsContainerRect().offset.left + 'px'
      tooltipEl.parentNode.style.top = pos.y + this.store.getCanvasWrapRect().offset.top - this.store.getTooltipsContainerRect().offset.top + 'px'
    }
  }
  updateAllTooltipPositions() {
    for (let tooltipIndex of this.openedTooltips) {
      this.updateTooltipPosition(tooltipIndex)
    }
  }
  animateTooltipIn(id) {
    let el = this.getTooltipElement(id)

    if (this.store.state.tooltips.sticky_tooltips) {
      el.style.opacity = 1
      return
    }

    if (this.store.state.tooltips.tooltip_animation === 'grow') {
      el.style.transitionProperty = 'none'
      el.style.transform = 'scale(0, 0)'
      el.style.opacity = 1
      clearTimeout(this.tooltipAnimationTimeouts[id])
      this.tooltipAnimationTimeouts[id] = requestAnimationFrame(() => {
        el.style.transitionProperty = 'transform'
        el.style.transform = 'scale(1, 1)'
      })

      return
    }

    if (this.store.state.tooltips.tooltip_animation === 'fade') {
      el.style.transitionProperty = 'none'
      el.style.opacity = 0
      clearTimeout(this.tooltipAnimationTimeouts[id])
      this.tooltipAnimationTimeouts[id] = requestAnimationFrame(() => {
        el.style.transitionProperty = 'opacity'
        el.style.opacity = 1
      })

      return
    }

    el.style.opacity = 1
  }
  animateTooltipOut(id) {
    let tooltip = this.getTooltipElement(id)

    // Stop all videos
    tooltip.querySelectorAll('video').forEach(function (element) {
      element.dispatchEvent(new Event('pause'))
    })
    tooltip.querySelectorAll('iframe').forEach(function (element) {
      element.setAttribute('src', element.getAttribute('src'))
    })

    if (this.store.state.tooltips.sticky_tooltips) {
      tooltip.style.opacity = 0
      tooltip.style.display = 'none'
      return
    }

    if (this.store.state.tooltips.tooltip_animation === 'grow') {
      tooltip.style.transform = 'scale(0, 0)'
      clearTimeout(this.tooltipAnimationTimeouts[id])
      this.tooltipAnimationTimeouts[id] = setTimeout(() => {
        tooltip.style.opacity = 0
        tooltip.style.display = 'none'
      }, 200)

      return
    }

    if (this.store.state.tooltips.tooltip_animation === 'fade') {
      tooltip.style.opacity = 0
      tooltip.style.display = 'none'
      return
    }

    tooltip.style.opacity = 0
    tooltip.style.display = 'none'
  }
  animateFullscreenTooltipIn(id) {
    // Container
    this.container.style.display = 'block'
    this.container.style.opacity = 1

    // Tooltip
    let tooltip = this.getTooltipElement(id)
    tooltip.style.display = 'flex'
    tooltip.style.opacity = 0
    tooltip.style.transform = 'scale(0.33)'
    requestAnimationFrame(() => {
      tooltip.style.opacity = 1
      tooltip.style.transform = 'scale(1)'
    })

    // Prevent scrolling of the body and store the original overflow attribute value
    this.bodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  animateFullscreenTooltipOut(id) {
    // Container
    this.container.style.opacity = 0
    clearTimeout(this.tooltipAnimationTimeouts[id + '-container'])
    this.tooltipAnimationTimeouts[id + '-container'] = setTimeout(() => {
      this.container.style.display = 'none'
    }, 350)

    // Tooltip
    let tooltip = this.getTooltipElement(id)
    tooltip.style.opacity = 0
    tooltip.style.transform = 'scale(0.33)'
    clearTimeout(this.tooltipAnimationTimeouts[id])
    this.tooltipAnimationTimeouts[id] = setTimeout(() => {
      tooltip.style.display = 'none'
    }, 350)

    // Stop all videos
    tooltip.querySelectorAll('video').forEach(function (element) {
      element.dispatchEvent(new Event('pause'))
    })
    tooltip.querySelectorAll('iframe').forEach(function (element) {
      element.setAttribute('src', element.getAttribute('src'))
    })

    // Restore original body overflow
    document.body.style.overflow = this.bodyOverflow
  }

  // Calcs
  isPointInsideVisibleTooltip({ x, y }) {
    // If a fullscreen tooltip is open, return true
    if (this.tooltipsAreFullscreen && this.openedTooltips.size > 0) {
      return true
    }

    for (let id of this.openedTooltips) {
      let polys = this.createPolysForTooltip(id)
      if (this.stickyTooltips) {
        if (isPointInsidePolygon(x, y, polys.polyTooltipOnly)) {
          return true
        }
      } else {
        if (isPointInsidePolygon(x, y, polys.poly) || isPointInsidePolygon(x, y, polys.polyTooltipOnly)) {
          return true
        }
      }
    }

    return false
  }
  createPolysForTooltip(id) {
    id = this.store.getObject({ id }).parent || id

    // Used when calculating the poly size
    // need to use getBoundingClientRect() because element.offsetWidth is undefined?
    // window scroll must be added, because the mouse coordiates and the tooltip's rect includes scroll
    let objectRect = this.store.getObjectController().objects[id].getBoundingClientRect()
    let objectCenterX = objectRect.x + window.scrollX + objectRect.width / 2
    let objectCenterY = objectRect.y + window.scrollY + objectRect.height / 2

    // Cache tooltip dimensions and coords
    let tooltipRect = getElementRect(this.getTooltipElement(id))
    let tx = tooltipRect.offset.left
    let ty = tooltipRect.offset.top
    let tw = tooltipRect.offsetWidth
    let th = tooltipRect.offsetHeight

    // Create a polygon, representing the tooltip area + buffer space
    // Poly without buffer is needed, in case the tooltip gets moved due to window constrain
    // and the object center ends up inside the tooltip
    let poly = []
    let polyTooltipOnly = []

    if (this.store.getObject({ id }).tooltip_style.position === 'top') {
      poly = [
        [tx, ty],
        [tx + tw, ty],
        [tx + tw, ty + th],
        [tx + tw / 2, objectCenterY],
        [tx, ty + th],
      ]
      polyTooltipOnly = [
        [tx, ty],
        [tx + tw, ty],
        [tx + tw, ty + th],
        [tx, ty + th],
      ]
    }
    if (this.store.getObject({ id }).tooltip_style.position === 'bottom') {
      poly = [
        [tx, ty],
        [tx + tw / 2, objectCenterY],
        [tx + tw, ty],
        [tx + tw, ty + th],
        [tx, ty + th],
      ]
      polyTooltipOnly = [
        [tx, ty],
        [tx + tw, ty],
        [tx + tw, ty + th],
        [tx, ty + th],
      ]
    }
    if (this.store.getObject({ id }).tooltip_style.position === 'left') {
      poly = [
        [tx, ty],
        [tx + tw, ty],
        [objectCenterX, ty + th / 2],
        [tx + tw, ty + th],
        [tx, ty + th],
      ]
      polyTooltipOnly = [
        [tx, ty],
        [tx + tw, ty],
        [tx + tw, ty + th],
        [tx, ty + th],
      ]
    }
    if (this.store.getObject({ id }).tooltip_style.position === 'right') {
      poly = [
        [tx, ty],
        [tx + tw, ty],
        [tx + tw, ty + th],
        [tx, ty + th],
        [objectCenterX, ty + th / 2],
      ]
      polyTooltipOnly = [
        [tx, ty],
        [tx + tw, ty],
        [tx + tw, ty + th],
        [tx, ty + th],
      ]
    }

    return { poly, polyTooltipOnly }
  }
  getObjectVisibleRect(id) {
    if (!this.store.getObjectController().objects[id]) return

    let sx
    let sy
    let sw
    let sh

    let object = this.store.getObject({ id })
    let objectRect = this.store.getObjectController().objects[id].getRect()

    let windowWidth = window.innerWidth
    let windowHeight = window.innerHeight

    if (this.stickyTooltips) {
      // Sticky tooltips
      // Set width/height of the shape to 0
      // and X and Y to the mouse coordinates
      sx = this.store.getEventCoordinates().x - this.store.getCanvasWrapRect().offset.left
      sy = this.store.getEventCoordinates().y - this.store.getCanvasWrapRect().offset.top

      sw = 0
      sh = 0
    } else {
      sw = (objectRect.width / 100) * this.store.getCanvasWrapRect().width
      sh = (objectRect.height / 100) * this.store.getCanvasWrapRect().height

      sw = sw * this.store.getZoom()
      sh = sh * this.store.getZoom()

      sx = (objectRect.x / 100) * this.store.getCanvasWrapRect().width
      sy = (objectRect.y / 100) * this.store.getCanvasWrapRect().height

      sx = sx * this.store.getZoom() + this.store.getPan().x
      sy = sy * this.store.getZoom() + this.store.getPan().y
    }

    if (object.type === editorConsts.OBJECT_SPOT && this.store.state.objectConfig.scale_spots) {
      let scaledWidth = sw / this.store.getZoom()
      let scaledHeight = sh / this.store.getZoom()
      sx += sw / 2 - scaledWidth / 2

      if (object.default_style.use_icon && object.default_style.icon_is_pin) {
        sy += sh - scaledHeight
      } else {
        sy += sh / 2 - scaledHeight / 2
      }

      sw = scaledWidth
      sh = scaledHeight
    }

    // Limit the rect of the object to the bounds of the wrap
    if (this.store.getIsFullscreen() && this.store.state.tooltips.constrain_tooltips) {
      // In fullscreen mode compensate for the scroll
      let canvasOffsetLeft = this.store.getCanvasWrapRect().offset.left - window.scrollX
      let canvasOffsetTop = this.store.getCanvasWrapRect().offset.top - window.scrollY

      if (sx + canvasOffsetLeft < 0) {
        sw = sw + sx + canvasOffsetLeft
        sx = -canvasOffsetLeft
      }
      if (sx + canvasOffsetLeft + sw > windowWidth) {
        sw += windowWidth - (sx + canvasOffsetLeft + sw)
      }
      if (sy + canvasOffsetTop < 0) {
        sh = sh + sy + canvasOffsetTop
        sy = -canvasOffsetTop
      }
      if (sy + canvasOffsetTop + sh > windowHeight) {
        sh += windowHeight - (sy + canvasOffsetTop + sh)
      }
    } else {
      if (sx < 0) {
        sw = sw + sx
        sx = 0
      }
      if (sx + sw > this.store.getCanvasWrapRect().width) {
        sw = this.store.getCanvasWrapRect().width - sx
      }
      if (sy < 0) {
        sh = sh + sy
        sy = 0
      }
      if (sy + sh > this.store.getCanvasWrapRect().height) {
        sh = this.store.getCanvasWrapRect().height - sy
      }
    }

    return {
      x: sx,
      y: sy,
      width: sw,
      height: sh,
    }
  }
}
