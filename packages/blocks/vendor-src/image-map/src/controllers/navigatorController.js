import Navigator from 'imap/UI/navigator'

export default class NavigatorController {
  store = undefined
  navigator = undefined

  // Pan functionality
  ix = 0
  iy = 0

  constructor(store) {
    this.store = store

    // If zooming or navigator is not enabled, just return
    if (!this.store.state.zooming.enable_zooming || !this.store.state.zooming.enable_navigator) {
      this.navigator = {
        element: document.createElement('div'),
        adjustSize: () => { }
      }
      return
    }

    this.store.subscribe(this.handleAction.bind(this))
    this.createUI()
  }

  createUI() {
    if (!this.store.state.zooming.enable_zooming || !this.store.state.zooming.enable_navigator) return
    if (this.navigator) this.navigator.element.remove()

    this.navigator = new Navigator(this.store)
  }
  insertUI() {
    if (!this.store.state.zooming.enable_zooming || !this.store.state.zooming.enable_navigator) return

    if (this.store.state.object_list.enable_object_list &&
      this.store.state.object_list.menu_style === 'on-top' &&
      this.store.state.object_list.menu_position === 'left') {

      this.store.getUIWrap().querySelector('.sw-imap-ui-bottom-right').appendChild(this.navigator.element)
    } else {
      this.store.getUIWrap().querySelector('.sw-imap-ui-bottom-left').appendChild(this.navigator.element)
    }

    this.navigator.adjustSize()
  }
  handleAction(action) {
    if (action.type == 'resize') {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this.navigator.adjustSize()
          this.navigator.redraw()
        })
      })
    }
    if (action.type == 'panOnNavigator') {
      this.pan({ x: action.payload.x, y: action.payload.y })
    }
    if (action.type == 'zoomUpdate') {
      this.navigator.redraw()
    }
  }
  pan({ x, y }) {
    // x and y are mouse coords
    // Convert mouse coords on the navigator
    // to pixel coordinates on the canvas
    let panToX = (x - this.store.getNavigatorRect().offset.left) / this.navigator.ratio * this.store.getZoom()
    let panToY = (y - this.store.getNavigatorRect().offset.top) / this.navigator.ratio * this.store.getZoom()

    this.store.dispatch('panTo', { x: panToX, y: panToY })
  }
}