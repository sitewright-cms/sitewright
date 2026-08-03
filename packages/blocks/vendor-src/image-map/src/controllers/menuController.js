import Menu from 'imap/UI/menu/menu'
import OpenButton from 'imap/UI/menu/openButton'
import CloseButton from 'imap/UI/menu/closeButton'

export default class NavigatorController {
  store = undefined
  menu = undefined
  openButton = undefined
  closeButton = undefined

  constructor(store) {
    this.store = store

    if (!this.store.state.object_list.enable_object_list) return
    this.store.subscribe(this.handleAction.bind(this))

    this.menu = new Menu(this.store)
    this.openButton = new OpenButton()
    this.closeButton = new CloseButton()

    this.menu.element.dataset.swImapId = this.store.getID()
    this.menu.element.appendChild(this.closeButton.element)

    this.setMenuHeight()
  }
  insertMenu() {
    if (!this.store.state.object_list.enable_object_list) return

    // If the menu is detached, put it in the designated container and return
    if (this.store.state.object_list.menu_style === 'detached') {
      this.appendDetachedMenu()
      return
    }

    // Append menu to DOM
    if (this.store.getIsMenuMobile()) {
      this.appendMobileMenu()
    } else {
      this.appendRegularMenu()
    }
  }
  removeMenu() {
    if (!this.store.state.object_list.enable_object_list) return

    this.menu.element.remove()
    this.openButton.element.remove()
  }
  updateItems() {
    if (this.menu) this.menu.updateItems()
  }

  // Actions
  handleAction(action) {
    if (action.type == 'resize') {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this.insertMenu()
          this.setMenuHeight()
        })
      })
    }
    if (action.type == 'updateSearch') {
      this.menu.search.redraw()
      this.menu.list.filterItems(action.payload.searchString)
    }
    if (action.type == 'clearSearch') {
      this.menu.search.clear()
      this.menu.search.redraw()
      this.menu.list.filterItems()
    }
    if (action.type == 'openMenu') {
      this.showMobileMenu()
    }
    if (action.type == 'closeMenu') {
      this.hideMobileMenu()
    }
    if (action.type == 'closeFullscreen') {
      if (this.store.getIsFullscreen()) this.removeMenu()
    }
  }
  appendDetachedMenu() {
    document.querySelector('[data-sw-imap-detached-menu="' + this.store.state.general.name + '"]')?.appendChild(this.menu.element)
    this.menu.element.classList.add('sw-imap-loaded')
    this.menu.element.classList.add('sw-imap-detached')
  }
  appendMobileMenu() {
    // Add menu
    document.querySelector('body').appendChild(this.menu.element)
    this.menu.element.classList.add('sw-imap-mobile')

    // Add button
    this.store.getUIWrap().querySelector('.sw-imap-ui-top-right').appendChild(this.openButton.element)
  }
  appendRegularMenu() {
    // Add menu
    this.store.getContainer().appendChild(this.menu.element)
    this.menu.element.classList.remove('sw-imap-mobile')

    this.setListOverflow()

    // Remove button
    this.openButton.element.remove()
  }
  showMobileMenu() {
    if (!this.store.state.object_list.enable_object_list) return
    this.menu.element.classList.add('sw-imap-active')
  }
  hideMobileMenu() {
    if (!this.store.state.object_list.enable_object_list) return
    this.menu.element.classList.remove('sw-imap-active')
  }
  setListOverflow() {
    let searchHeight = 0
    if (this.store.state.object_list.enable_search) searchHeight = 71
    if (this.menu.list.height > this.getMenuHeight() - searchHeight) {
      this.menu.list.element.style.overflowY = 'scroll'
    } else {
      this.menu.list.element.style.overflowY = 'auto'
    }
  }
  setMenuHeight() {
    if (this.store.state.object_list.menu_style === 'default' || this.store.getIsMenuMobile()) {
      this.menu.element.style.height = this.getMenuHeight() + 'px'
    } else {
      this.menu.element.style.maxHeight = this.getMenuHeight() + 'px'
    }
  }
  getMenuHeight() {
    if (this.store.getIsFullscreen() || this.store.getIsMenuMobile()) {
      return window.innerHeight
    }
    if (this.store.state.object_list.menu_style === 'detached') {
      return 'auto'
    }
    return this.store.getCanvasWrapRect().height
  }
}