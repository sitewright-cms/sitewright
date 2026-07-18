import { describe, it, expect } from 'vitest';
import { buildRsyncArgs, parseRsyncProgress, parseRsyncStats } from '../src/publish/rsync-deploy.js';

describe('buildRsyncArgs', () => {
  const args = buildRsyncArgs({ user: 'deploy', host: 'files.example.net' }, '/tmp/site', '/var/www', 'ssh -i /tmp/k/id -o StrictHostKeyChecking=accept-new');

  it('is a flat argv (spawned without a shell) — the ssh command is a single -e argument', () => {
    const eIdx = args.indexOf('-e');
    expect(eIdx).toBeGreaterThanOrEqual(0);
    expect(args[eIdx + 1]).toBe('ssh -i /tmp/k/id -o StrictHostKeyChecking=accept-new');
  });

  it('prunes with --delete, compresses (-z), and skips owner/group', () => {
    expect(args).toContain('--delete');
    expect(args[0]).toContain('z'); // -rlptz
    expect(args).toContain('--no-owner');
    expect(args).toContain('--no-group');
  });

  it('shields operational files from --delete (certbot ACME dir + the SFTP state manifest)', () => {
    expect(args).toContain('--exclude=.well-known/');
    expect(args.some((a) => a.startsWith('--exclude=/') && a.includes('sw-deploy-manifest'))).toBe(true);
    // Excludes precede --delete so rsync protects them from pruning.
    expect(args.indexOf('--exclude=.well-known/')).toBeLessThan(args.indexOf('--delete'));
  });

  it('ends with `--` then src/ then user@host:remoteDir/ (option-injection guard + rsync trailing-slash semantics)', () => {
    const dashIdx = args.indexOf('--');
    expect(dashIdx).toBeGreaterThan(args.indexOf('-e')); // options (incl -e) come before paths
    expect(args[dashIdx + 1]).toBe('/tmp/site/');
    expect(args.at(-1)).toBe('deploy@files.example.net:/var/www/');
  });

  it('does not double a trailing slash already present', () => {
    const a = buildRsyncArgs({ user: 'u', host: 'h' }, '/s/', '/d/', 'ssh');
    expect(a.at(-1)).toBe('u@h:/d/');
    expect(a[a.indexOf('--') + 1]).toBe('/s/');
  });
});

describe('parseRsyncProgress', () => {
  it('parses an --info=progress2 line into bytes + files-resolved/total', () => {
    const p = parseRsyncProgress('     31,822,702  97%    1.05MB/s    0:00:28 (xfr#89, to-chk=1/145)');
    expect(p).toEqual({ bytes: 31822702, index: 144, total: 145 }); // 145 - to-chk(1) = 144 resolved
  });
  it('handles the incremental-recursion (ir-chk) variant', () => {
    const p = parseRsyncProgress('    1,024  10%  1.0MB/s  0:00:01 (xfr#3, ir-chk=1000/2005)');
    expect(p).toEqual({ bytes: 1024, index: 1005, total: 2005 });
  });
  it('returns null for non-progress output', () => {
    expect(parseRsyncProgress('building file list ... done')).toBeNull();
    expect(parseRsyncProgress('')).toBeNull();
    expect(parseRsyncProgress('Number of files: 145 (reg: 144, dir: 1)')).toBeNull();
  });
});

describe('parseRsyncStats', () => {
  const stats = `
Number of files: 145 (reg: 144, dir: 1)
Number of created files: 0
Number of deleted files: 2
Number of regular files transferred: 89
Total file size: 32,780,742 bytes
Total transferred file size: 31,822,702 bytes
Literal data: 31,822,702 bytes
`;
  it('extracts the regular-file total, transferred/deleted counts, and transferred bytes', () => {
    expect(parseRsyncStats(stats)).toEqual({ totalFiles: 144, uploaded: 89, removed: 2, bytes: 31822702 });
  });
  it('defaults missing fields to 0 (a truncated/odd summary never NaNs the result)', () => {
    expect(parseRsyncStats('nothing useful here')).toEqual({ totalFiles: 0, uploaded: 0, removed: 0, bytes: 0 });
  });
  it('falls back to pre-3.1 rsync wording (no reg:/regular/deleted breakdown)', () => {
    const old = `
Number of files: 144
Number of files transferred: 89
Total file size: 32,780,742 bytes
Total transferred file size: 31,822,702 bytes
`;
    // No "(reg: …)", no "regular", no deleted-files line → use the coarse counts instead of reporting 0.
    expect(parseRsyncStats(old)).toEqual({ totalFiles: 144, uploaded: 89, removed: 0, bytes: 31822702 });
  });
});
