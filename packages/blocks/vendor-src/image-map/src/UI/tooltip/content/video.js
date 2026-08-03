import { deepExtend, escapeHtml, safeLinkUrl } from 'imap-shared/utilities'
import { tooltipContentDefaults } from 'imap/scripts/defaults'

export default class Video {
  constructor(options) {
    this.options = deepExtend({}, tooltipContentDefaults.video, options)
  }
  css() {
    let css = `
    width: ${this.options.boxModel.width == 'auto' ? this.options.boxModel.width : this.options.boxModel.width + 'px'};
    height: ${this.options.boxModel.height == 'auto' ? this.options.boxModel.height : this.options.boxModel.height + 'px'};

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
    let videoTagAtts = '';

    if (this.options.autoplay) {
      videoTagAtts += ' autoplay ';
    }
    if (this.options.loop) {
      videoTagAtts += ' loop ';
    }
    if (this.options.controls) {
      videoTagAtts += ' controls ';
    }

    // Only emit a <source> for a src that resolves to a safe URL.
    const source = (url, type) => {
      const safe = safeLinkUrl(url)
      return safe ? `<source src="${escapeHtml(safe)}" type="${type}">` : ''
    }

    let html = `<video ${videoTagAtts} 
      style="${this.css()} ${escapeHtml(this.options.other.css)}" 
      id="${escapeHtml(this.options.other.id)}" 
      class="${escapeHtml(this.options.other.classes)}">

    ${source(this.options.src.mp4, 'video/mp4')}
    ${source(this.options.src.webm, 'video/webm')}
    ${source(this.options.src.ogv, 'video/ogv')}
    
    </video>`;

    const link = safeLinkUrl(this.options.linkUrl)
    if (link) {
      html = `<a href="${escapeHtml(link)}">${html}</a>`
    }

    return html
  }
}