import List from 'imap/UI/menu/list'
import Search from 'imap/UI/menu/search'

export default class Menu {
  element = document.createElement('div')
  list = undefined
  search = undefined

  constructor(store) {
    this.store = store

    if (this.store.state.object_list.enable_search) {
      this.search = new Search()
      this.element.appendChild(this.search.element)
      this.element.classList.add('sw-imap-has-search')
    }
    this.list = new List(this.store)

    this.element.appendChild(this.list.element)
    this.element.classList.add('sw-imap-object-menu')


    if (this.store.state.object_list.menu_position == 'left') this.element.classList.add('sw-imap-object-menu-left')
    if (this.store.state.object_list.menu_position == 'right') this.element.classList.add('sw-imap-object-menu-right')
    if (this.store.state.object_list.menu_style == 'on-top' && !this.store.getIsMenuMobile()) this.store.getContainer().classList.add('sw-imap-object-menu-on-top')

    if (this.store.state.object_list.menu_style == 'on-top' && !this.store.getIsMenuMobile() && this.store.state.object_list.menu_position == 'left') this.store.getContainer().classList.add('sw-imap-object-menu-on-top-left')
    if (this.store.state.object_list.menu_style == 'on-top' && !this.store.getIsMenuMobile() && this.store.state.object_list.menu_position == 'right') this.store.getContainer().classList.add('sw-imap-object-menu-on-top-right')
  }
  updateItems() {
    this.list.drawItems()
  }
}