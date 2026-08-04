import Paragraph from 'imap/UI/tooltip/content/paragraph'
import Heading from 'imap/UI/tooltip/content/heading'
import Image from 'imap/UI/tooltip/content/image'
import Button from 'imap/UI/tooltip/content/button'
import YouTube from 'imap/UI/tooltip/content/youTube'
import Video from 'imap/UI/tooltip/content/video'

export default class TooltipContent {
  constructor(elements) {
    this.elements = this.createElements(elements)
  }
  createElements(options) {
    // Create elements
    let elements = []
    for (let elementOptions of options) {
      if (elementOptions.type == 'Paragraph') {
        let element = new Paragraph(elementOptions)
        elements.push(element)
      }
      if (elementOptions.type == 'Heading') {
        let element = new Heading(elementOptions)
        elements.push(element)
      }
      if (elementOptions.type == 'Image') {
        let element = new Image(elementOptions)
        elements.push(element)
      }
      if (elementOptions.type == 'Button') {
        let element = new Button(elementOptions)
        elements.push(element)
      }
      if (elementOptions.type == 'YouTube') {
        let element = new YouTube(elementOptions)
        elements.push(element)
      }
      if (elementOptions.type == 'Video') {
        let element = new Video(elementOptions)
        elements.push(element)
      }
    }

    return elements
  }

  html() {
    let html = ''

    for (let element of this.elements) {
      html += element.html()
    }

    return html
  }
}