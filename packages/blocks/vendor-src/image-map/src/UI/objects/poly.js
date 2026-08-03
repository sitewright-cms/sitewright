import { hexToRgb } from 'imap-shared/utilities'

import MapObject from 'imap/UI/objects/mapObject'

export default class Poly extends MapObject {
  constructor(options, store) {
    super(options, store)
  }
  createElement() {
    // Convert object props from % to PX
    let imageMapWidth = this.store.getArtboard().width
    let imageMapHeight = this.store.getArtboard().height
    let objectLeftPx = imageMapWidth * (this.options.x / 100)
    let objectTopPx = imageMapHeight * (this.options.y / 100)
    let objectWidthPx = imageMapWidth * (this.options.width / 100)
    let objectHeightPx = imageMapHeight * (this.options.height / 100)

    // Element
    let poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
    let points = ''
    for (let j = 0; j < this.options.points.length; j++) {
      let x = (imageMapWidth * (this.options.x / 100)) + (parseFloat(this.options.points[j].x) / 100) * (objectWidthPx)
      let y = (imageMapHeight * (this.options.y / 100)) + (parseFloat(this.options.points[j].y) / 100) * (objectHeightPx)
      points += `${x},${y} `
    }
    poly.setAttribute('points', points)

    // SVG
    let element = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    element.classList.add('sw-imap-object-poly')
    element.setAttributeNS(null, 'viewBox', `${objectLeftPx} ${objectTopPx} ${objectWidthPx} ${objectHeightPx}`)
    element.appendChild(poly)

    return element
  }
  createCSSRules(styles) {
    let css = ''
    let c_bg = hexToRgb(styles.background_color) || { r: 0, b: 0, g: 0 }
    let c_stroke = hexToRgb(styles.stroke_color) || { r: 0, b: 0, g: 0 }

    if (styles.background_type === 'color') {
      css += `fill: rgba(${c_bg.r}, ${c_bg.g}, ${c_bg.b}, ${styles.background_opacity}); `
    } else {
      css += `fill: rgba(0, 0, 0, 0); `
    }

    css += `left: ${this.options.x}%;`
    css += `top: ${this.options.y}%;`
    css += `width: ${this.options.width}%;`
    css += `height: ${this.options.height}%;`

    css += `opacity: ${styles.opacity};`
    css += `stroke: rgba(${c_stroke.r}, ${c_stroke.g}, ${c_stroke.b}, ${styles.stroke_opacity}); `
    css += `stroke-width: ${styles.stroke_width}px; `
    css += `stroke-dasharray: ${styles.stroke_dasharray}; `
    css += `stroke-linecap: ${styles.stroke_linecap}; `

    css += `filter: `
    for (let filter of styles.parent_filters) {
      css += `${filter.name}(${filter.value}) `
    }
    css += `;`

    return css
  }
}