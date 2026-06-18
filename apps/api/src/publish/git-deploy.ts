import { mkdtemp, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nodeFs from 'node:fs';
import * as git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';

/** Transient git-deploy config (decrypted at use; never persisted in plaintext). */
export interface GitDeployConfig {
  /** The remote repository — http(s) only (token auth). */
  repoUrl: string;
  /** The branch the built site is force-committed to. */
  branch: string;
  /** A personal-access token used for HTTPS auth (sent as the basic-auth username). */
  token: string;
}

/** Live progress for the streaming git deploy. */
export interface GitDeployProgress {
  phase: 'preparing' | 'committing' | 'pushing';
}

/** Cap a single push so a hung/slow remote can't hold the per-project deploy lock open forever
 *  (isomorphic-git's `push` has no timeout/abort of its own). */
const PUSH_TIMEOUT_MS = 60_000;

/** Result of a successful git deploy. */
export interface GitDeployResult {
  protocol: 'git';
  branch: string;
  /** The pushed commit SHA. */
  commit: string;
}

/**
 * Deploys a built site directory to a branch of a remote git repo by committing it as a SINGLE fresh
 * commit and force-pushing (gh-pages style — the branch always mirrors the latest build, no history
 * accumulation). Pure JS (isomorphic-git over HTTP), so no git binary is required in the image.
 *
 * Auth is an HTTPS personal-access token sent as the basic-auth USERNAME (the form GitHub accepts;
 * other providers may need a provider-specific username — a follow-up adds SSH + a username field).
 * The token is used transiently and never logged. Throws on connect/auth/push failure.
 */
export async function deployGit(
  siteDir: string,
  config: GitDeployConfig,
  onProgress?: (p: GitDeployProgress) => void,
): Promise<GitDeployResult> {
  // A throwaway worktree: init → copy the built site → commit → force-push.
  const dir = await mkdtemp(join(tmpdir(), 'sw-git-'));
  try {
    onProgress?.({ phase: 'preparing' });
    await git.init({ fs: nodeFs, dir, defaultBranch: config.branch });
    // Copy the built artifact INTO the worktree (alongside the fresh .git). The site never contains a
    // `.git` of its own, so a plain recursive copy is safe.
    await cp(siteDir, dir, { recursive: true });
    await git.add({ fs: nodeFs, dir, filepath: '.' });
    onProgress?.({ phase: 'committing' });
    const commit = await git.commit({
      fs: nodeFs,
      dir,
      message: `Deploy ${new Date().toISOString()}`,
      author: { name: 'Sitewright', email: 'deploy@sitewright.local' },
    });
    onProgress?.({ phase: 'pushing' });
    // isomorphic-git's `push` cannot be aborted, so race it against a timeout. The losing push promise
    // keeps running detached (its rejection is swallowed); the lock + SSE are freed by our throw.
    const pushed = git.push({
      fs: nodeFs,
      http,
      dir,
      url: config.repoUrl,
      ref: config.branch,
      remoteRef: config.branch,
      force: true,
      onAuth: () => ({ username: config.token, password: '' }),
    });
    pushed.catch(() => {}); // detached loser must not become an unhandled rejection
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        pushed,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`git push timed out after ${PUSH_TIMEOUT_MS}ms`)), PUSH_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    return { protocol: 'git', branch: config.branch, commit };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
