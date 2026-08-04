// Image Map runtime ENTRY — bundled by scripts/gen-vendor.mjs into
// src/vendor/image-map-runtime.ts. First-party source lives in ./image-map/ (see its README):
// a fork of Image Map Pro 6.1.11, licensed for modification and integration, with every
// code-execution path, jQuery shim and legacy-format converter removed and the whole DOM/CSS
// surface renamed to `sw-imap-*`.
//
// The authored contract is declarative — `data-sw-component="image-map"` wrapping a
// `<script type="application/json" data-sw-part="config">` block. Agents and tenants author
// that markup and the map CONFIG; they never call the runtime.
//
//   <div data-sw-component="image-map">
//     <img src="/media/acme/a1b2c3-floorplan.jpg" alt="Ground floor">
//     <script type="application/json" data-sw-part="config">{"general":{…},"artboards":[…]}</script>
//   </div>
//
// Anything else inside the root is the NO-JS fallback (put a plain <img> there — the runtime
// replaces the root's content once it has a usable config, so the image shows when JS is off or
// the config fails to parse). Page elements elsewhere can drive the map through the
// `data-sw-imap-*` attributes in ./image-map/src/api/html.js.
import { init } from 'imap/init'
import { installAttributeApi } from 'imap/api/html'
import 'imap-css/index.css'

// The config a root carries, or null when it has none / it doesn't parse. A broken config must
// leave the fallback markup untouched rather than blanking the element.
function readConfig(root) {
  var el = root.querySelector('script[type="application/json"][data-sw-part="config"]')
  if (!el) return null
  try {
    var config = JSON.parse(el.textContent || '')
    return config && typeof config === 'object' ? config : null
  } catch {
    return null
  }
}

var mapCount = 0

function enhance(root) {
  if (root.getAttribute('data-sw-enhanced') === 'true') return
  var config = readConfig(root)
  if (!config) return

  // The map's name is its key in the instance registry, which is what data-sw-imap-map resolves
  // against — so it has to be unique per page. Prefer the config's own name, then the element id;
  // fall back to a counter rather than a constant, or two unnamed maps would collide and the
  // second would evict the first.
  mapCount++
  if (!config.general) config.general = {}
  if (!config.general.name) config.general.name = root.id || 'Map ' + mapCount
  // Likewise the id, which scopes generated element ids. The config default is a literal 0, so
  // two configs that never set one are indistinguishable.
  if (!config.id) config.id = 'sw-imap-' + mapCount

  root.setAttribute('data-sw-enhanced', 'true')
  init(root, config)
}

function boot() {
  installAttributeApi()
  Array.prototype.forEach.call(document.querySelectorAll('[data-sw-component="image-map"]'), enhance)
}
if (document.readyState !== 'loading') boot()
else document.addEventListener('DOMContentLoaded', boot)
