import { htmlToElement, deepExtend } from 'imap-shared/utilities'
import FullscreenButton from 'imap/UI/fullscreenButton'
import { init } from 'imap/init'

export default class FullscreenController {
  store = undefined
  button = undefined
  isFullscreen = undefined
  closeFullscreenCallback = undefined

  constructor(store, isFullscreen, closeFullscreenCallback) {
    this.store = store

    // Fullscreen enabled?
    if (!this.store.state.fullscreen.enable_fullscreen_mode) return

    this.isFullscreen = isFullscreen
    this.closeFullscreenCallback = closeFullscreenCallback

    // Start in fullscreen mode enabled?
    if (this.store.state.fullscreen.start_in_fullscreen_mode && !this.isFullscreen) {
      this.goFullscreen()
    }

    this.createButton()
  }
  createButton() {
    this.button = new FullscreenButton({
      mapID: this.store.getID(),
      isFullscreen: this.isFullscreen,
    })
  }
  insertUI() {
    if (!this.store.state.fullscreen.enable_fullscreen_mode) return

    if (this.store.state.object_list.enable_object_list &&
      this.store.state.object_list.menu_style === 'on-top' &&
      this.store.state.object_list.menu_position === 'right') {
      this.store.getUIWrap().querySelector('.sw-imap-ui-bottom-left').appendChild(this.button.element)
    } else {
      this.store.getUIWrap().querySelector('.sw-imap-ui-bottom-right').appendChild(this.button.element)
    }
  }
  goFullscreen() {
    // Create new fullscreen config
    let fullscreenConfig = deepExtend({}, this.store.state)

    // Modify settings
    fullscreenConfig.general.name += ' [fullscreen]'
    fullscreenConfig.id += ' [fullscreen]'

    // Create the fullscreen container. Upstream identified these two by ID; classes instead —
    // an id can only ever name one element (two maps racing into fullscreen would collide), and
    // an id selector in a shipped stylesheet outranks anything a site's own CSS can write.
    // The mount element is passed to init() directly rather than re-queried by selector.
    document.querySelector('.sw-imap-fullscreen-container')?.remove()
    const container = htmlToElement(
      `<div class="sw-imap-fullscreen-container"><div class="sw-imap-fullscreen-image-map"></div></div>`
    )
    document.body.appendChild(container)

    // Set body class
    document.body.classList.add('sw-imap-fullscreen-mode')

    // Init new image map
    this.store.getEventController().removeEvents()
    init(container.querySelector('.sw-imap-fullscreen-image-map'), fullscreenConfig, {
      isFullscreen: true,
      closeFullscreenCallback: () => {
        this.store.getEventController().createEvents()
      },
      artboardId: this.store.getArtboard().id
    })
  }
  closeFullscreen() {
    if (!this.store.getIsFullscreen()) return

    // Disable events of the fullscreen map
    this.store.getEventController().removeEvents()
    // Delete menu and tooltip container
    this.store.getMenuController().removeMenu()
    this.store.getTooltipController().container.remove()

    // Delete fullscreen container
    document.body.classList.remove('sw-imap-fullscreen-mode')
    document.querySelector('.sw-imap-fullscreen-container')?.remove()

    // This callback was created in goFullscreen()
    this.closeFullscreenCallback()
  }
}