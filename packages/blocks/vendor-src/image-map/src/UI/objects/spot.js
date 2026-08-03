import MapObject from 'imap/UI/objects/mapObject'
import { htmlToElement, hexToRgb } from 'imap-shared/utilities'

export default class Spot extends MapObject {
  constructor(options, store) {
    super(options, store)
  }
  createElement() {
    let element = document.createElement('div')
    element.classList.add('sw-imap-object-spot')

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
        let iconHtml = `<img src="${this.options.default_style.icon_url}" style="width: ${this.options.default_style.icon_size}px; height: ${this.options.default_style.icon_size}px">`

        element.appendChild(htmlToElement(iconHtml))
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

    css += `left: ${this.options.x}%;`
    css += `top: ${this.options.y}%;`

    // The spot is an icon
    if (this.options.default_style.use_icon) {
      css += `width: ${this.options.default_style.icon_size}px;`
      css += `height: ${this.options.default_style.icon_size}px;`

      if (this.options.default_style.icon_type === 'library') {
        let color_fill = hexToRgb(styles.icon_fill) || { r: 0, b: 0, g: 0 }
        css += `fill: rgba(${color_fill.r}, ${color_fill.g}, ${color_fill.b}, ${styles.opacity});`
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
      css += `width: ${this.options.width}px;`
      css += `height: ${this.options.height}px;`

      let color_bg = hexToRgb(styles.background_color) || { r: 0, b: 0, g: 0 }
      let color_border = hexToRgb(styles.border_color) || { r: 0, b: 0, g: 0 }

      css += `opacity: ${styles.opacity};`
      css += `border-radius: ${styles.border_radius}px;`
      css += `background: rgba(${color_bg.r}, ${color_bg.g}, ${color_bg.b}, ${styles.background_opacity});`
      css += `border-width: ${styles.border_width}px;`
      css += `border-style: ${styles.border_style};`
      css += `border-color: rgba(${color_border.r}, ${color_border.g}, ${color_border.b}, ${styles.border_opacity});`

      css += `margin-top: ${(-this.options.width / 2)}px;`
      css += `margin-left: ${(-this.options.height / 2)}px;`
    }

    css += `filter: `
    for (let filter of styles.parent_filters) {
      css += `${filter.name}(${filter.value}) `
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