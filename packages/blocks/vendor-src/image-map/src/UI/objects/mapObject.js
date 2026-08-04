import { safeCssIdent, safeCssUrl, safeCssValue } from 'imap-shared/utilities'
import * as editorConsts from 'imap-shared/consts'

export default class MapObject {
  constructor(options, store) {
    this.options = options
    this.store = store

    // Parse options
    this.options.x = parseFloat(this.options.x)
    this.options.y = parseFloat(this.options.y)
    this.options.width = parseFloat(this.options.width)
    this.options.height = parseFloat(this.options.height)
    this.options.default_style.stroke_width = parseInt(this.options.default_style.stroke_width)
    this.options.mouseover_style.stroke_width = parseInt(this.options.mouseover_style.stroke_width)
    this.options.mouseover_style.background_type = this.options.default_style.background_type

    this.element = this.createElement()
    this.styles = this.createStyles() + this.createStyleExceptions()
    this.imageBackgroundElement = this.createImageBackgroundElement()
    this.slaves = []

    this.applyElementAttributes()

    // Deprecated
    // this.applyPageloadClass()
  }
  createElement() {
    // Implement in subclass
  }
  createStyles() {
    let defaultStyle = `[data-object-id="${this.options.id}"] {`
    defaultStyle += this.createCSSRules(this.options.default_style)
    defaultStyle += '} \n\n'

    let mouseoverStyle = `[data-object-id="${this.options.id}"].sw-imap-object-highlighted {`
    mouseoverStyle += this.createCSSRules(this.options.mouseover_style)
    mouseoverStyle += '} \n\n'

    return defaultStyle + mouseoverStyle
  }
  createCSSRules() {
    // Implement in subclass
    return ''
  }
  createStyleExceptions() {
    let css = ''

    // If the object has an image background
    if (this.options.default_style.background_type === 'image') {
      // Every interpolation here is config: the id lands in a SELECTOR, the url in a url() that
      // safeCssValue would otherwise strip, and the rest in ordinary declarations.
      css += `#sw-imap-image-backgrounds-${safeCssIdent(this.store.getID())} [data-object-id="${safeCssIdent(this.options.id)}"] {`
      const bg = safeCssUrl(this.options.default_style.background_image_url)
      if (bg) css += `background-image: ${bg};`
      css += `opacity:${safeCssValue(this.options.default_style.background_image_opacity)};`
      css += `transform: scale(${safeCssValue(this.options.default_style.background_image_scale)}) translate(${safeCssValue(this.options.default_style.background_image_offset_x)}px, ${safeCssValue(this.options.default_style.background_image_offset_y)}px);`
      css += `}`
    }

    // If the object is a spot and is using an SVG icon
    // if (this.options.type === editorConsts.OBJECT_SPOT) {
    //   css += `[data-object-id="${this.options.id}"] path {`
    //   css += `fill: ${this.options.default_style.icon_fill}`
    //   css += `}`
    // }

    // // If the object is a spot and is using an SVG icon (mouseover)
    // if (this.options.type === editorConsts.OBJECT_SPOT) {
    //   css += `.sw-imap-object-highlighted[data-object-id="${this.options.id}"] path {`
    //   css += `fill: ${this.options.mouseover_style.icon_fill}`
    //   css += `}`
    // }

    return css
  }
  createImageBackgroundElement() {
    let div = document.createElement('div')

    if (this.options.default_style.background_type === 'image' && this.options.default_style.background_image_url) {
      div.style.left = this.options.x + this.options.default_style.background_image_offset_x + '%'
      div.style.top = this.options.y + this.options.default_style.background_image_offset_y + '%'
      div.style.width = this.options.width + '%'
      div.style.height = this.options.height + '%'

      div.style.backgroundImage = `url(${this.options.default_style.background_image_url})`
      div.style.opacity = this.options.default_style.background_image_opacity
      div.style.transform = `scale(${this.options.default_style.background_image_scale})`

      div.classList.add('sw-imap-object-background-image')
      div.dataset.imageBackgroundObjectId = this.options.id
    }

    return div
  }
  applyElementAttributes() {
    // Does the object have a static parent?
    if (this.options.parent_id && this.store.getObject({ id: this.options.parent_id }).static)
      this.options.static = true

    // Is object static?
    if (this.options.static) {
      this.element.classList.add('sw-imap-object-static')
    }

    // Build the element
    this.element.classList.add('sw-imap-object')
    this.element.setAttribute('data-object-id', this.options.id)
    if (this.options.parent_id) this.element.setAttribute('data-parent-id', this.options.parent_id)
    this.element.setAttribute('data-title', this.options.title)
    this.element.setAttribute('data-sw-imap-id', this.store.getID())
  }
  // Deprecated
  // applyPageloadClass() {
  // if (this.store.state.objectConfig.pageload_animation === 'grow') {
  //   this.element.classList.add('sw-imap-pageload-animation-grow')
  // }
  // if (this.store.state.objectConfig.pageload_animation === 'fade') {
  //   this.element.classList.add('sw-imap-pageload-animation-fade-in')
  // }
  // if (this.store.state.objectConfig.pageload_animation === 'fall-down') {
  //   this.element.classList.add('sw-imap-pageload-animation-fall-down')
  // }
  // }

  getHighlightIds() {
    if (this.options.parent_id) {
      return this.store.getChildrenDeep({ id: this.options.parent_id }).map((obj) => obj.id)
    } else {
      return [this.options.id]
    }
  }
  highlight() {
    this.element.classList.add('sw-imap-object-highlighted')

    if (this.options.mouseover_style.background_type === 'image') {
      this.imageBackgroundElement.style.backgroundImage = `url("${this.options.mouseover_style.background_image_url}")`
      this.imageBackgroundElement.style.opacity = this.options.mouseover_style.background_image_opacity
      this.imageBackgroundElement.style.transform = `scale(${this.options.mouseover_style.background_image_scale})`
      this.imageBackgroundElement.style.left =
        this.options.x + this.options.mouseover_style.background_image_offset_x + '%'
      this.imageBackgroundElement.style.top =
        this.options.y + this.options.mouseover_style.background_image_offset_y + '%'
    }
  }
  unhighlight() {
    this.element.classList.remove('sw-imap-object-highlighted')

    if (this.options.default_style.background_type === 'image') {
      this.imageBackgroundElement.style.backgroundImage = `url("${this.options.default_style.background_image_url}")`
      this.imageBackgroundElement.style.opacity = this.options.default_style.background_image_opacity
      this.imageBackgroundElement.style.transform = `scale(${this.options.default_style.background_image_scale})`
      this.imageBackgroundElement.style.left =
        this.options.x + this.options.default_style.background_image_offset_x + '%'
      this.imageBackgroundElement.style.top =
        this.options.y + this.options.default_style.background_image_offset_y + '%'
    }
  }
  getRect() {
    if (this.options.type === editorConsts.OBJECT_SPOT) {
      let w = (this.options.default_style.icon_size / this.store.getCanvasWrapRect().width) * 100
      let h = (this.options.default_style.icon_size / this.store.getCanvasWrapRect().height) * 100

      if (this.options.default_style.use_icon && this.options.default_style.icon_is_pin) {
        return {
          x: this.options.x - w / 2,
          y: this.options.y - h,
          width: w,
          height: h,
        }
      } else {
        return {
          x: this.options.x - w / 2,
          y: this.options.y - h / 2,
          width: w,
          height: h,
        }
      }
    }
    return {
      x: this.options.x,
      y: this.options.y,
      width: this.options.width,
      height: this.options.height,
    }
  }
  getBoundingClientRect() {
    let rect = this.element.getBoundingClientRect()
    return rect
  }
  stopGlowing() {
    this.element.classList.remove('sw-imap-glowing-object')
  }
}
