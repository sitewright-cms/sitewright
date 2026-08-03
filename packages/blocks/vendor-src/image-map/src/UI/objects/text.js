import { hexToRgb, getElementRect } from 'imap-shared/utilities'

import MapObject from 'imap/UI/objects/mapObject'

export default class Text extends MapObject {
  constructor(options, store) {
    super(options, store)
  }
  createElement() {
    let element = document.createElement('div')
    element.classList.add('sw-imap-object-text')
    // A text object renders a STRING from the config; styling comes from its own CSS rules, so
    // there is no reason for it to be parsed as markup.
    element.textContent = this.options.text.text
    return element
  }
  createCSSRules(styles) {
    let css = ''
    let c = hexToRgb(this.options.text.text_color)

    css += 'left: ' + this.options.x + '%;'
    css += 'top: ' + this.options.y + '%;'
    css += 'font-family: ' + this.options.text.font_family + ';'
    css += 'font-size: ' + this.options.text.font_size + 'px;'
    css += 'font-weight: ' + this.options.text.font_weight + ';'
    css += 'color: rgba(' + c.r + ', ' + c.g + ', ' + c.b + ', ' + this.options.text.text_opacity + ');'

    css += `filter: `
    for (let filter of styles.parent_filters) {
      css += `${filter.name}(${filter.value}) `
    }
    css += `;`

    return css
  }
  getWidth() {
    return getElementRect(this.element).width / this.store.getCanvasWrapRect().width * 100
  }
  getHeight() {
    return getElementRect(this.element).height / this.store.getCanvasWrapRect().height * 100
  }
  getRect() {
    return {
      x: this.options.x,
      y: this.options.y,
      width: this.getWidth(),
      height: this.getHeight(),
    }
  }
}