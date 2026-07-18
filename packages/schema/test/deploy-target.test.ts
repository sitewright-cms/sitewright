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

describe('DeployTargetSchema — SFTP host hardening + rsync guards', () => {
  const secret = { iv: 'a'.repeat(24), ct: 'b'.repeat(24), tag: 'c'.repeat(24) };
  const sftp = { id: 'tgt_bbbbbbbbbbbb', name: 'Web', protocol: 'sftp' as const, user: 'deploy', secret, remoteDir: '/var/www' };

  it('restricts host to a hostname/IP and forbids ssh-option injection', () => {
    for (const host of ['files.staging.phoenix-host.net', '10.0.0.5', '2001:db8::1', 'example.com.']) {
      expect(DeployTargetSchema.safeParse({ ...sftp, host }).success).toBe(true);
    }
    for (const host of ['-oProxyCommand=touch /tmp/x', 'a b', 'evil.com/../x', 'has=eq']) {
      expect(DeployTargetSchema.safeParse({ ...sftp, host }).success).toBe(false);
    }
  });

  it('forbids a leading "-" on user', () => {
    expect(DeployTargetSchema.safeParse({ ...sftp, host: 'h', user: '-oProxyCommand=x' }).success).toBe(false);
  });

  it('rsync requires a non-root remoteDir and a known_hosts pin (not a SHA-256 fingerprint)', () => {
    const base = { ...sftp, host: 'h', useRsync: true };
    expect(DeployTargetSchema.safeParse({ ...base, remoteDir: '/var/www' }).success).toBe(true);
    expect(DeployTargetSchema.safeParse({ ...base, remoteDir: '/' }).success).toBe(false);
    expect(DeployTargetSchema.safeParse({ ...base, remoteDir: undefined }).success).toBe(false);
    // rsync on a non-SFTP protocol is rejected.
    expect(DeployTargetSchema.safeParse({ ...base, protocol: 'ftp', remoteDir: '/var/www' }).success).toBe(false);
    // A SHA-256 fingerprint can't be enforced via ssh → rejected; a known_hosts line is accepted.
    expect(DeployTargetSchema.safeParse({ ...base, hostFingerprint: 'aa:bb:cc:dd' }).success).toBe(false);
    expect(DeployTargetSchema.safeParse({ ...base, hostFingerprint: 'h ssh-ed25519 AAAAC3Nza' }).success).toBe(true);
  });
});
