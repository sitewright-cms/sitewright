// Thin shim: the pure BODY gate diff now lives in the package TS source (src/fidelity/gate.ts) so the CLI,
// its tests, and the server-side MCP `fidelity_check` tool share ONE implementation. Re-exported from the
// BUILT dist so the `node`-run CLI (which can't import .ts) resolves it. Build the package before running.
export { firstFamily, stripWs, weightNum, skewDeg, lsPx, radiusPx, hasShadow, matchAndDiff, scorePage } from '../dist/fidelity/gate.js';
