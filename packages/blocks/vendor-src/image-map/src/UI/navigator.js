import { htmlToElement, getElementRect } from 'imap-shared/utilities'

export default class Navigator {
  store = undefined
  image = undefined
  element = undefined

  // Update clip-path
  window = { width: 0, height: 0 }
  ratio = 1

  constructor(store) {
    this.store = store
    this.element = htmlToElement(this.html())
    this.image = this.element.querySelector('.sw-imap-ui-navigator-window-image')
  }
  html() {
    let html = `<div class="sw-imap-ui-element sw-imap-ui-navigator-root" data-element-name="navigator" data-sw-imap-id=${this.store.getID()}>`

    html += '<div class="sw-imap-ui-navigator-overlay"></div>'

    if (this.store.getArtboard().background_type === 'image') {
      html += `<img src="${this.store.getArtboard().image_url}" class="sw-imap-ui-navigator-window-image">`
      html += `<img src="${this.store.getArtboard().image_url}" class="sw-imap-ui-navigator-background-edgefill">`
      html += `<img src="${this.store.getArtboard().image_url}" class="sw-imap-ui-navigator-background">`
    }
    if (this.store.getArtboard().background_type === 'color') {
      html += `<div class="sw-imap-ui-navigator-window-image" style="background: ${this.store.getArtboard().background_color}"></div>`
      html += `<div class="sw-imap-ui-navigator-background-edgefill" style="background: ${this.store.getArtboard().background_color}"></div>`
      html += `<div class="sw-imap-ui-navigator-background" style="background: ${this.store.getArtboard().background_color}"></div>`
    }
    if (this.store.getArtboard().background_type === 'none') {
      html += `<div class="sw-imap-ui-navigator-window-image"></div>`
    }

    html += '</div>'

    return html
  }
  adjustSize() {
    let imageRatio = getElementRect(this.store.getCanvasWrap()).width / getElementRect(this.store.getCanvasWrap()).height

    if (imageRatio >= 1) {
      // Landscape
      this.window.width = 150
      this.window.height = this.window.width / imageRatio
    } else {
      // Portrait
      this.window.height = 150
      this.window.width = this.window.height * imageRatio
    }

    this.element.style.width = this.window.width + 'px'
    this.element.style.height = this.window.height + 'px'

    this.ratio = this.window.width / getElementRect(this.store.getCanvasWrap()).width
  }
  redraw() {
    let imageClipLeft = -this.store.getPan().x * this.ratio / this.store.getZoom()
    let imageClipRight = (this.store.getCanvasWrapRect().width * this.ratio) - (imageClipLeft + (this.window.width / this.store.getZoom()))
    let imageClipTop = -this.store.getPan().y * this.ratio / this.store.getZoom()
    let imageClipBottom = (this.store.getCanvasWrapRect().height * this.ratio) - (imageClipTop + (this.window.height / this.store.getZoom()))

    if (this.image) {
      this.image.style.clipPath = `inset(${imageClipTop}px ${imageClipRight}px ${imageClipBottom}px ${imageClipLeft}px)`
    }
  }
}