import Item from 'imap/UI/menu/item'
import ItemArtboard from 'imap/UI/menu/itemArtboard'
import * as consts from 'imap-shared/consts'
import { escapeHtml, escapeRegex } from 'imap-shared/utilities'

export default class List {
  store = undefined
  element = document.createElement('div')
  items = []
  parentsForItem = {}
  height = 0
  hiddenGroups = new Set()
  hiddenArtboards = new Set()
  artboardItems = {}

  constructor(store) {
    this.store = store
    this.element.classList.add('sw-imap-object-list')

    this.drawItems()
  }
  drawItems() {
    this.element.innerHTML = ''

    for (let artboard of this.store.getArtboards()) {
      // If we are showing only objects from the active artboard, skip inactive artboards
      if (!this.store.state.object_list.group_by_artboard && this.store.state.object_list.show_only_objects_from_active_artboard && artboard.id !== this.store.getCurrentArtboard()) continue

      // Create artboard
      let artboardContainer = this.createArtboardContainer()
      if (this.store.state.object_list.group_by_artboard) {
        let artboardItem = new ItemArtboard({ options: artboard, imageMapId: this.store.getID() })
        this.artboardItems[artboard.id] = artboardItem
        artboardContainer.appendChild(artboardItem.element)
      }

      // Create children
      let artboardChildren = []
      artboard.children.forEach(child => {
        artboardChildren.push(...this.createItemAndChildren(child, [artboard.id]))
      })
      this.items.push(...artboardChildren)

      // Append children to artboard container
      artboardChildren.forEach(child => artboardContainer.appendChild(child.element))

      // Append the artboard container
      this.element.appendChild(artboardContainer)
    }
  }
  createArtboardContainer() {
    let container = document.createElement('div')
    container.classList.add('sw-imap-object-list-artboard-container')

    return container
  }
  createItemAndChildren(item, parents = []) {
    // If the object is static and we are hiding static objects, return
    if (this.store.state.object_list.hide_static_objects && item.static) return []

    // Returns an array of Item objects, including the item's children if applicable
    let result = []

    let isGroup = false
    if (item.type === consts.OBJECT_GROUP && this.store.state.object_list.show_groups && !item.single_object) isGroup = true

    let depth = 0
    if (this.store.state.object_list.show_groups) depth = parents.length - 1

    if (item.type !== consts.OBJECT_GROUP ||
      (item.type === consts.OBJECT_GROUP && this.store.state.object_list.show_groups) ||
      (item.type === consts.OBJECT_GROUP && item.single_object)) {
      result.push(new Item({
        options: item,
        isGroup,
        depth,
        imageMapId: this.store.getID()
      }))
    }

    if (item.type === consts.OBJECT_GROUP && !item.single_object) {
      for (let child of item.children) {
        if (this.store.state.object_list.hide_static_objects && child.static) continue

        let childItems = this.createItemAndChildren(child, [...parents, item.id])
        result.push(...childItems)
      }
    }

    this.parentsForItem[item.id] = this.parentsForItem[item.id] ? [...this.parentsForItem[item.id], ...parents] : parents

    return result
  }
  /**
   * Filter the object list to titles containing `text`, wrapping the match in a highlight span.
   *
   * `text` is whatever the VISITOR typed into the search box, and titles are AUTHORED config —
   * neither may reach the DOM as markup. Upstream interpolated the raw input straight into
   * `new RegExp()` (so typing "(" threw a SyntaxError and a pattern like "(a+)+$" could hang the
   * tab) and assigned the untouched title to innerHTML. Both sides are escaped here: the needle
   * for the regex, and everything written out for HTML. Escaping the title BEFORE matching keeps
   * the two consistent, so the match indices still line up.
   */
  filterItems(text = '') {
    const needle = text.length > 2 ? text : ''
    // eslint-disable-next-line security/detect-non-literal-regexp -- the needle is escapeRegex'd on the line above, so every character is a literal and no visitor input can form a pattern
    const regex = needle ? new RegExp('(' + escapeRegex(escapeHtml(needle)) + ')', 'gi') : null

    for (let item of this.items) {
      const title = escapeHtml(item.options.title)
      const p = item.element.querySelector('p')

      if (!regex) {
        item.show()
        p.innerHTML = title
        continue
      }

      const highlighted = title.replace(regex, '<span class="sw-imap-search-highlight">$&</span>')
      if (highlighted !== title) {
        item.show()
        p.innerHTML = highlighted
      } else {
        item.hide()
        p.innerHTML = title
      }
    }
  }
  toggleGroup(id) {
    if (this.hiddenGroups.has(id)) {
      this.hiddenGroups.delete(id)
      this.items.filter(item => item.options.id === id)[0].openFolder()
    } else {
      this.hiddenGroups.add(id)
      this.items.filter(item => item.options.id === id)[0].closeFolder()
    }

    this.render()
  }
  toggleArtboard(id) {
    if (this.hiddenArtboards.has(id)) {
      this.hiddenArtboards.delete(id)
      this.artboardItems[id].expand()
    } else {
      this.hiddenArtboards.add(id)
      this.artboardItems[id].collapse()
    }

    this.render()
  }
  render() {
    for (let item of this.items) {
      let hidden = false
      for (let parentId of this.parentsForItem[item.options.id]) {
        if (this.hiddenGroups.has(parentId) || this.hiddenArtboards.has(parentId)) {
          hidden = true
          break
        }
      }
      if (hidden) item.hide()
      if (!hidden) item.show()
    }
  }
}