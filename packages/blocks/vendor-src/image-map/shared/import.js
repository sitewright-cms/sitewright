import * as utilities from 'imap-shared/utilities'
import * as defaults from 'imap/scripts/defaults'
import * as consts from 'imap-shared/consts'
import { CONFIG_VERSION } from 'imap/version'

export function importSettings(settings) {
  let parsed = parseSettings(settings)
  let extended = extend(parsed)

  extended.artboards = modifyObjects(extended.artboards)
  return extended
}

function extend(settings) {
  let extended = utilities.deepExtend({}, defaults.imageMapDefaults, settings)
  extended.artboards = extendArtboards(extended.artboards)
  return extended
}

function extendArtboards(artboards) {
  let extendedArtboards = []

  if (artboards.length === 0) {
    artboards = [utilities.deepExtend({}, defaults.artboardDefaults)]
  }

  for (let artboard of artboards) {
    let extendedArtboard = utilities.deepExtend({}, defaults.artboardDefaults, artboard)
    // ★ An artboard that names an IMAGE gets an image background, unless it says otherwise.
    //
    // The default is `background_type: 'color'` (white), so a config carrying `image_url` and nothing
    // else painted a blank white box and silently ignored the image — which is exactly what every
    // code-first example in the docs did, and what anyone writing the obvious config gets. Inferred
    // ONLY when the config left `background_type` unset: an explicit choice still wins, so a map that
    // deliberately pairs an image_url with a colour background is untouched.
    if (artboard && artboard.background_type === undefined && typeof artboard.image_url === 'string' && artboard.image_url !== '') {
      extendedArtboard.background_type = 'image'
    }
    extendedArtboard.children = extendObjects(artboard.children)
    extendedArtboards.push(extendedArtboard)
  }

  return extendedArtboards
}

function extendObjects(objects) {
  let result = []
  if (objects) {
    for (let object of objects) {
      let extendedObject = utilities.deepExtend({}, defaults.objectDefaults, object)
      extendedObject.children = extendObjects(object.children)
      result.push(extendedObject)
    }
  }

  return result
}

// Bring a stored config up to CONFIG_VERSION. Sitewright only ever stores configs written by its
// own Studio (validated by the ImageMapConfig Zod schema on the way in), so the upstream
// pre-6.0.0 "legacy" branch has no reachable input here and was dropped with import-legacy.js.
// A config with no version is treated as current — the schema already guarantees its shape.
function parseSettings(settings) {
  // versionCompare: v1 > v2 => 1, v1 < v2 => -1, equal => 0.
  if (!settings.version) return { ...settings, version: CONFIG_VERSION }
  if (utilities.versionCompare(CONFIG_VERSION, settings.version) === 0) return settings

  // Migration hook: when a change breaks stored configs, bump CONFIG_VERSION and add a
  // `if (utilities.versionCompare(settings.version, '<new>') === -1) { … }` block here.
  return { ...utilities.deepExtend({}, settings), version: CONFIG_VERSION }
}

function modifyObjects(objects) {
  for (let obj of objects) {
    if (obj.type !== consts.OBJECT_ARTBOARD) {
      // Don't show empty tooltips
      if (obj.tooltip_content.length === 0) obj.tooltip.enable_tooltip = false
    }
    if (obj.children) modifyObjects(obj.children)
  }

  return objects
}
