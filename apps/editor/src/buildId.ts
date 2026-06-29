// The content hash of THIS loaded editor bundle — Vite stamps it into the entry filename
// (`assets/index-<hash>.js`). `main.tsx` records it from its own `import.meta.url` at startup; the version
// check (UpdateBanner) compares it to the server's CURRENTLY-DEPLOYED hash (`/version` → `build`) to detect a
// stale tab after a redeploy and prompt a reload. Stays `'dev'` under the Vite dev server (unhashed entry).
export let RUNNING_BUILD = 'dev';

export function recordRunningBuild(url: string): void {
  const m = url.match(/index-([A-Za-z0-9_-]+)\.js/);
  if (m) RUNNING_BUILD = m[1]!;
}
