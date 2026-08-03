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

    css += `left: ${this.options.x}%;`
    css += `top: ${this.options.y}%;`
    css += `width: ${this.options.width}%;`
    css += `height: ${this.options.height}%;`

    css += `opacity: ${styles.opacity};`

    css += `filter: `
    for (let filter of styles.filters) {
      css += `${filter.name}(${filter.value}) `
    }
    for (let filter of styles.parent_filters) {
      css += `${filter.name}(${filter.value}) `
    }
    css += `; `

    return css
  }
}