/**
 * The stored-config schema version this runtime reads and writes.
 *
 * Upstream injected its npm package version here through a webpack DefinePlugin global
 * (`__VERSION__`); a plain constant keeps the bundle buildable by esbuild with no build-time
 * define, and decouples the CONFIG format from any package version. Bump it only when a change
 * breaks configs already stored, and add the matching migration in ../shared/import.js.
 */
export const CONFIG_VERSION = '6.1.11'
