import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseLsRemote, sshProbe } from '../src/publish/git-test.js';

const exec = promisify(execFile);

/**
 * The git probe against a REAL repository.
 *
 * The faked-remote suite covers the reporting; this covers the plumbing underneath it — spawning
 * `git`, parsing `ls-remote`, and the dry-run push that is the whole reason the write step can claim
 * anything. A local bare repository exercises all of it without a network or an SSH server: the
 * transport is git's business, the sequencing is ours.
 *
 * ★ It also pins the property the write probe RESTS on — that `--dry-run` really writes nothing. If
 * that were ever false, a "Test connection" click would silently mutate a customer's repository.
 */

let root: string;
let bare: string;
let work: string;
const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };

/** Branch names in the bare repo, straight from git (not through our parser). */
async function remoteBranches(): Promise<string[]> {
  const { stdout } = await exec('git', ['ls-remote', '--heads', bare], { env });
  return stdout
    .split('\n')
    .map((l) => /refs\/heads\/(.+)$/.exec(l.trim())?.[1])
    .filter((n): n is string => !!n);
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'sw-gitprobe-'));
  bare = join(root, 'origin.git');
  work = join(root, 'work');
  await exec('git', ['init', '--bare', '-b', 'main', bare], { env });
  await exec('git', ['init', '-b', 'main', work], { env });
  await writeFile(join(work, 'index.html'), '<h1>hi</h1>\n');
  await exec('git', ['add', '-A'], { cwd: work, env });
  await exec('git', ['-c', 'user.name=T', '-c', 'user.email=t@e.x', 'commit', '-m', 'init'], { cwd: work, env });
  await exec('git', ['push', bare, 'main'], { cwd: work, env });
}, 60_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const cfg = (branch: string) => ({
  repoUrl: bare,
  branch,
  privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nnot-used-for-a-local-path\n-----END OPENSSH PRIVATE KEY-----',
});

describe('sshProbe against a real repository', () => {
  it('lists the remote branches and completes the dry-run push', async () => {
    const result = await sshProbe(cfg('main'));
    expect(result.heads).toEqual(['main']);
  }, 60_000);

  // ★ The claim the write step makes. A dry-run that actually pushed would mean clicking "Test"
  // rewrote the customer's branch.
  it('writes NOTHING — the branch it probes does not appear', async () => {
    expect(await remoteBranches()).toEqual(['main']);
    await sshProbe(cfg('gh-pages'));
    expect(await remoteBranches()).toEqual(['main']); // gh-pages was never created
  }, 60_000);

  it('does not disturb the branch it probes when that branch already exists', async () => {
    const { stdout: before } = await exec('git', ['ls-remote', bare, 'refs/heads/main'], { env });
    await sshProbe(cfg('main'));
    const { stdout: after } = await exec('git', ['ls-remote', bare, 'refs/heads/main'], { env });
    expect(after).toBe(before); // same SHA — the force-push was genuinely a no-op
  }, 60_000);

  it('rejects with git\'s own words when the repository does not exist', async () => {
    await expect(sshProbe({ ...cfg('main'), repoUrl: join(root, 'nope.git') })).rejects.toThrow(/ls-remote failed/);
  }, 60_000);

  it('reports no host key when one is already pinned', async () => {
    const result = await sshProbe({ ...cfg('main'), hostKey: 'github.com ssh-ed25519 AAAA' });
    expect(result.heads).toEqual(['main']);
    expect(result.hostKeyLine).toBeUndefined(); // nothing new to learn when a pin is set
  }, 60_000);

  it('accepts a passphrase-protected key without ever blocking on a prompt', async () => {
    // The passphrase reaches ssh through a forced askpass script rather than a TTY. A local path never
    // invokes ssh, so what this pins is that the askpass branch is wired and cannot hang the probe.
    const result = await sshProbe({ ...cfg('main'), passphrase: 'secret' });
    expect(result.heads).toEqual(['main']);
  }, 60_000);

  it('leaves no temp directory holding the private key behind', async () => {
    // The key is written 0600 into a mkdtemp dir removed in `finally`; a failing probe must clean up
    // just as a passing one does.
    await sshProbe(cfg('main')).catch(() => {});
    await sshProbe({ ...cfg('main'), repoUrl: join(root, 'nope.git') }).catch(() => {});
    const { stdout } = await exec('sh', ['-c', `ls -d ${tmpdir()}/sw-ssh-* 2>/dev/null | wc -l`]);
    expect(Number(stdout.trim())).toBe(0);
  }, 60_000);
});

describe('sshProbe when the environment is broken', () => {
  // The probe spawns `git`; if the binary cannot be found the spawn errors rather than exiting
  // non-zero, which is a different code path — and one that must produce a REPORT, not a hang.
  it('rejects when the git binary cannot be found', async () => {
    const path = process.env.PATH;
    try {
      process.env.PATH = '/nonexistent';
      await expect(sshProbe(cfg('main'))).rejects.toThrow();
    } finally {
      process.env.PATH = path;
    }
  }, 60_000);
});

describe('parseLsRemote', () => {
  it('reads branch names out of ls-remote output', () => {
    expect(parseLsRemote('abc123\trefs/heads/main\ndef456\trefs/heads/gh-pages\n')).toEqual(['main', 'gh-pages']);
  });

  it('keeps a branch name containing slashes intact', () => {
    expect(parseLsRemote('abc\trefs/heads/feature/deploy-test\n')).toEqual(['feature/deploy-test']);
  });

  it('ignores tags and blank lines', () => {
    expect(parseLsRemote('abc\trefs/tags/v1\n\ndef\trefs/heads/main\n')).toEqual(['main']);
  });

  it('returns nothing for an empty repository', () => {
    expect(parseLsRemote('')).toEqual([]);
  });
});
