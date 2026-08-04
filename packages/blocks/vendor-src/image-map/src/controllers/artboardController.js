import ArtboardMenu from 'imap/UI/artboardMenu'

export default class ArtboardController {
  store = undefined
  artboardMenu = undefined
  currentArtboardId = undefined

  constructor(store, ArtboardId) {
    this.store = store
    this.currentArtboardId = ArtboardId || store.state.artboards[0].id

    // Create UI
    if (this.store.state.artboards.length > 1) {
      this.artboardMenu = new ArtboardMenu(this.store)
      this.artboardMenu.selectArtboard(this.currentArtboardId)
    } else {
      this.artboardMenu = {
        element: document.createElement('div')
      }
    }
  }
  insertUI() {
    if (this.store.state.object_list.enable_object_list && this.store.state.object_list.menu_style === 'on-top' && this.store.state.object_list.menu_position === 'right') {
      this.store.getUIWrap().querySelector('.sw-imap-ui-top-left').appendChild(this.artboardMenu.element)
    } else {
      this.store.getUIWrap().querySelector('.sw-imap-ui-top-right').appendChild(this.artboardMenu.element)
    }
  }
  changeArtboard(artboardId) {
    this.currentArtboardId = artboardId
    this.artboardMenu.selectArtboard(this.currentArtboardId)
  }
}