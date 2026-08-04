// The other controlls can choose between cached data
// and live data at a higher performance cost.

export default class CacheController {
  cacheTTL = 250
  invalidateCacheInterval = undefined
  cache = {}

  constructor(cacheTTL = 250) {
    this.cacheTTL = cacheTTL
    this.invalidateCacheInterval = setInterval(() => {
      this.cache = {}
    }, this.cacheTTL);
  }
  setValue(name, value) {
    this.cache[name] = value
  }
  getValue(name) {
    return this.cache[name]
  }
}