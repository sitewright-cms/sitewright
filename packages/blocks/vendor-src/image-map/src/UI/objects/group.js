import MapObject from 'imap/UI/objects/mapObject'

export default class Group extends MapObject {
  constructor(options, store) {
    super(options, store)
  }
  createElement() {
    let element = document.createElement('div')
    return element
  }
  getHighlightIds() {
    if (this.options.parent) {
      return this.store.getChildrenDeep({ id: this.options.parent }).map(obj => obj.id)
    } else if (this.options.single_object) {
      return this.store.getChildrenDeep({ id: this.options.id }).map(obj => obj.id)
    } else {
      return [this.options.id]
    }
  }
  highlight() {

  }
  unhighlight() {

  }
  getRect() {
    let rects = []

    for (let obj of this.store.getChildrenDeep({ id: this.options.id })) {
      rects.push(this.store.getObjectController().objects[obj.id].getRect())
    }

    let x = Math.min(...rects.map(rect => rect.x))
    let y = Math.min(...rects.map(rect => rect.y))
    let width = Math.max(...rects.map(rect => rect.x + rect.width)) - x
    let height = Math.max(...rects.map(rect => rect.y + rect.height)) - y

    return {
      x,
      y,
      width,
      height,
    }
  }
  getBoundingClientRect() {
    let rects = []

    for (let obj of this.store.getChildrenDeep({ id: this.options.id })) {
      rects.push(this.store.getObjectController().objects[obj.id].getBoundingClientRect())
    }

    let x = Math.min(...rects.map(rect => rect.x))
    let y = Math.min(...rects.map(rect => rect.y))
    let width = Math.max(...rects.map(rect => rect.x + rect.width)) - x
    let height = Math.max(...rects.map(rect => rect.y + rect.height)) - y

    return {
      x,
      y,
      width,
      height,
    }
  }
}