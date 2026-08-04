import { ImageMap } from 'imap/imageMap'
import { instances } from 'imap/runtime'

/**
 * Mount a map into `target` (an element or a selector) from a config object.
 *
 * Kept in its own module because the fullscreen controller re-enters it to mount the blown-up
 * copy of a map — importing it from `./imageMap.js` directly would be a module cycle through the
 * controller. The reference here is resolved at call time, so the cycle is inert.
 */
export function init(target, config, launchParams = {}) {
  const map = new ImageMap(target, config, launchParams)
  instances.set(config.general?.name || 'Default', map)
  return map
}
