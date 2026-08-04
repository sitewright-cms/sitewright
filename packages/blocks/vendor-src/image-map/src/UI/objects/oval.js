import { hexToRgb, safeCssFilter, safeCssValue } from 'imap-shared/utilities'
import * as editorConsts from 'imap-shared/consts'
import MapObject from 'imap/UI/objects/mapObject'

export default class Oval extends MapObject {
  constructor(options, store) {
    super(options, store)
  }
  createElement() {
    let element = document.createElement('div')
    element.classList.add('sw-imap-object-oval')

    return element
  }
  createCSSRules(styles) {
    let css = ''

    // If the object is an Oval, apply 50% 50% border radius
    let borderRadius = styles.border_radius + 'px'
    if (this.options.type === editorConsts.OBJECT_OVAL) {
      borderRadius = '50% 50%'
    }

    let color_bg = hexToRgb(styles.background_color) || { r: 0, b: 0, g: 0 }
    let color_border = hexToRgb(styles.border_color) || { r: 0, b: 0, g: 0 }

    css += 'left: ' + safeCssValue(this.options.x) + '%;'
    css += 'top: ' + safeCssValue(this.options.y) + '%;'
    css += 'width: ' + safeCssValue(this.options.width) + '%;'
    css += 'height: ' + safeCssValue(this.options.height) + '%;'

    if (styles.background_type === 'color') {
      css += 'background: rgba(' + color_bg.r + ', ' + color_bg.g + ', ' + color_bg.b + ', ' + safeCssValue(styles.background_opacity) + ');'
    }

    css += 'opacity: ' + safeCssValue(styles.opacity) + ';'
    css += 'border-width: ' + safeCssValue(styles.border_width) + 'px;'
    css += 'border-style: ' + safeCssValue(styles.border_style) + ';'
    css += 'border-color: rgba(' + color_border.r + ', ' + color_border.g + ', ' + color_border.b + ', ' + safeCssValue(styles.border_opacity) + ');'
    css += 'border-radius: ' + borderRadius + ';'

    css += `filter: `
    for (let filter of styles.parent_filters) {
      css += safeCssFilter(filter)
    }
    css += `;`

    return css
  }
}