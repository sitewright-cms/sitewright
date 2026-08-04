import { safeCssValue, safeCssFilter } from 'imap-shared/utilities'
import MapObject from 'imap/UI/objects/mapObject'

export default class SVGSingle extends MapObject {
  constructor(options, store) {
    super(options, store)
  }
  createElement() {
    let element = document.createElementNS('http://www.w3.org/2000/svg', 'svg')

    element.innerHTML = this.options.svg.html
    element.classList.add('sw-imap-object-svg-single')
    element.setAttribute('viewBox', this.options.svg.viewBox)

    return element
  }
  createCSSRules(styles) {
    let css = ``

    css += `left: ${safeCssValue(this.options.x)}%;`
    css += `top: ${safeCssValue(this.options.y)}%;`
    css += `width: ${safeCssValue(this.options.width)}%;`
    css += `height: ${safeCssValue(this.options.height)}%;`

    css += `opacity: ${safeCssValue(styles.opacity)};`

    css += `filter: `
    for (let filter of styles.filters) {
      css += safeCssFilter(filter)
    }
    for (let filter of styles.parent_filters) {
      css += safeCssFilter(filter)
    }
    css += `; `

    return css
  }
}