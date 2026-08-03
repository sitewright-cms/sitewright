import { htmlToElement } from 'imap-shared/utilities'
import * as icons from 'imap/UI/icons'

export default class FullscreenButton {
  constructor({ mapID, isFullscreen }) {
    this.mapID = mapID
    this.isFullscreen = isFullscreen

    // Create the HTML element
    this.element = htmlToElement(this.html())
  }
  icon() {
    if (this.isFullscreen) {
      return icons.closeFullscreen
    } else {
      return icons.goFullscreen
    }
  }
  css() {
    return ''
  }
  html() {
    // HTML
    let html = `<div data-sw-imap-id="${this.mapID}" data-element-name="fullscreenButton" style="${this.css()}" class="sw-imap-ui-element sw-imap-fullscreen-button">${this.icon()}</div>`

    return html
  }
}