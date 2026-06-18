import { mkdtemp, rm, cp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { GitDeployProgress, GitDeployResult } from './git-deploy.js';

/** Transient SSH-key git-deploy config (decrypted at use; never persisted in plaintext). */
export interface GitSshDeployConfig {
  /** An ssh git remote (`ssh://[user@]host[:port]/path` or scp-like `user@host:path`). */
  repoUrl: string;
  /** The branch the built site is force-committed to. */
  branch: string;
  /** The SSH private key CONTENTS (PEM / OpenSSH). */
  privateKey: string;
  /** Passphrase for an encrypted key (omit for an unencrypted deploy key). */
  passphrase?: string;
  /** Optional pinned `known_hosts` host-key line (e.g. `github.com ssh-ed25519 AAAA…`). When omitted,
   *  the host key is trusted on first use (accept-new) — parity with the SFTP target. */
  hostKey?: string;
}

const PUSH_TIMEOUT_MS = 120_000; // connect + transfer budget for the push
const LOCAL_TIMEOUT_MS = 30_000; // the local-only steps (init/add/commit/rev-parse)

/** Run a git subcommand in `cwd` with the prepared SSH env; reject (with a trimmed stderr tail for the
 *  server log — never the key/passphrase, which live in files/askpass, not argv) on non-zero/timeout. */
function runGit(args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs = LOCAL_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error(`git ${args[0]} timed out after ${timeoutMs}ms`));
      if (code === 0) return resolve(stdout);
      const tail = stderr.trim().split('\n').slice(-1)[0] ?? '';
      reject(new Error(`git ${args[0]} failed (exit ${code})${tail ? `: ${tail}` : ''}`));
    });
  });
}

/**
 * Deploys a built site to a branch of a remote git repo over SSH (key auth), by committing it as a
 * single fresh commit and force-pushing (gh-pages style). Unlike the HTTPS-token path (pure-JS
 * isomorphic-git), SSH needs the real `git` + `ssh` binaries: the key + (optional) pinned host key are
 * written to a private temp dir and wired in via `GIT_SSH_COMMAND`. Everything (worktree, key, askpass)
 * is removed in `finally`. Throws on connect/auth/push failure.
 */
export async function deployGitSsh(
  siteDir: string,
  config: GitSshDeployConfig,
  onProgress?: (p: GitDeployProgress) => void,
): Promise<GitDeployResult> {
  const work = await mkdtemp(join(tmpdir(), 'sw-gitssh-')); // the worktree
  const sshDir = await mkdtemp(join(tmpdir(), 'sw-ssh-')); // key + known_hosts + askpass (0700 via mkdtemp)
  try {
    onProgress?.({ phase: 'preparing' });
    // Private key (trailing newline required by OpenSSH), 0600.
    const keyPath = join(sshDir, 'id');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined mkdtemp path
    await writeFile(keyPath, config.privateKey.endsWith('\n') ? config.privateKey : `${config.privateKey}\n`, { mode: 0o600 });
    // Host-key policy: pin if provided (StrictHostKeyChecking=yes against our known_hosts), else accept-new.
    const knownHosts = join(sshDir, 'known_hosts');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined mkdtemp path
    await writeFile(knownHosts, config.hostKey ? `${config.hostKey}\n` : '', { mode: 0o600 });
    const strict = config.hostKey ? 'yes' : 'accept-new';
    // Single-quote the temp paths — they come from mkdtemp (never contain a single quote) but git passes
    // GIT_SSH_COMMAND to `sh -c`, so this survives an unusual TMPDIR (spaces, etc.).
    const sshOpts = [
      `-i '${keyPath}'`,
      '-o IdentitiesOnly=yes',
      '-o PreferredAuthentications=publickey',
      '-o NumberOfPasswordPrompts=0',
      '-o ConnectTimeout=15',
      `-o StrictHostKeyChecking=${strict}`,
      `-o UserKnownHostsFile='${knownHosts}'`,
    ];

    // A MINIMAL env for the subprocess — don't leak the API's secrets (DB url, encryption key, …) into
    // `git`/`ssh`. Only PATH/HOME (to locate the binaries) plus the git/ssh knobs we set explicitly.
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
      GIT_TERMINAL_PROMPT: '0', // never prompt for HTTP creds
      GIT_CONFIG_GLOBAL: '/dev/null', // ignore any ambient git config (hooks/aliases)
      GIT_CONFIG_SYSTEM: '/dev/null',
    };
    if (config.passphrase) {
      // Decrypt the key non-interactively via a forced askpass that echoes the passphrase from the env.
      const askPath = join(sshDir, 'askpass.sh');
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined mkdtemp path
      await writeFile(askPath, '#!/bin/sh\nprintf %s "$SW_SSH_PASSPHRASE"\n', { mode: 0o700 });
      env.SSH_ASKPASS = askPath;
      env.SSH_ASKPASS_REQUIRE = 'force';
      env.DISPLAY = process.env.DISPLAY ?? ':0';
      env.SW_SSH_PASSPHRASE = config.passphrase;
    } else {
      sshOpts.push('-o BatchMode=yes'); // no passphrase → never block on any prompt
    }
    env.GIT_SSH_COMMAND = `ssh ${sshOpts.join(' ')}`;

    await runGit(['init', '-q', '-b', config.branch], work, env);
    await cp(siteDir, work, { recursive: true });
    await runGit(['add', '-A'], work, env);
    onProgress?.({ phase: 'committing' });
    await runGit(
      ['-c', 'user.name=Sitewright', '-c', 'user.email=deploy@sitewright.local', 'commit', '-q', '-m', `Deploy ${new Date().toISOString()}`],
      work,
      env,
    );
    onProgress?.({ phase: 'pushing' });
    // `--` stops option parsing so a repoUrl can never be read as a git flag (argument injection).
    await runGit(['push', '--force', '--', config.repoUrl, `HEAD:refs/heads/${config.branch}`], work, env, PUSH_TIMEOUT_MS);
    const commit = (await runGit(['rev-parse', 'HEAD'], work, env)).trim();
    return { protocol: 'git', branch: config.branch, commit };
  } finally {
    // Independent cleanups — a failure removing the worktree must not strand the private key on disk.
    await rm(work, { recursive: true, force: true }).catch(() => {});
    await rm(sshDir, { recursive: true, force: true }).catch(() => {});
  }
}
