import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import * as git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import { isSshRepoUrl, gitRepoHost } from '@sitewright/schema';
import { describeDeployError } from './deploy-errors.js';
import { step, type DeployTestResult, type DeployTestStep } from './deploy-test.js';

/**
 * The CONNECTION TEST for a `git` deploy target.
 *
 * ★ The question a git target actually fails on is not "can I reach the repository" — it is "may this
 * credential PUSH to it". A token scoped to read, or a deploy key added without "Allow write access",
 * clones perfectly and then fails at the last step of a deploy, after a full site build. Both dialects
 * of git report that as a 403 / "Could not read from remote repository", which the old single-sentence
 * error rendered identically to a wrong credential — sending operators to regenerate a token that was
 * never the problem.
 *
 * So the write probe is the point of this file, and both transports do it WITHOUT mutating anything:
 *
 *  - **HTTPS** asks for the `git-receive-pack` service rather than `git-upload-pack`
 *    (`getRemoteInfo({ forPush: true })`). Hosts refuse that advertisement outright for a credential
 *    that may not write, so the answer arrives before a single object is sent.
 *  - **SSH** runs a real `git push --force --dry-run`. `--dry-run` does everything except send the
 *    update: the remote's receive-pack runs and applies its permission check, and no ref moves.
 *
 * Timeouts are the same shape as the deploy path's, so a test cannot hang longer than the thing it
 * predicts.
 */

/** Budget for a single remote round trip (ls-remote / receive-pack advertisement / dry-run push). */
const GIT_TEST_TIMEOUT_MS = 30_000;
/** Local-only git steps (init/commit) — fast, but never unbounded. */
const GIT_LOCAL_TIMEOUT_MS = 15_000;

/** Transient config for testing a git target (decrypted at use; never persisted in plaintext). */
export interface GitTestConfig {
  repoUrl: string;
  branch: string;
  /** HTTPS remote: a personal-access token. */
  token?: string;
  /** SSH remote: the PRIVATE KEY CONTENTS. */
  privateKey?: string;
  passphrase?: string;
  /** Optional pinned `known_hosts` line (SSH remotes). */
  hostKey?: string;
}

/** Injectable seams so the orchestration is unit-testable without a remote (parity with deploy-test). */
export interface GitTestDeps {
  /** Lists the remote's refs, asking for PUSH capabilities. */
  remoteInfo?: (cfg: GitTestConfig) => Promise<{ heads: string[] }>;
  /** Runs the SSH probe, returning the branches it saw and the host-key line it learned. */
  sshProbe?: (cfg: GitTestConfig) => Promise<{ heads: string[]; hostKeyLine?: string }>;
}

/** Spawns `git`, resolving stdout or rejecting with a trimmed stderr tail (never the key/passphrase,
 *  which live in files and askpass rather than argv). Mirrors runGit in git-ssh-deploy.ts. */
function runGit(args: string[], cwd: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error(`git ${args[0]} timed out after ${timeoutMs}ms`));
      if (code === 0) return resolve(stdout);
      // Keep the WHOLE stderr tail here, not just its last line: git's most useful sentence
      // ("ERROR: Permission to x/y denied to key") is often followed by a generic one.
      const tail = stderr.trim().split('\n').slice(-3).join(' — ');
      reject(new Error(`git ${args[0]} failed (exit ${code})${tail ? `: ${tail}` : ''}`));
    });
  });
}

/** Branch names out of `git ls-remote --heads` output ("<sha>\trefs/heads/<name>"). */
export function parseLsRemote(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((line) => /refs\/heads\/(.+)$/.exec(line.trim())?.[1])
    .filter((name): name is string => !!name);
}

/**
 * The SSH probe: `ls-remote` (reach + host key + key auth + repo path), then a dry-run force-push of a
 * throwaway empty commit (write permission). The key, known_hosts and worktree live in private temp
 * dirs removed in `finally` — a failure removing one must not strand a private key on disk.
 */
/* Exported for tests: driving this against a real local repository is what covers `runGit`, the
   ls-remote parse and the dry-run push — the parts that are ours rather than git's. */
export async function sshProbe(cfg: GitTestConfig): Promise<{ heads: string[]; hostKeyLine?: string }> {
  const work = await mkdtemp(join(tmpdir(), 'sw-gittest-'));
  const sshDir = await mkdtemp(join(tmpdir(), 'sw-ssh-'));
  try {
    const keyPath = join(sshDir, 'id');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined mkdtemp path
    await writeFile(keyPath, cfg.privateKey!.endsWith('\n') ? cfg.privateKey! : `${cfg.privateKey!}\n`, { mode: 0o600 });
    const knownHosts = join(sshDir, 'known_hosts');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined mkdtemp path
    await writeFile(knownHosts, cfg.hostKey ? `${cfg.hostKey}\n` : '', { mode: 0o600 });
    const sshOpts = [
      `-i '${keyPath}'`,
      '-o IdentitiesOnly=yes',
      '-o PreferredAuthentications=publickey',
      '-o NumberOfPasswordPrompts=0',
      '-o ConnectTimeout=15',
      `-o StrictHostKeyChecking=${cfg.hostKey ? 'yes' : 'accept-new'}`,
      `-o UserKnownHostsFile='${knownHosts}'`,
    ];
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
      GIT_TERMINAL_PROMPT: '0',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
    };
    if (cfg.passphrase) {
      const askPath = join(sshDir, 'askpass.sh');
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined mkdtemp path
      await writeFile(askPath, '#!/bin/sh\nprintf %s "$SW_SSH_PASSPHRASE"\n', { mode: 0o700 });
      env.SSH_ASKPASS = askPath;
      env.SSH_ASKPASS_REQUIRE = 'force';
      env.DISPLAY = process.env.DISPLAY ?? ':0';
      env.SW_SSH_PASSPHRASE = cfg.passphrase;
    } else {
      sshOpts.push('-o BatchMode=yes');
    }
    env.GIT_SSH_COMMAND = `ssh ${sshOpts.join(' ')}`;

    // `--` stops option parsing so a repoUrl can never be read as a git flag (argument injection).
    const heads = parseLsRemote(await runGit(['ls-remote', '--heads', '--', cfg.repoUrl], work, env, GIT_TEST_TIMEOUT_MS));

    // The write probe needs a commit to offer. An empty one is enough — `--dry-run` never sends it.
    await runGit(['init', '-q', '-b', 'probe'], work, env, GIT_LOCAL_TIMEOUT_MS);
    await runGit(
      ['-c', 'user.name=Sitewright', '-c', 'user.email=deploy@sitewright.local', 'commit', '-q', '--allow-empty', '-m', 'connection test'],
      work,
      env,
      GIT_LOCAL_TIMEOUT_MS,
    );
    await runGit(
      ['push', '--force', '--dry-run', '--', cfg.repoUrl, `HEAD:refs/heads/${cfg.branch}`],
      work,
      env,
      GIT_TEST_TIMEOUT_MS,
    );

    // With accept-new, ssh has just written the host's key here — report it so it can be PINNED.
    // (A target that already pins one learns nothing new, so only the un-pinned case reads it back.)
    let hostKeyLine: string | undefined;
    if (!cfg.hostKey) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- confined mkdtemp path
      const learned = await readFile(knownHosts, 'utf8').catch(() => '');
      hostKeyLine = learned.split('\n').find((l) => l.trim() && !l.startsWith('#'))?.trim();
    }
    return { heads, ...(hostKeyLine ? { hostKeyLine } : {}) };
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
    await rm(sshDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** The HTTPS probe: one `git-receive-pack` advertisement, which answers reach, auth AND push access. */
async function httpsProbe(cfg: GitTestConfig): Promise<{ heads: string[] }> {
  const info = await git.getRemoteInfo({
    http,
    url: cfg.repoUrl,
    // The token goes in the basic-auth USERNAME, matching deployGit — a provider that wants it in the
    // password would fail here exactly as it would on a real deploy, which is the point.
    onAuth: () => ({ username: cfg.token ?? '', password: '' }),
    forPush: true,
  });
  const heads = (info.refs as { heads?: Record<string, string> } | undefined)?.heads;
  return { heads: heads ? Object.keys(heads) : [] };
}

/**
 * Tests a git deploy target: reach the remote, authenticate, confirm PUSH access, and report whether
 * the configured branch already exists.
 *
 * A missing branch is reported as `skipped`, not `failed` — the deploy force-creates it (gh-pages
 * style), so treating "not there yet" as an error would fail every correctly-configured first deploy.
 */
export async function testGitTarget(cfg: GitTestConfig, deps: GitTestDeps = {}): Promise<DeployTestResult> {
  const ssh = isSshRepoUrl(cfg.repoUrl);
  const host = gitRepoHost(cfg.repoUrl);
  const endpoint = { protocol: 'git', host, port: ssh ? 22 : 443 };
  const startedAt = Date.now();
  const steps: DeployTestStep[] = [];
  const base = { protocol: 'git' as const, host, port: endpoint.port, steps };

  try {
    const probe = ssh
      ? await step(steps, 'connect', `Contact ${host} over SSH`, () => (deps.sshProbe ?? sshProbe)(cfg))
      : await step(steps, 'connect', `Contact ${host} over HTTPS`, () => (deps.remoteInfo ?? httpsProbe)(cfg));

    steps.push({
      key: 'auth',
      label: ssh ? 'Authenticate with the SSH key' : 'Authenticate with the access token',
      status: 'ok',
    });
    steps.push({
      key: 'write',
      label: `Confirm push access to ${cfg.branch}`,
      status: 'ok',
      detail: ssh
        ? 'a dry-run force-push was accepted — nothing was written'
        : 'the remote granted git-receive-pack — nothing was written',
    });
    const exists = probe.heads.includes(cfg.branch);
    steps.push({
      key: 'branch',
      label: `Branch ${cfg.branch}`,
      status: exists ? 'ok' : 'skipped',
      detail: exists
        ? `exists on the remote (${probe.heads.length} branch${probe.heads.length === 1 ? '' : 'es'} total)`
        : 'does not exist yet — the first deploy creates it',
    });

    const hostKeyLine = (probe as { hostKeyLine?: string }).hostKeyLine;
    return {
      ...base,
      ok: true,
      security: ssh ? 'ssh' : 'https',
      ...(hostKeyLine ? { hostKeyLine } : {}),
      elapsedMs: Date.now() - startedAt,
    };
  } catch (err) {
    return { ...base, ok: false, failure: describeDeployError(err, endpoint), elapsedMs: Date.now() - startedAt };
  }
}
