/**
 * Pure planning helpers for the deploy uploaders — remote path math, mkdir planning, bulk-strategy
 * selection, and safe shell quoting. Kept separate from the I/O transports so the decision logic is
 * unit-testable without a live server.
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
 * Picks the bulk-upload strategy: the single-stream tar path when the target supports it AND there
 * are enough files to amortise spinning up remote `tar` (a couple of files go faster as direct
 * puts); otherwise the per-file path (concurrent fastPut on SFTP, sequential on FTP).
 */
export function chooseStrategy(caps: { tar: boolean }, uploadCount: number, tarMinFiles = 4): 'tar' | 'files' {
  return caps.tar && uploadCount >= tarMinFiles ? 'tar' : 'files';
}

/**
 * Single-quotes a string for safe use as ONE argument in a POSIX shell command (wrap in single
 * quotes, escape embedded single quotes). Used for the remote dir in the tar-extract exec command —
 * DeployConfig.remoteDir forbids control chars but may still contain shell metacharacters.
 */
export function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
