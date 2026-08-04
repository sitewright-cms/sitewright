// The runtime's internal instance registry + event bus.
//
// Upstream hung all of this off a `window.ImageMapPro` global (instances, subscribe/trigger, and a
// dozen imperative helpers) because its host page had to reach in from author JavaScript. Sitewright
// has no such need — published sites run no tenant JS on the document origin — so the whole surface
// is module-scoped inside the bundled IIFE instead. Nothing of ours lands on `window`.
//
// The declarative equivalent survives as the `data-sw-imap-*` attribute API in ./api/html.js, which
// drives these same functions from ordinary authored markup.

/** Live maps on the page, keyed by config name. */
export const instances = new Map()

/**
 * The map a public action should act on: the one NAMED, or — when the name is missing or unknown —
 * the first map on the page. Upstream open-coded this fallback (`instances[name] ||
 * instances[Object.keys(instances)[0]]`) at twenty-odd call sites and used the strict lookup at
 * five more; folding it into one helper makes the single-map page, which is the common case, work
 * without the author having to know the map's name.
 */
export function getMap(name) {
  const named = instances.get(name)
  if (named) return named
  return instances.values().next().value
}

// Action types are the HOOK_* constants in ./consts.js — single source of truth, imported by
// both the publishers (controllers) and the subscriber in ./api/html.js.

let nextSubscriberId = 1
const subscribers = new Map()

/** Subscribe to bus actions. Returns an id for {@link unsubscribe}. */
export function subscribe(cb) {
  const id = nextSubscriberId++
  subscribers.set(id, cb)
  return id
}

export function unsubscribe(id) {
  subscribers.delete(id)
}

/**
 * Publish an action to every subscriber. A throwing subscriber must not take down the map (or
 * stop the subscribers after it), so each callback is isolated.
 */
export function trigger(action) {
  for (const cb of subscribers.values()) {
    try {
      cb(action)
    } catch {
      // A subscriber's failure is its own; the map carries on.
    }
  }
}
