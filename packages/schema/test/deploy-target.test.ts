import { describe, it, expect } from 'vitest';
import { isSshRepoUrl, gitRepoHost, DeployTargetSchema } from '../src/deploy-target.js';

describe('git repo URL helpers', () => {
  it('isSshRepoUrl distinguishes ssh remotes from https', () => {
    expect(isSshRepoUrl('https://github.com/a/b.git')).toBe(false);
    expect(isSshRepoUrl('http://example.com/a/b.git')).toBe(false);
    expect(isSshRepoUrl('ssh://git@github.com/a/b.git')).toBe(true);
    expect(isSshRepoUrl('git@github.com:a/b.git')).toBe(true); // scp-like
    expect(isSshRepoUrl('github.com:a/b.git')).toBe(false); // scp-like requires a user@
  });

  it('gitRepoHost extracts the host for https, ssh:// and scp-like remotes', () => {
    expect(gitRepoHost('https://github.com/a/b.git')).toBe('github.com');
    expect(gitRepoHost('ssh://git@gitlab.com:22/a/b.git')).toBe('gitlab.com');
    expect(gitRepoHost('git@github.com:org/repo.git')).toBe('github.com');
  });
});

describe('DeployTargetSchema — git targets', () => {
  const base = { id: 'tgt_aaaaaaaaaaaa', name: 'GH', protocol: 'git' as const, branch: 'gh-pages' };
  const secret = { iv: 'a'.repeat(24), ct: 'b'.repeat(24), tag: 'c'.repeat(24) };

  it('accepts an https target and a scp-like ssh target', () => {
    expect(DeployTargetSchema.safeParse({ ...base, repoUrl: 'https://github.com/a/b.git', secret }).success).toBe(true);
    expect(DeployTargetSchema.safeParse({ ...base, repoUrl: 'git@github.com:a/b.git', secret }).success).toBe(true);
    expect(DeployTargetSchema.safeParse({ ...base, repoUrl: 'ssh://git@github.com/a/b.git', secret }).success).toBe(true);
  });

  it('rejects an https repoUrl with embedded credentials but allows an ssh user', () => {
    expect(DeployTargetSchema.safeParse({ ...base, repoUrl: 'https://tok@github.com/a/b.git', secret }).success).toBe(false);
    expect(DeployTargetSchema.safeParse({ ...base, repoUrl: 'ssh://git@github.com/a/b.git', secret }).success).toBe(true);
  });
});
