// esbuild alias target for SmartPhoto's IE-only side-effect polyfills
// (custom-event-polyfill, ie-array-find-polyfill). The platform targets modern
// browsers — CustomEvent and Array.prototype.find are native — so these are stubbed
// to an empty module at bundle time (scripts/gen-vendor.mjs) rather than shipped.
export default {};
