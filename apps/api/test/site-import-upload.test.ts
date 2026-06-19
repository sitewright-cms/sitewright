import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildCapturedSiteFromUpload, DEFAULT_UPLOAD_LIMITS, normalizeZipPath, UploadError } from '../src/import/upload.js';

async function zip(files: Record<string, string>): Promise<Buffer> {
  const z = new JSZip();
  for (const [name, content] of Object.entries(files)) z.file(name, content);
  return z.generateAsync({ type: 'nodebuffer' });
}

describe('buildCapturedSiteFromUpload — single HTML', () => {
  it('treats a lone .html file as the home page', async () => {
    const { site } = await buildCapturedSiteFromUpload(Buffer.from('<html><body><h1>Hi</h1></body></html>'), 'page.html');
    expect(site.origin.kind).toBe('upload');
    expect(site.pages).toHaveLength(1);
    expect(site.pages[0]!.sourceUrl).toBe('https://import.local/');
  });

  it('detects HTML by content when the extension is missing', async () => {
    const { site } = await buildCapturedSiteFromUpload(Buffer.from('<!doctype html><title>x</title>'), 'noext');
    expect(site.pages).toHaveLength(1);
  });

  it('rejects an unsupported file', async () => {
    await expect(buildCapturedSiteFromUpload(Buffer.from('just text'), 'notes.txt')).rejects.toBeInstanceOf(UploadError);
  });
});

describe('buildCapturedSiteFromUpload — ZIP', () => {
  it('maps html files to pages and collects image/css assets', async () => {
    const buf = await zip({
      'index.html': '<html><body><img src="img/logo.png"></body></html>',
      'about/index.html': '<html><body><h1>About</h1></body></html>',
      'img/logo.png': 'PNGDATA',
      'style.css': '.a{color:red}',
      'script.js': 'evil()',
    });
    const { site } = await buildCapturedSiteFromUpload(buf, 'site.zip');
    const urls = site.pages.map((p) => p.sourceUrl).sort();
    expect(urls).toEqual(['https://import.local/', 'https://import.local/about/']);
    expect([...site.assets.keys()].sort()).toEqual(['https://import.local/img/logo.png', 'https://import.local/style.css']);
    expect(site.assets.get('https://import.local/style.css')?.kind).toBe('css');
    expect(site.assets.get('https://import.local/img/logo.png')?.kind).toBe('image');
    // JS is ignored.
    expect([...site.assets.keys()].some((k) => k.endsWith('.js'))).toBe(false);
  });

  it('normalizeZipPath rejects traversal / absolute / backslash paths', () => {
    // JSZip's own file() sanitizes "..", so the guard is unit-tested directly (it defends against
    // externally-crafted archives whose central directory carries a malicious name).
    expect(normalizeZipPath('../evil.html')).toBeNull();
    expect(normalizeZipPath('a/../../b')).toBeNull();
    expect(normalizeZipPath('/etc/passwd')).toBeNull();
    expect(normalizeZipPath('a\\b.html')).toBeNull();
    expect(normalizeZipPath('about/index.html')).toBe('about/index.html');
    expect(normalizeZipPath('./img/a.png')).toBe('img/a.png');
  });

  it('keys assets so relative refs from a subdir page resolve to a root asset', async () => {
    // about/index.html references the root logo via "../img/logo.png"; both must map to the SAME asset key
    // the engine computes (page sourceUrl is the page's directory).
    const buf = await zip({
      'index.html': '<html><body><img src="img/logo.png"></body></html>',
      'about/index.html': '<html><body><img src="../img/logo.png"></body></html>',
      'img/logo.png': 'PNGDATA',
    });
    const { site } = await buildCapturedSiteFromUpload(buf, 'site.zip');
    expect(site.pages.find((p) => p.sourceUrl === 'https://import.local/about/')).toBeTruthy();
    expect([...site.assets.keys()]).toEqual(['https://import.local/img/logo.png']);
  });

  it('rejects a zip bomb (uncompressed total over budget)', async () => {
    const buf = await zip({ 'index.html': '<html></html>', 'big.css': 'x'.repeat(2000) });
    await expect(buildCapturedSiteFromUpload(buf, 'bomb.zip', { ...DEFAULT_UPLOAD_LIMITS, maxTotalBytes: 100 })).rejects.toThrow(/uncompressed/);
  });

  it('skips an oversized entry but keeps the rest', async () => {
    const buf = await zip({ 'index.html': '<html><body>ok</body></html>', 'huge.css': 'y'.repeat(5000) });
    const { site, warnings } = await buildCapturedSiteFromUpload(buf, 's.zip', { ...DEFAULT_UPLOAD_LIMITS, maxEntryBytes: 1000 });
    expect(site.pages).toHaveLength(1);
    expect(site.assets.size).toBe(0); // the css was skipped
    expect(warnings.some((w) => w.includes('huge.css'))).toBe(true);
  });

  it('rejects an archive with no HTML pages', async () => {
    const buf = await zip({ 'img/a.png': 'DATA', 'style.css': '.a{}' });
    await expect(buildCapturedSiteFromUpload(buf, 'nohtml.zip')).rejects.toThrow(/no HTML/);
  });

  it('rejects a too-many-entries archive', async () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 20; i++) many[`p${i}.html`] = '<html></html>';
    await expect(buildCapturedSiteFromUpload(await zip(many), 'many.zip', { ...DEFAULT_UPLOAD_LIMITS, maxEntries: 5 })).rejects.toThrow(/too many/);
  });
});
