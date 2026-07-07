// Thin shim: the pure CHROME (nav/footer) gate diff now lives in the package TS source (src/fidelity/gate.ts)
// so the CLI, its tests, and the server-side MCP `fidelity_check` tool share ONE implementation. Re-exported
// from the BUILT dist so the `node`-run CLI resolves it. Build the package before running.
export { matchChrome, scoreChrome, scoreChromeMeta } from '../dist/fidelity/gate.js';
