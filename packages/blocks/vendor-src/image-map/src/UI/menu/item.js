import * as icons from 'imap/UI/icons'

export default class Item {
  element = document.createElement('div')
  options = undefined
  depth = 0
  visible = true
  isGroup = false
  iconElement = document.createElement('div')

  constructor({ options, isGroup, depth, imageMapId }) {
    this.options = options
    this.depth = depth
    this.isGroup = isGroup

    this.element.classList.add('sw-imap-object-list-item')
    if (isGroup) this.element.classList.add('sw-imap-object-list-item-group')
    this.element.dataset.listItemId = this.options.id
    this.element.dataset.swImapId = imageMapId

    if (depth > 0) {
      this.element.style.marginLeft = 25 + (depth - 1) * 22 + 'px'
      this.element.style.borderLeft = '1px solid #eee'
    }

    if (this.isGroup) {
      this.iconElement.classList.add('sw-imap-object-list-item-folder-icon')
      this.element.appendChild(this.iconElement)
    }

    let p = document.createElement('p')
    // textContent, not innerHTML: an object title is plain text, and it comes from the config.
    p.textContent = this.options.title
    this.element.appendChild(p)

    this.openFolder()
    this.redraw()
  }
  show() {
    this.visible = true
    this.redraw()
  }
  hide() {
    this.visible = false
    this.redraw()
  }
  openFolder() {
    this.iconElement.innerHTML = icons.caretDown
  }
  closeFolder() {
    this.iconElement.innerHTML = icons.caretRight
  }
  redraw() {
    if (this.visible) this.element.classList.remove('sw-imap-object-list-item-hidden')
    if (!this.visible) this.element.classList.add('sw-imap-object-list-item-hidden')
  }
}