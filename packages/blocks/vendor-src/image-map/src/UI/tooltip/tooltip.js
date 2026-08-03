import { hexToRgb } from 'imap-shared/utilities'
import TooltipContent from 'imap/UI/tooltip/content/tooltipContent'

export default class Tooltip {
  constructor({ style, content, animation, id }) {
    this.id = id
    this.style = style
    this.content = new TooltipContent(content)
    this.animation = animation
  }
  css() {
    let style = ''
    let color_bg = hexToRgb(this.style.background_color) || { r: 0, b: 0, g: 0 }

    style += `border-radius: ${this.style.border_radius}px;`
    style += `padding: ${this.style.padding}px;`
    style += `background: rgba(${color_bg.r}, ${color_bg.g}, ${color_bg.b}, ${this.style.background_opacity});`

    if (!this.style.auto_width) {
      style += `width: ${this.style.width}px;`
    }

    return style
  }
  html() {
    let html = ''
    let color_bg = hexToRgb(this.style.background_color) || { r: 0, b: 0, g: 0 }

    html += `<div class="sw-imap-tooltip-wrap sw-imap-tooltip-position-${this.style.position}">`
    html += `<div class="sw-imap-tooltip" style="${this.css()}" data-tooltip-id="${this.id}">`

    if (this.style.position === 'top') {
      html += `<div class="hs-arrow hs-arrow-bottom" style="border-top-color: rgba(${color_bg.r}, ${color_bg.g}, ${color_bg.b}, ${this.style.background_opacity});"></div>`
    }
    if (this.style.position === 'bottom') {
      html += `<div class="hs-arrow hs-arrow-top" style="border-bottom-color: rgba(${color_bg.r}, ${color_bg.g}, ${color_bg.b}, ${this.style.background_opacity});"></div>`
    }
    if (this.style.position === 'left') {
      html += `<div class="hs-arrow hs-arrow-right" style="border-left-color: rgba(${color_bg.r}, ${color_bg.g}, ${color_bg.b}, ${this.style.background_opacity});"></div>`
    }
    if (this.style.position === 'right') {
      html += `<div class="hs-arrow hs-arrow-left" style="border-right-color: rgba(${color_bg.r}, ${color_bg.g}, ${color_bg.b}, ${this.style.background_opacity});"></div>`
    }

    html += `<div class="sw-imap-tooltip-content">${this.content.html()}</div>`
    html += '</div>'
    html += '</div>'

    return html
  }
}
