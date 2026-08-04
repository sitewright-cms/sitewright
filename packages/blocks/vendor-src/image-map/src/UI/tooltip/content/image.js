import { deepExtend, escapeHtml, safeLinkUrl } from 'imap-shared/utilities'
import { tooltipContentDefaults } from 'imap/scripts/defaults'

export default class Image {
  constructor(options) {
    this.options = deepExtend({}, tooltipContentDefaults.image, options)
  }
  css() {
    let css = `
    width: ${this.options.boxModel.width == 'auto' ? this.options.boxModel.width : this.options.boxModel.width + 'px'};
    height: ${this.options.boxModel.height == 'auto' ? this.options.boxModel.height : this.options.boxModel.height + 'px'};

    max-width: 100%;

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
    const src = safeLinkUrl(this.options.url)
    let html = `
    <div style="${this.css()} ${escapeHtml(this.options.other.css)}">
    <img src="${escapeHtml(src)}" style="width: 100%" id="${escapeHtml(this.options.other.id)}" class="${escapeHtml(this.options.other.classes)}">
    </div>
    `

    const link = safeLinkUrl(this.options.linkUrl)
    if (link) {
      html = `<a href="${escapeHtml(link)}">${html}</a>`
    }

    return html
  }
}