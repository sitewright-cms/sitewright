import * as icons from 'imap/UI/icons'
import { htmlToElement } from 'imap-shared/utilities'

export default class ArtboardMenu {
  element = undefined
  store = undefined

  constructor(store) {
    this.store = store
    this.element = htmlToElement(this.html())
  }
  html() {
    let html = ``

    html += '<div class="sw-imap-ui-layers-menu-wrap" data-element-name="layersSelect">'
    html += icons.arrowDown
    html += '   <select class="sw-imap-ui-element sw-imap-ui-layers-select">'

    for (let artboard of this.store.getArtboards()) {
      html += `<option value="${artboard.id}">${artboard.title}</option>`
    }

    html += '   </select>'
    html += '</div>'

    return html
  }
  selectArtboard(value) {
    this.element.querySelector('select').value = value
  }
}