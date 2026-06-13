// esbuild alias target for SmartPhoto's `es6-promise-polyfill` import. SmartPhoto does
// `const { Promise } = require('es6-promise-polyfill')` and uses it — so unlike the
// side-effect polyfills this can't be stubbed empty. We re-export the NATIVE Promise
// (the platform targets modern browsers), dropping the ~6KB IE polyfill from the bundle.
const g = typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : window;
export const Promise = g.Promise;
export default { Promise: g.Promise };
