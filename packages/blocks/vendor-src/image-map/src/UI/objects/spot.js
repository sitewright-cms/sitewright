import { hexToRgb, htmlToElement, safeCssFilter, safeCssValue, safeLinkUrl } from 'imap-shared/utilities'
import MapObject from 'imap/UI/objects/mapObject'

export default class Spot extends MapObject {
  constructor(options, store) {
    super(options, store)
  }
  createElement() {
    let element = document.createElement('div')
    element.classList.add('sw-imap-object-spot')

    // A DOT (use_icon:false) may ring itself with an animated halo. The halo is a ::after on this
    // element, so it inherits the dot's own border colour and needs no extra node.
    if (!this.options.default_style.use_icon && this.options.default_style.pulse) {
      element.classList.add('sw-imap-object-pulse')
    }

    if (this.options.default_style.use_icon) {
      if (this.options.default_style.icon_is_pin) {
        element.classList.add('sw-imap-object-spot-pin')
      }

      // Icon
      if (this.options.default_style.icon_type === 'library') {
        let svg = htmlToElement(this.options.default_style.icon_svg)
        // Fill the (px- or percent-sized) hotspot rather than restating the size: with a percent
        // icon there is no pixel number to write here, and the container already has the geometry.
        svg.style.width = '100%'
        svg.style.height = '100%'
        svg.style.display = 'block'
        element.appendChild(svg)
      }

      if (this.options.default_style.icon_type === 'custom' && this.options.default_style.icon_url.length > 0) {
        // ★ setAttribute, not an interpolated markup string. Built as HTML, a URL carrying a quote
        // closed the attribute and added its own — `x" onerror="…` is a working handler. The server
        // also gates this value (image-map-embed safeAssetUrl); this is the second of the two ends.
        let img = document.createElement('img')
        img.setAttribute('src', safeLinkUrl(this.options.default_style.icon_url))
        img.style.width = `${this.options.default_style.icon_size}px`
        img.style.height = `${this.options.default_style.icon_size}px`
        element.appendChild(img)
      }

      // Shadow — sized off the ICON BOX, not off `icon_size`.
      //
      // The px form (`width: icon_size`, `top: icon_size / 2`) is exactly `100%` and `50%` of that
      // box, so a pixel icon renders byte-identically. A PERCENT icon (icon_size_pct) has no pixel
      // size to restate: written in px the shadow kept whatever `icon_size` happened to say and
      // drifted out from under the marker at every container width but one.
      if (this.options.default_style.icon_shadow) {
        let shadowHtml = `<div style="width: 100%;height: 100%;left: 0;top: 50%;" class="sw-imap-object-icon-shadow"></div>`
        element.appendChild(htmlToElement(shadowHtml))
      }
    }

    return element
  }
  createCSSRules(styles) {
    let css = ''

    css += `left: ${safeCssValue(this.options.x)}%;`
    css += `top: ${safeCssValue(this.options.y)}%;`

    // The spot is an icon
    if (this.options.default_style.use_icon) {
      // ★ PERCENT sizing, when the config asks for it. A px icon is a fixed dot on a map that scales
      // with its container — big on a phone, tiny on a wall display. `icon_size_pct` is a percentage
      // of the artboard WIDTH, so the marker grows and shrinks with everything else on the map.
      // `aspect-ratio` keeps it square; percent margins resolve against the containing block's WIDTH,
      // so `-pct%` on the TOP margin is exactly one icon-height and the pin still points at its
      // coordinate. Falls back to px so every existing map and bundled template is untouched.
      let pct = this.options.default_style.icon_size_pct
      if (typeof pct === 'number' && pct > 0) {
        css += `width: ${safeCssValue(pct)}%;`
        css += `height: auto;`
        css += `aspect-ratio: 1;`
      } else {
        css += `width: ${safeCssValue(this.options.default_style.icon_size)}px;`
        css += `height: ${safeCssValue(this.options.default_style.icon_size)}px;`
      }

      if (this.options.default_style.icon_type === 'library') {
        let color_fill = hexToRgb(styles.icon_fill) || { r: 0, b: 0, g: 0 }
        let rgba = `rgba(${color_fill.r}, ${color_fill.g}, ${color_fill.b}, ${safeCssValue(styles.opacity)})`
        // ★ BOTH properties, because artwork colours itself in one of two ways and the config has no
        // idea which. A bare `<path>` inherits the CSS `fill` set here; every icon from the platform's
        // own library carries `fill="currentColor"`, and a presentation ATTRIBUTE on the element beats
        // an inherited property — so `fill` alone left those icons painted in the page's text colour
        // while the Studio (which sets `color`) showed the chosen one. Setting both makes the two
        // surfaces agree whatever the artwork does.
        css += `fill: ${rgba};`
        css += `color: ${rgba};`
      }

      // Anchor offsets, in whichever unit the icon is sized in.
      if (typeof pct === 'number' && pct > 0) {
        css += `margin-left: ${safeCssValue(-pct / 2)}%;`
        css += `margin-top: ${safeCssValue(this.options.default_style.icon_is_pin ? -pct : -pct / 2)}%;`
      } else {
        let size = this.options.default_style.icon_size
        css += `margin-top: ${safeCssValue(this.options.default_style.icon_is_pin ? -size : -size / 2)}px;`
        css += `margin-left: ${safeCssValue(-size / 2)}px;`
      }

      if (this.options.default_style.icon_is_pin) {
        css += `transform-origin: 50% 100%;`
      } else {
        css += `transform-origin: 50% 50%;`
      }
    }

    // The spot is not an icon
    if (!this.options.default_style.use_icon) {
      css += `width: ${safeCssValue(this.options.width)}px;`
      css += `height: ${safeCssValue(this.options.height)}px;`

      let color_bg = hexToRgb(styles.background_color) || { r: 0, b: 0, g: 0 }
      let color_border = hexToRgb(styles.border_color) || { r: 0, b: 0, g: 0 }

      css += `opacity: ${safeCssValue(styles.opacity)};`
      css += `border-radius: ${safeCssValue(styles.border_radius)}px;`
      css += `background: rgba(${color_bg.r}, ${color_bg.g}, ${color_bg.b}, ${safeCssValue(styles.background_opacity)});`
      css += `border-width: ${safeCssValue(styles.border_width)}px;`
      css += `border-style: ${safeCssValue(styles.border_style)};`
      css += `border-color: rgba(${color_border.r}, ${color_border.g}, ${color_border.b}, ${safeCssValue(styles.border_opacity)});`

      css += `margin-top: ${(-safeCssValue(this.options.width) / 2)}px;`
      css += `margin-left: ${(-safeCssValue(this.options.height) / 2)}px;`
    }

    css += `filter: `
    for (let filter of styles.parent_filters) {
      css += safeCssFilter(filter)
    }
    css += `;`

    return css
  }
  getWidth() {
    return 0.01
  }
  getHeight() {
    return 0.01
  }
}