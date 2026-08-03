import { safeCssValue, safeCssFilter } from 'imap-shared/utilities'
import MapObject from 'imap/UI/objects/mapObject'

// Elements and attributes an `svg` hotspot may be BUILT from. Mirrors SVG_SHAPE_TAGS /
// SVG_SHAPE_ATTRS in @sitewright/schema, which the test suite pins these two lists to.
//
// ★ Why an allowlist and not a sanitized string: this renderer does not parse markup, it CONSTRUCTS
// an element — `createElementNS(ns, tagName)` then `setAttribute(name, value)` per property — so the
// config chooses the element name and every attribute name. Unrestricted, `tagName: "script"` builds
// an executable SVG script element and `{name: "onload"}` sets an inline handler. The server strips
// both before storing; this is the second line, at the point of use.
const SHAPE_TAGS = [
  'path', 'polyline', 'polygon', 'rect', 'circle', 'ellipse', 'line',
  'g', 'defs', 'use', 'symbol', 'clipPath', 'mask',
  'linearGradient', 'radialGradient', 'stop', 'pattern',
  'text', 'tspan', 'title', 'desc',
]
const SHAPE_ATTRS = [
  'd', 'points', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height',
  'transform', 'viewBox', 'preserveAspectRatio',
  'fill', 'fill-rule', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
  'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'clip-rule', 'clip-path',
  'id', 'class', 'style', 'offset', 'stop-color', 'stop-opacity',
  'gradientUnits', 'gradientTransform', 'patternUnits', 'spreadMethod',
]

export default class SVG extends MapObject {
  constructor(options, store) {
    super(options, store)
  }
  createElement() {
    let svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    // An unlisted tag degrades to an inert <g> rather than dropping the hotspot, so a bad value
    // never silently removes content from the map.
    const tagName = SHAPE_TAGS.includes(this.options.svg.tagName) ? this.options.svg.tagName : 'g'
    let element = document.createElementNS('http://www.w3.org/2000/svg', tagName)

    for (let prop of this.options.svg.properties) {
      if (!SHAPE_ATTRS.includes(prop.name)) continue
      element.setAttribute(prop.name, prop.value)
    }

    svg.classList.add('sw-imap-object-svg-single')
    svg.setAttribute('viewBox', this.options.svg.viewBox)

    svg.appendChild(element)

    return svg
  }
  createCSSRules(styles) {
    let css = ``

    css += `display: block;`
    css += `left: ${safeCssValue(this.options.x)}%;`
    css += `top: ${safeCssValue(this.options.y)}%;`
    css += `width: ${safeCssValue(this.options.width)}%;`
    css += `height: ${safeCssValue(this.options.height)}%;`

    css += `opacity: ${safeCssValue(styles.opacity)};`
    css += `fill: ${safeCssValue(styles.background_color)};`
    css += `fill-opacity: ${safeCssValue(styles.background_opacity)};`
    css += `stroke: ${safeCssValue(styles.stroke_color)};`
    css += `stroke-opacity: ${safeCssValue(styles.stroke_opacity)};`
    css += `stroke-width: ${safeCssValue(styles.stroke_width)};`
    css += `stroke-dasharray: ${safeCssValue(styles.stroke_dasharray)};`
    css += `stroke-linecap: ${safeCssValue(styles.stroke_linecap)};`

    css += `filter: `
    for (let filter of styles.parent_filters) {
      css += safeCssFilter(filter)
    }
    css += `;`

    return css
  }
}
