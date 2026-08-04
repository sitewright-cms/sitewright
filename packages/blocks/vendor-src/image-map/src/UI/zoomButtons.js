import * as icons from 'imap/UI/icons'
import { htmlToElement } from 'imap-shared/utilities'

export default class ZoomButtons {
  id = undefined
  textColor = undefined
  backgroundColor = undefined

  zoomInButton = undefined
  zoomOutButton = undefined

  constructor({ id }) {
    this.id = id
    this.createElements()
  }
  css() {
    return ''
  }
  html() {
    return {
      zoomInButton: `<div data-sw-imap-id="${this.id}" data-element-name="zoomInButton" class="sw-imap-ui-element sw-imap-ui-zoom-button sw-imap-ui-zoom-button-zoom-in" style="background: ${this.backgroundColor}">${icons.zoomIn.replace('<svg ', `<svg style="fill: ${this.textColor}" `)}</div>`,
      zoomOutButton: `<div data-sw-imap-id="${this.id}" data-element-name="zoomOutButton" class="sw-imap-ui-element sw-imap-ui-zoom-button sw-imap-ui-zoom-button-zoom-out" style="background: ${this.backgroundColor}">${icons.zoomOut.replace('<svg ', `<svg style="fill: ${this.textColor}" `)}</div>`
    }
  }
  createElements() {
    this.zoomInButton = htmlToElement(this.html().zoomInButton)
    this.zoomOutButton = htmlToElement(this.html().zoomOutButton)
  }
}