import { hexToRgb, htmlToElement, safeCssFilter, safeCssValue, safeLinkUrl } from 'imap-shared/utilities'
import MapObject from 'imap/UI/objects/mapObject'

export default class Spot extends MapObject {
  constructor(options, store) {
    super(options, store)
  }
  createElement() {
    let element = document.createElement('div')
    element.classList.add('sw-imap-object-spot')

    // A DOT (use_icon:false) may ring itself with an animated halo. The halo is a ::after on this
    // element, so it inherits the dot's own border colour and needs no extra node.
    if (!this.options.default_style.use_icon && this.options.default_style.pulse) {
      element.classList.add('sw-imap-object-pulse')
    }

    if (this.options.default_style.use_icon) {
      if (this.options.default_style.icon_is_pin) {
        element.classList.add('sw-imap-object-spot-pin')
      }

      // Icon
      if (this.options.default_style.icon_type === 'library') {
        let svg = htmlToElement(this.options.default_style.icon_svg)
        svg.style.width = `${this.options.default_style.icon_size}px`
        svg.style.height = `${this.options.default_style.icon_size}px`
        element.appendChild(svg)
      }

      if (this.options.default_style.icon_type === 'custom' && this.options.default_style.icon_url.length > 0) {
        // ★ setAttribute, not an interpolated markup string. Built as HTML, a URL carrying a quote
        // closed the attribute and added its own — `x" onerror="…` is a working handler. The server
        // also gates this value (image-map-embed safeAssetUrl); this is the second of the two ends.
        let img = document.createElement('img')
        img.setAttribute('src', safeLinkUrl(this.options.default_style.icon_url))
        img.style.width = `${this.options.default_style.icon_size}px`
        img.style.height = `${this.options.default_style.icon_size}px`
        element.appendChild(img)
      }

      // Shadow
      if (this.options.default_style.icon_shadow) {
        let shadowStyle = `width: ${this.options.default_style.icon_size}px;`
        shadowStyle += `height: ${this.options.default_style.icon_size}px;`
        shadowStyle += `left: 0;`
        shadowStyle += `top: ${this.options.default_style.icon_size / 2}px;`

        let shadowHtml = `<div style="${shadowStyle}" class="sw-imap-object-icon-shadow"></div>`
        element.appendChild(htmlToElement(shadowHtml))
      }
    }

    return element
  }
  createCSSRules(styles) {
    let css = ''

    css += `left: ${safeCssValue(this.options.x)}%;`
    css += `top: ${safeCssValue(this.options.y)}%;`

    // The spot is an icon
    if (this.options.default_style.use_icon) {
      css += `width: ${safeCssValue(this.options.default_style.icon_size)}px;`
      css += `height: ${safeCssValue(this.options.default_style.icon_size)}px;`

      if (this.options.default_style.icon_type === 'library') {
        let color_fill = hexToRgb(styles.icon_fill) || { r: 0, b: 0, g: 0 }
        css += `fill: rgba(${color_fill.r}, ${color_fill.g}, ${color_fill.b}, ${safeCssValue(styles.opacity)});`
      }

      let marginLeft = 0
      let marginTop = 0

      marginLeft = -this.options.default_style.icon_size / 2
      if (this.options.default_style.icon_is_pin) {
        marginTop = -this.options.default_style.icon_size
      } else {
        marginTop = -this.options.default_style.icon_size / 2
      }
      css += `margin-top: ${marginTop}px;`
      css += `margin-left: ${marginLeft}px;`

      if (this.options.default_style.icon_is_pin) {
        css += `transform-origin: 50% 100%;`
      } else {
        css += `transform-origin: 50% 50%;`
      }
    }

    // The spot is not an icon
    if (!this.options.default_style.use_icon) {
      css += `width: ${safeCssValue(this.options.width)}px;`
      css += `height: ${safeCssValue(this.options.height)}px;`

      let color_bg = hexToRgb(styles.background_color) || { r: 0, b: 0, g: 0 }
      let color_border = hexToRgb(styles.border_color) || { r: 0, b: 0, g: 0 }

      css += `opacity: ${safeCssValue(styles.opacity)};`
      css += `border-radius: ${safeCssValue(styles.border_radius)}px;`
      css += `background: rgba(${color_bg.r}, ${color_bg.g}, ${color_bg.b}, ${safeCssValue(styles.background_opacity)});`
      css += `border-width: ${safeCssValue(styles.border_width)}px;`
      css += `border-style: ${safeCssValue(styles.border_style)};`
      css += `border-color: rgba(${color_border.r}, ${color_border.g}, ${color_border.b}, ${safeCssValue(styles.border_opacity)});`

      css += `margin-top: ${(-safeCssValue(this.options.width) / 2)}px;`
      css += `margin-left: ${(-safeCssValue(this.options.height) / 2)}px;`
    }

    css += `filter: `
    for (let filter of styles.parent_filters) {
      css += safeCssFilter(filter)
    }
    css += `;`

    return css
  }
  getWidth() {
    return 0.01
  }
  getHeight() {
    return 0.01
  }
}