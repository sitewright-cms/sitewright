/**
 * Pure planning helpers for the deploy uploaders — remote path math and mkdir planning. Kept
 * separate from the I/O transports so the decision logic is unit-testable without a live server.
 */

/** POSIX-joins a validated remote base dir with a POSIX relative path, collapsing duplicate
 *  slashes. `base` is DeployConfig.remoteDir (schema-validated: no control chars, no ".."). */
export function remoteJoin(base: string, rel: string): string {
  const b = base.replace(/\/+$/, ''); // drop trailing slashes on the base
  const r = rel.replace(/^\/+/, ''); //  drop leading slashes on the rel
  const joined = b === '' ? `/${r}` : `${b}/${r}`;
  return joined.replace(/\/{2,}/g, '/');
}

/**
 * Every remote directory that must exist before the given rels can be uploaded, ordered
 * shallowest-first so a plain (non-recursive) mkdir pass creates parents before children.
 * Returns absolute remote dirs (base-joined).
 */
export function planDirs(base: string, rels: readonly string[]): string[] {
  const dirs = new Set<string>();
  for (const rel of rels) {
    const parts = rel.split('/');
    parts.pop(); // drop the filename
    let acc = '';
    for (const seg of parts) {
      acc = acc === '' ? seg : `${acc}/${seg}`;
      dirs.add(remoteJoin(base, acc));
    }
  }
  return [...dirs].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
}

/**
 * The minimal set of LEAF remote dirs (no dir that is a strict prefix of another). A recursive
 * mkdir of each leaf creates all of its ancestors, so mkdir-ing only the leaves — sequentially, to
 * avoid two recursive creates racing on a shared ancestor — covers the whole tree with far fewer
 * round trips than one mkdir per directory.
 */
export function planLeafDirs(base: string, rels: readonly string[]): string[] {
  const all = planDirs(base, rels);
  return all.filter((dir) => !all.some((other) => other !== dir && other.startsWith(`${dir}/`)));
}

/**
 * Every directory needed under `base`, grouped SHALLOWEST FIRST — one array per depth level.
 *
 * ★ WHY DEPTH LEVELS. Creating directories concurrently is safe only if no two in-flight calls can
 * need to create the SAME missing parent. Firing recursive `mkdir` at leaf paths in parallel breaks
 * that: eight siblings under one missing parent race to create it, and the losers do not merely
 * no-op — the library aborts the whole recursive call, so the leaf is never created. MEASURED against
 * a real SFTP server: 8 concurrent recursive mkdirs of siblings sharing one missing parent left
 * **1 of 8** directories in place, and reported "permission denied" rather than anything resembling a
 * race. The deploy then failed much later, on an unrelated-looking `fastPut … no such file or
 * directory`.
 *
 * Level by level, every parent is already in place before its children are attempted and no two
 * concurrent calls ever target the same path — so the pass keeps its parallelism and loses the race.
 */
export function planDirLevels(base: string, rels: readonly string[]): string[][] {
  const byDepth = new Map<number, string[]>();
  for (const dir of planDirs(base, rels)) {
    const depth = dir.split('/').filter(Boolean).length;
    const at = byDepth.get(depth);
    if (at) at.push(dir);
    else byDepth.set(depth, [dir]);
  }
  return [...byDepth.keys()].sort((a, b) => a - b).map((d) => byDepth.get(d)!);
}
