import { describe, it, expect } from 'vitest';
import { planDirs, planLeafDirs, planDirLevels, remoteJoin } from '../src/publish/deploy/plan.js';

describe('remoteJoin', () => {
  it('joins base + rel with a single slash', () => {
    expect(remoteJoin('/var/www', 'index.html')).toBe('/var/www/index.html');
    expect(remoteJoin('/var/www', 'about/index.html')).toBe('/var/www/about/index.html');
  });
  it('normalises trailing/leading/duplicate slashes', () => {
    expect(remoteJoin('/var/www/', 'index.html')).toBe('/var/www/index.html');
    expect(remoteJoin('/', 'index.html')).toBe('/index.html');
    expect(remoteJoin('/var//www', '/a//b')).toBe('/var/www/a/b');
  });
});

describe('planDirs', () => {
  it('returns every ancestor dir, shallowest-first', () => {
    const dirs = planDirs('/var/www', ['index.html', 'about/index.html', 'a/b/c.html']);
    // Shallowest-first; ties broken by locale ('a' < 'about'), then the depth-2 child.
    expect(dirs).toEqual(['/var/www/a', '/var/www/about', '/var/www/a/b']);
  });
  it('root-only files need no directories', () => {
    expect(planDirs('/w', ['index.html', 'style.css'])).toEqual([]);
  });
});

describe('planLeafDirs', () => {
  it('keeps only leaf dirs (a recursive mkdir of each creates its ancestors)', () => {
    // /var/www/a is a strict prefix of /var/www/a/b, so only the leaves remain.
    expect(planLeafDirs('/var/www', ['a/b/c.html', 'about/x.html'])).toEqual(['/var/www/about', '/var/www/a/b']);
  });
  it('is empty when there are no subdirectories', () => {
    expect(planLeafDirs('/w', ['index.html'])).toEqual([]);
  });
});

describe('planDirLevels — the shape that makes concurrent creation safe', () => {
  const rels = ['index.html', 'about/index.html', '_assets/_textures/paper.png', '_assets/photo.webp', 'shop/a/index.html'];

  it('groups shallowest first, so every parent exists before its children are attempted', () => {
    const levels = planDirLevels('/', rels);
    expect(levels.length).toBeGreaterThan(1);
    const depthOf = (d: string) => d.split('/').filter(Boolean).length;
    // Each level is one depth, and the levels ascend.
    const depths = levels.map((l) => depthOf(l[0]!));
    expect(depths).toEqual([...depths].sort((a, b) => a - b));
    levels.forEach((level) => level.forEach((d) => expect(depthOf(d)).toBe(depthOf(level[0]!))));
  });

  it('never puts an ancestor and a descendant in the SAME level', () => {
    // ★ This is the whole invariant. Two concurrent creations may not need the same missing parent —
    // measured against a real server, 8 recursive mkdirs racing on one missing parent left 1 of 8
    // directories in place, and the deploy died later on an unrelated-looking upload error.
    for (const level of planDirLevels('/var/www', rels)) {
      for (const a of level) {
        for (const b of level) {
          if (a !== b) expect(b.startsWith(`${a}/`)).toBe(false);
        }
      }
    }
  });

  it('covers every directory a leaf needs, not just the leaves', () => {
    const all = planDirLevels('/', rels).flat();
    // `/_assets` must be present in its own right — a non-recursive mkdir of `/_assets/_textures`
    // depends on it, and planLeafDirs deliberately drops it.
    expect(all).toContain('/_assets');
    expect(all).toContain('/_assets/_textures');
    expect(new Set(all).size).toBe(all.length); // no path attempted twice
  });
});

