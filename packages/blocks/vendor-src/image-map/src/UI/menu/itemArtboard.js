import { htmlToElement } from 'imap-shared/utilities'
import * as icons from 'imap/UI/icons'

export default class ItemArtboard {
  element = document.createElement('div')
  options = undefined

  constructor({ options, imageMapId }) {
    this.options = options
    this.element.classList.add('sw-imap-object-list-item-artboard')
    this.element.dataset.listItemId = this.options.id
    this.element.dataset.swImapId = imageMapId

    let span = document.createElement('span')
    // textContent, not innerHTML — see the note in item.js.
    span.textContent = this.options.title

    let arrow = htmlToElement(icons.arrowDown)

    this.element.appendChild(span)
    this.element.appendChild(arrow)
  }
  expand() {
    this.element.classList.remove('sw-imap-collapsed-artboard-item')
  }
  collapse() {
    this.element.classList.add('sw-imap-collapsed-artboard-item')
  }
}