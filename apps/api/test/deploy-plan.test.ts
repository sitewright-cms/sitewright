import { describe, it, expect } from 'vitest';
import { planDirs, planLeafDirs, remoteJoin } from '../src/publish/deploy/plan.js';

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
