import TooltipContent from 'imap/UI/tooltip/content/tooltipContent'
import { hexToRgb } from 'imap-shared/utilities'
import * as icons from 'imap/UI/icons'

export default class TooltipFullscreen {
  constructor({ style, content, animation, id }) {
    this.style = style
    this.content = new TooltipContent(content)
    this.animation = animation
    this.id = id
  }
  css() {
    let style = ''
    let color_bg = hexToRgb(this.style.background_color) || { r: 0, b: 0, g: 0 }

    style += `background: rgba(${color_bg.r}, ${color_bg.g}, ${color_bg.b}, ${this.style.background_opacity});`

    return style
  }
  html() {
    let html = ''

    html += ` <div class="sw-imap-fullscreen-tooltip" data-tooltip-id="${this.id}">
                <div class="sw-imap-tooltip-content" style="${this.css()}">${this.closeButtonHtml()}${this.content.html()}</div>
              </div>`

    return html
  }
  closeButtonHtml() {
    return `<div class="sw-imap-tooltip-close-button" data-close-button-tooltip-id="${this.id}">
      ${icons.close}
    </div>`
  }
}
