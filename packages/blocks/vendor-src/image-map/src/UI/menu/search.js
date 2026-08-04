import { htmlToElement } from 'imap-shared/utilities'
import * as icons from 'imap/UI/icons'

export default class Search {
  element = undefined
  input = undefined

  constructor() {
    this.element = htmlToElement(this.html())
    this.input = this.element.querySelector('input')
  }
  html() {
    let html = `
      <div class="sw-imap-search-box">
        <div class="sw-imap-search-box-input-wrap">
          <input type="text" placeholder="Search...">
          ${icons.search.replace('sw-imap-icon', 'sw-imap-icon sw-imap-search')}
          ${icons.close.replace('sw-imap-icon', 'sw-imap-icon sw-imap-clear-search')}
        </div>
      </div>`
    return html
  }
  redraw() {
    if (this.input.value) {
      this.element.classList.add('sw-imap-searching')
    } else {
      this.element.classList.remove('sw-imap-searching')
    }
  }
  clear() {
    this.input.value = ''
  }
}