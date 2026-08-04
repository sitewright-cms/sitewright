import { ready, uuidv4, loadImage } from 'imap-shared/utilities'
import * as consts from 'imap/consts'
import EventController from 'imap/controllers/eventController'
import FullscreenController from 'imap/controllers/fullscreenController'
import NavigatorController from 'imap/controllers/navigatorController'
import ObjectController from 'imap/controllers/objectController'
import TooltipController from 'imap/controllers/tooltipController'
import ZoomController from 'imap/controllers/zoomController'
import CacheController from 'imap/controllers/cacheController'
import ArtboardController from 'imap/controllers/artboardController'
import MenuController from 'imap/controllers/menuController'
import Store from 'imap/store/store'
import * as Importer from 'imap-shared/import'
import { trigger } from 'imap/runtime'

export class ImageMap {
  constructor(selector, config, launchParams) {
    // Generic properties
    this.id = uuidv4()
    this.config = Importer.importSettings(config)
    this.launchParams = launchParams

    // Controllers
    this.tooltipController = undefined
    this.fullscreenController = undefined
    this.navigatorController = undefined
    this.zoomController = undefined
    this.eventController = undefined
    this.cacheController = undefined

    // Elements
    this.root = undefined
    this.container = undefined
    this.canvasWrap = undefined
    this.scaleWrap = undefined
    this.translateWrap = undefined
    this.UIWrap = undefined
    this.image = undefined
    this.background = undefined

    // Init when the DOM is ready
    ready(() => {
      // Support for jQuery method of initializing the image map
      if (Object.prototype.toString.call(selector) == '[object String]') {
        this.root = document.querySelector(selector)
      } else {
        this.root = selector
      }

      this.init()
    })
  }
  async init() {
    this.store = new Store({ initialState: this.config, imageMap: this })
    this.store.dispatch('init')

    if (this.eventController) this.eventController.removeEvents()
    // Init layers before anything
    this.artboardController = new ArtboardController(this.store, this.launchParams.layerID)

    // Preload images
    // because many calculations depend on the image size
    if (!(await this.loadImages())) return false

    // Build HTML and create refs
    this.root.innerHTML = this.html()
    this.root.dataset.swImapId = this.store.getID()
    this.root.dataset.swImapName = this.store.getName()
    this.containerEl = this.root.querySelector('.sw-imap-container')
    this.canvasWrap = this.root.querySelector('.sw-imap-canvas')
    this.scaleWrap = this.canvasWrap.querySelector('.sw-imap-scale')
    this.translateWrap = this.canvasWrap.querySelector('.sw-imap-translate')
    this.UIWrap = this.root.querySelector('.sw-imap-ui')

    // Images have loaded and HTML is generated
    this.setBackground()

    // After creating the HTML and cached the DOM Nodes in the state,
    // adjust the size of the image map
    await this.adjustSize()

    // Do it again, because the mobile menu depends on the size of the image map
    // which in turn might depend on the size of the parent
    // which in turn might be 0 before the map exists
    await this.adjustSize()

    // Create controllers
    this.eventController = new EventController(this.store)
    this.cacheController = new CacheController(500)
    this.tooltipController = new TooltipController(this.store)
    this.zoomController = new ZoomController(this.store)
    this.fullscreenController = new FullscreenController(this.store, this.launchParams.isFullscreen, this.launchParams.closeFullscreenCallback)
    this.navigatorController = new NavigatorController(this.store)
    this.objectController = new ObjectController(this.store)
    this.menuController = new MenuController(this.store)

    // Setup. The tooltip container lives INSIDE the component root (upstream put it at the top
    // of <body>): it keeps the component self-contained so a page can host several maps, the
    // site's own CSS can target it, and nothing of ours leaks into the host document. Tooltips
    // are positioned fixed, so leaving the flow here costs nothing.
    this.root.insertBefore(this.tooltipController.container, this.root.firstChild)
    this.store.getScaleWrap().appendChild(this.objectController.container)
    this.store.getScaleWrap().appendChild(this.objectController.imageBackgroundsContainer)
    this.root.appendChild(this.objectController.stylesheet)
    this.artboardController.insertUI()
    this.zoomController.insertUI()
    this.fullscreenController.insertUI()
    this.navigatorController.insertUI()
    this.menuController.insertMenu()
    this.eventController.buildUIModel()

    // NOTE: upstream's loadCustomCode() — which injected the config's `custom_js` as a <script>
    // and `custom_css` as a <style> into <body> — is deliberately absent. Per-tenant code
    // execution is exactly what the platform's CSP and authoring model rule out.

    this.store.subscribe(this.handleAction.bind(this))

    trigger({
      type: consts.HOOK_MAP_INIT,
      payload: {
        map: this.config.general.name,
      },
    })
  }
  async deinit() {
    try {
      this.eventController.removeEvents()
      this.root.innerHTML = ''
    } catch {
      // console.log(e)
    }
  }
  async handleAction(action) {
    if (action.type == 'resize') {
      this.adjustSize()
    }
  }
  html() {
    let theme = this.store.state.general.ui_theme === 'light' ? 'sw-imap-ui-light' : 'sw-imap-ui-dark'
    let html = `
    <div class="sw-imap-container ${theme}">
      <div class="sw-imap-ui-wrap">
        <div class="sw-imap-ui">
          <div class="sw-imap-ui-top-right"></div>
          <div class="sw-imap-ui-top-left"></div>
          <div class="sw-imap-ui-bottom-right"></div>
          <div class="sw-imap-ui-bottom-left"></div>
        </div>
        <div class="sw-imap-canvas-wrap">
          <div class="sw-imap-canvas">
            <div class="sw-imap-translate">
              <div class="sw-imap-scale"></div>
            </div>
          </div>
        </div>
      </div>
    </div>`

    return html
  }
  async loadImages() {
    // Load the main image
    if (this.store.getArtboard().image_url && this.store.getArtboard().background_type === 'image') {
      let result = await loadImage(this.store.getArtboard().image_url)
      if (!result) {
        console.log('Could not load main image!')
        return false
      }
      this.image = result.image
      this.image.classList.add('sw-imap-image')
    }

    // Pre-load all object background images for mouseover
    for (let obj of this.store.getObjects()) {
      if (obj.default_style.background_type === 'image') await loadImage(obj.mouseover_style.background_image_url)
    }

    return true
  }
  async adjustSize() {
    // Wait until first draw
    // while (this.store.getImage() && getElementRect(this.canvasWrap).height === 0) {
    //   await new Promise(r => setTimeout(r, 500))
    // }

    await new Promise((r) => setTimeout(r, 50))

    let parentWidth = this.root.parentNode.getBoundingClientRect().width
    let containerWidth
    let canvasWidth, canvasHeight

    // Artboard ratio
    let artboardRatio = this.store.getArtboard().width / this.store.getArtboard().height

    // Is there menu?
    let menuWidth = 0
    if (this.store.state.object_list.enable_object_list && this.store.state.object_list.menu_style === 'default') {
      menuWidth = this.store.getIsMenuMobile() ? 0 : 240
      if (this.store.state.object_list.menu_position == 'right') {
        this.store.getContainer().style.paddingRight = menuWidth + 'px'
      }
      if (this.store.state.object_list.menu_position == 'left') {
        this.store.getContainer().style.paddingLeft = menuWidth + 'px'
      }
    }

    // If fullscreen,
    // set the canvas size and return
    if (this.launchParams.isFullscreen) {
      this.store.getCanvasWrap().style.width = this.calculateFullscreenCanvasSize().width + 'px'
      this.store.getCanvasWrap().style.height = this.calculateFullscreenCanvasSize().height + 'px'
      return
    }

    // Container width
    // if the map is responsive, the container width is the parent width
    // otherwise it's the width of the map
    if (this.store.state.general.responsive) {
      containerWidth = parentWidth
    } else {
      containerWidth = this.store.getArtboard().width
    }

    // Canvas size
    // width is the container width minus the menu width
    // height is the width divided by the artboard ratio
    canvasWidth = containerWidth - menuWidth
    canvasHeight = canvasWidth / artboardRatio

    // Set container and canvas sizes
    this.store.getContainer().style.width = containerWidth + 'px'
    this.store.getCanvasWrap().style.width = canvasWidth + 'px'
    this.store.getCanvasWrap().style.height = canvasHeight + 'px'
  }
  async updateImage() {
    // Called when changing layer
    // Load the new image
    // and change the SRC of the current image
    if (this.store.getArtboard().image_url && this.store.getArtboard().background_type === 'image') {
      let result = await loadImage(this.store.getArtboard().image_url)
      if (this.image) this.image.remove()
      this.image = result.image
      this.image.classList.add('sw-imap-image')
      this.scaleWrap.appendChild(this.image)
    }

    // Update the size after changing the image
    this.adjustSize()
  }
  setBackground() {
    if (this.background) this.background.remove()
    if (this.image) this.image.remove()

    // Image
    if (this.store.getArtboard().background_type === 'image' && this.store.getArtboard().image_url) {
      this.scaleWrap.appendChild(this.image)
    }

    // Color
    if (this.store.getArtboard().background_type === 'color') {
      if (!this.background) {
        this.background = document.createElement('div')
        this.background.classList.add('sw-imap-background')
      }
      this.background.style.background = this.store.getArtboard().background_color
      this.scaleWrap.appendChild(this.background)
    }
  }
  calculateFullscreenCanvasSize() {
    // Calculate new width/height
    let rootElementWidth = window.innerWidth
    let rootElementHeight = window.innerHeight
    let canvasWidth, canvasHeight

    // If there is an object menu, reduce the measured width of the root element
    if (this.store.state.object_list.enable_object_list && !this.store.getIsMenuMobile()) {
      rootElementWidth = rootElementWidth - 240
    }

    // Fit canvas to root element dimensions
    let screenRatio = rootElementWidth / rootElementHeight
    let mapRatio = this.store.getArtboard().width / this.store.getArtboard().height
    if (this.store.getArtboard().use_image_size && this.image) {
      mapRatio = this.image.naturalWidth / this.image.naturalHeight
    }

    if (mapRatio < screenRatio) {
      canvasWidth = rootElementHeight * mapRatio
      canvasHeight = rootElementHeight
    } else {
      canvasWidth = rootElementWidth
      canvasHeight = rootElementWidth / mapRatio
    }

    return {
      width: canvasWidth,
      height: canvasHeight,
    }
  }
}
