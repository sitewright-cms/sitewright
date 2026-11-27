import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { copySiteInto } from '../src/publish/git-deploy.js';
import { deployGitSsh } from '../src/publish/git-ssh-deploy.js';

/**
 * A git deploy is how a site reaches GitHub Pages, and Pages runs a branch through Jekyll unless the branch has a
 * `.nojekyll` at its root. Jekyll leaves out every `_`-prefixed folder, so without the file the site's `_assets/`
 * (its CSS, scripts and files) would 404 on every page. Both git deployers (HTTPS token and SSH key) share
 * `copySiteInto`; the SSH one runs the real `git`, so it is pushed here to a local bare repo end to end.
 */

const dirs: string[] = [];
const mkTmp = async (prefix: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

/** A built site the way the publish writes one: pages, plus the `_assets/` folder Jekyll would drop. */
async function builtSite(): Promise<string> {
  const site = await mkTmp('sw-built-');
  await mkdir(join(site, '_assets'));
  await mkdir(join(site, 'docs'));
  await writeFile(join(site, 'index.html'), '<link rel="stylesheet" href="_assets/site.css">');
  await writeFile(join(site, 'docs', 'index.html'), '<link rel="stylesheet" href="../_assets/site.css">');
  await writeFile(join(site, '_assets', 'site.css'), 'body{margin:0}');
  return site;
}

describe('git deploy — GitHub Pages', () => {
  it('copies the site into the worktree with an empty .nojekyll at its root', async () => {
    const site = await builtSite();
    const worktree = await mkTmp('sw-git-');
    await copySiteInto(site, worktree);
    expect((await readdir(worktree)).sort()).toEqual(['.nojekyll', '_assets', 'docs', 'index.html']);
    expect(await readFile(join(worktree, '.nojekyll'), 'utf8')).toBe('');
    expect(await readFile(join(worktree, '_assets', 'site.css'), 'utf8')).toBe('body{margin:0}');
    // The built site itself is left as it was: the file belongs to the git deploy, not to every target.
    expect(await readdir(site)).not.toContain('.nojekyll');
  });

  it('pushes .nojekyll beside the site in the one deploy commit', async () => {
    const site = await builtSite();
    const remote = join(await mkTmp('sw-remote-'), 'site.git');
    execFileSync('git', ['init', '-q', '--bare', remote]);
    // A local path needs no ssh, so the key is never used; the deployer still writes it to its private temp dir.
    const result = await deployGitSsh(site, { repoUrl: remote, branch: 'gh-pages', privateKey: 'unused' });
    expect(result).toMatchObject({ protocol: 'git', branch: 'gh-pages' });
    const tree = execFileSync('git', ['--git-dir', remote, 'ls-tree', '-r', '--name-only', 'gh-pages'], { encoding: 'utf8' });
    expect(tree.trim().split('\n').sort()).toEqual(['.nojekyll', '_assets/site.css', 'docs/index.html', 'index.html']);
  });
});
