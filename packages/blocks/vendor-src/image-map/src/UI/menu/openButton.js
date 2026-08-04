import * as icons from 'imap/UI/icons'

export default class Button {
  element = document.createElement('div')

  constructor() {
    this.element.classList.add('sw-imap-ui-element')
    this.element.classList.add('sw-imap-menu-button')
    this.element.innerHTML = icons.bars
  }
}