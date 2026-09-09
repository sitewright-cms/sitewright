import { describe, it, expect } from 'vitest';
import { testGitTarget, type GitTestConfig } from '../src/publish/git-test.js';

/**
 * The git connection test's orchestration, with the remote faked.
 *
 * The behaviour worth pinning is what a git target actually gets WRONG: a credential that can read
 * but not push, and a branch that does not exist yet. The first must be reported as a permission
 * problem (not a bad credential), and the second must NOT be a failure — the deploy force-creates it,
 * so failing there would fail every correctly-configured first deploy.
 */

const https: GitTestConfig = { repoUrl: 'https://github.com/acme/site.git', branch: 'gh-pages', token: 'ghp_x' };
const ssh: GitTestConfig = { repoUrl: 'git@github.com:acme/site.git', branch: 'gh-pages', privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nx\n-----END OPENSSH PRIVATE KEY-----' };

const stepMap = (r: { steps: Array<{ key: string; status: string }> }): Record<string, string> =>
  Object.fromEntries(r.steps.map((s) => [s.key, s.status]));

/** An isomorphic-git HttpError: the status lives in `data`, not in `code`. */
function httpError(statusCode: number, message: string): Error {
  return Object.assign(new Error(message), { code: 'HttpError', data: { statusCode } });
}

describe('git connection test — HTTPS remote', () => {
  it('confirms push access and reports the branch as existing', async () => {
    const result = await testGitTarget(https, { remoteInfo: async () => ({ heads: ['main', 'gh-pages'] }) });
    expect(result.ok).toBe(true);
    expect(result.protocol).toBe('git');
    expect(result.host).toBe('github.com');
    expect(result.port).toBe(443);
    expect(result.security).toBe('https');
    expect(stepMap(result)).toEqual({ connect: 'ok', auth: 'ok', write: 'ok', branch: 'ok' });
    // The write step must say what actually proved it — and that nothing was written.
    expect(result.steps.find((s) => s.key === 'write')?.detail).toMatch(/receive-pack.*nothing was written/);
  });

  // ★ A gh-pages branch that does not exist yet is the NORMAL first-deploy state.
  it('treats a branch that does not exist yet as informational, not a failure', async () => {
    const result = await testGitTarget(https, { remoteInfo: async () => ({ heads: ['main'] }) });
    expect(result.ok).toBe(true);
    expect(stepMap(result).branch).toBe('skipped');
    expect(result.steps.find((s) => s.key === 'branch')?.detail).toMatch(/first deploy creates it/);
  });

  it('handles a completely empty repository', async () => {
    const result = await testGitTarget(https, { remoteInfo: async () => ({ heads: [] }) });
    expect(result.ok).toBe(true);
    expect(stepMap(result).branch).toBe('skipped');
  });

  it('names a 403 as an under-scoped credential, NOT a wrong one', async () => {
    const result = await testGitTarget(https, {
      remoteInfo: () => Promise.reject(httpError(403, 'HTTP Error: 403 Forbidden')),
    });
    expect(result.ok).toBe(false);
    expect(result.failure?.kind).toBe('permission');
    expect(result.failure?.message).toMatch(/refuses to let it PUSH/);
    expect(result.failure?.hint).toMatch(/valid and under-scoped/);
  });

  it('names a 401 as a rejected token, with the scope it needs', async () => {
    const result = await testGitTarget(https, { remoteInfo: () => Promise.reject(httpError(401, 'HTTP Error: 401 Unauthorized')) });
    expect(result.failure?.kind).toBe('auth');
    expect(result.failure?.hint).toMatch(/Contents: Read and write|`repo`/);
  });

  it('explains that a 404 can mean "private and invisible to this credential"', async () => {
    const result = await testGitTarget(https, { remoteInfo: () => Promise.reject(httpError(404, 'HTTP Error: 404 Not Found')) });
    expect(result.failure?.kind).toBe('path');
    expect(result.failure?.hint).toMatch(/private repository/i);
  });

  it('reports an unreachable host from a wrapped transport error', async () => {
    const result = await testGitTarget(https, {
      // node-fetch/isomorphic-git leave the libuv code in the PROSE, not in `code`.
      remoteInfo: () => Promise.reject(new Error('request to https://github.com/ failed, reason: connect ECONNREFUSED 140.82.0.1:443')),
    });
    expect(result.failure?.kind).toBe('refused');
  });

  it('marks the step that failed, so the panel shows where it stopped', async () => {
    const result = await testGitTarget(https, { remoteInfo: () => Promise.reject(httpError(403, 'forbidden')) });
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({ key: 'connect', status: 'failed' });
  });
});

describe('git connection test — SSH remote', () => {
  it('uses the SSH probe, reports SSH security, and surfaces the host key for pinning', async () => {
    const result = await testGitTarget(ssh, {
      sshProbe: async () => ({ heads: ['gh-pages'], hostKeyLine: 'github.com ssh-ed25519 AAAAC3Nz' }),
    });
    expect(result.ok).toBe(true);
    expect(result.security).toBe('ssh');
    expect(result.port).toBe(22);
    expect(result.hostKeyLine).toBe('github.com ssh-ed25519 AAAAC3Nz');
    expect(result.steps.find((s) => s.key === 'write')?.detail).toMatch(/dry-run.*nothing was written/);
  });

  it('omits the host key when one is already pinned — there is nothing new to learn', async () => {
    const result = await testGitTarget({ ...ssh, hostKey: 'github.com ssh-ed25519 AAAAC3Nz' }, {
      sshProbe: async () => ({ heads: ['gh-pages'] }),
    });
    expect(result.ok).toBe(true);
    expect(result.hostKeyLine).toBeUndefined();
  });

  it('names a rejected key as such, and points at the deploy-key write checkbox', async () => {
    const result = await testGitTarget(ssh, {
      sshProbe: () =>
        Promise.reject(new Error('git ls-remote failed (exit 128): git@github.com: Permission denied (publickey). — fatal: Could not read from remote repository.')),
    });
    expect(result.failure?.kind).toBe('auth');
    expect(result.failure?.hint).toMatch(/deploy key/i);
  });

  it('names a host-key mismatch as a pin failure, using OpenSSH\'s actual wording', async () => {
    const result = await testGitTarget({ ...ssh, hostKey: 'github.com ssh-ed25519 WRONG' }, {
      sshProbe: () => Promise.reject(new Error('git ls-remote failed (exit 128): Host key verification failed.')),
    });
    expect(result.failure?.kind).toBe('host-key');
  });

  it('reports a read-only deploy key as a permission problem when the dry-run push is refused', async () => {
    const result = await testGitTarget(ssh, {
      sshProbe: () => Promise.reject(new Error('git push failed (exit 128): ERROR: Permission to acme/site.git denied to deploy key.')),
    });
    expect(result.failure?.kind).toBe('permission');
  });

  it('reports a timeout rather than blaming the credentials', async () => {
    const result = await testGitTarget(ssh, { sshProbe: () => Promise.reject(new Error('git ls-remote timed out after 30000ms')) });
    expect(result.failure?.kind).toBe('timeout');
  });
});
