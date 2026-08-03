import { deepExtend, escapeHtml, safeLinkUrl } from 'imap-shared/utilities'
import { tooltipContentDefaults } from 'imap/scripts/defaults'

export default class Button {
  constructor(options) {
    this.options = deepExtend({}, tooltipContentDefaults.button, options)
  }
  css() {
    let css = `
    background-color: ${this.options.style.backgroundColor};
    border-radius: ${this.options.style.borderRadius}px;

    font-family: ${this.options.style.fontFamily};
    font-weight: ${this.options.style.fontWeight};
    font-size: ${this.options.style.fontSize}px;
    line-height: ${this.options.boxModel.height}px;
    color: ${this.options.style.color};

    width: ${this.options.boxModel.width == 'auto' ? this.options.boxModel.width : this.options.boxModel.width + 'px'};
    height: ${this.options.boxModel.height == 'auto' ? this.options.boxModel.height : this.options.boxModel.height + 'px'};

    text-align: center;
    display: ${this.options.style.display};
    padding: 0 20px;
    `

    return css
  }

  wrapCss() {
    let css = `
    margin-top: ${this.options.boxModel.margin.top}px;
    margin-bottom: ${this.options.boxModel.margin.bottom}px;
    margin-left: ${this.options.boxModel.margin.left}px;
    margin-right: ${this.options.boxModel.margin.right}px;

    padding-top: ${this.options.boxModel.padding.top}px;
    padding-bottom: ${this.options.boxModel.padding.bottom}px;
    padding-left: ${this.options.boxModel.padding.left}px;
    padding-right: ${this.options.boxModel.padding.right}px;
    `

    return css
  }

  html() {
    // rel=noopener with target=_blank: the opened page must not get a handle on this one.
    const blank = this.options.newTab ? 'target="_blank" rel="noopener noreferrer"' : ''
    // safeLinkUrl rejects javascript:/data:/vbscript:; an unresolvable link becomes a no-op "#".
    const href = safeLinkUrl(this.options.url) || '#'

    // NOTE: upstream also rendered `onclick="${options.script}"` here — inline JavaScript straight
    // from the config. It is deliberately absent: a tooltip button is a LINK, and this platform
    // executes no tenant code (the published CSP has no 'unsafe-inline' for scripts either).
    return `
      <div style="${this.wrapCss()}">
        <a
          href="${escapeHtml(href)}"
          ${blank}
          style="${this.css()} ${escapeHtml(this.options.other.css)}"
          id="${escapeHtml(this.options.other.id)}"
          class="${escapeHtml(this.options.other.classes)}"
        >${this.options.text}</a>
      </div>
    `
  }
}
