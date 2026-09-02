import { describe, it, expect } from 'vitest';
import {
  isForeignRichHtml,
  cleanPastedHtml,
  plainTextToHtml,
  snapTextColor,
  snapHighlight,
  RICH_PASTE_PROMPT,
} from '../src/rich-paste.js';

// A representative fragment of what Word actually puts on the clipboard.
const WORD = `
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<meta name=Generator content="Microsoft Word 15">
<body lang=EN-GB>
<div class=WordSection1>
<p class=MsoNormal style='margin:0cm;line-height:107%;font-size:11.0pt;font-family:"Calibri",sans-serif'>
<span style='font-size:14.0pt;font-family:"Times New Roman",serif;color:black'>Ordinary text</span></p>
<p class=MsoNormal><span style='font-weight:bold;font-family:"Calibri"'>Bold run</span><o:p></o:p></p>
<p class=MsoNormal>&nbsp;</p>
<p class=MsoNormal style='text-align:center'><span style='color:#DC2626'>Red centred</span></p>
</div>
</body></html>`;

describe('isForeignRichHtml', () => {
  it('detects Word markup', () => {
    expect(isForeignRichHtml(WORD)).toBe(true);
    expect(isForeignRichHtml('<p class="MsoNormal">x</p>')).toBe(true);
    expect(isForeignRichHtml('<p><o:p></o:p></p>')).toBe(true);
    expect(isForeignRichHtml("<span style='mso-spacerun:yes'>x</span>")).toBe(true);
  });
  it('detects Google Docs and legacy presentational markup', () => {
    expect(isForeignRichHtml('<b id="docs-internal-guid-1234">x</b>')).toBe(true);
    expect(isForeignRichHtml('<font face="Arial">x</font>')).toBe(true);
  });
  it('detects a per-run font stack, which no toolbar of ours emits', () => {
    expect(isForeignRichHtml('<span style="font-family: Georgia, serif">x</span>')).toBe(true);
    expect(isForeignRichHtml('<span style="font-size: 14pt">x</span>')).toBe(true);
  });
  it('does NOT fire on the platform’s own editor output', () => {
    expect(isForeignRichHtml('<p class="text-center"><strong>Hi</strong> <span class="text-red-600">there</span></p>')).toBe(false);
    expect(isForeignRichHtml('<table><tbody><tr><td style="width: 120px">a</td></tr></tbody></table>')).toBe(false);
    expect(isForeignRichHtml('<p>plain</p>')).toBe(false);
    expect(isForeignRichHtml('')).toBe(false);
  });
});

describe('snapTextColor', () => {
  it('snaps an exact palette colour to its class', () => {
    expect(snapTextColor('#dc2626')).toBe('text-red-600');
    expect(snapTextColor('rgb(37, 99, 235)')).toBe('text-blue-600');
  });
  it('snaps a near-miss to the nearest palette entry', () => {
    expect(snapTextColor('#dd2828')).toBe('text-red-600');
  });
  it('leaves near-black body text uncoloured', () => {
    expect(snapTextColor('black')).toBe('');
    expect(snapTextColor('#000000')).toBe('');
    expect(snapTextColor('#222')).toBe('');
  });
  it('prefers a brand colour when the project has one nearer', () => {
    expect(snapTextColor('#ff0090', [{ label: 'Primary', cls: 'text-primary', value: '#ff0090' }])).toBe('text-primary');
  });
  it('ignores a value it cannot measure', () => {
    expect(snapTextColor('inherit')).toBe('');
    expect(snapTextColor('var(--x)')).toBe('');
  });
});

describe('snapHighlight', () => {
  it('snaps to the nearest highlight class', () => {
    expect(snapHighlight('#fef08a')).toBe('bg-yellow-200');
  });
  it('treats white/transparent as no highlight', () => {
    expect(snapHighlight('transparent')).toBe('');
    expect(snapHighlight('#ffffff')).toBe('');
    expect(snapHighlight('white')).toBe('');
  });
});

describe('cleanPastedHtml', () => {
  const out = cleanPastedHtml(WORD);

  it('keeps the words', () => {
    expect(out).toContain('Ordinary text');
    expect(out).toContain('Bold run');
    expect(out).toContain('Red centred');
  });
  it('drops every foreign class and id', () => {
    expect(out).not.toMatch(/Mso/i);
    expect(out).not.toContain('WordSection1');
    expect(out).not.toContain('id=');
  });
  it('drops font-family, font-size and margin declarations', () => {
    expect(out).not.toContain('font-family');
    expect(out).not.toContain('font-size');
    expect(out).not.toContain('margin');
    expect(out).not.toContain('line-height');
  });
  it('turns an inline font-weight into the semantic <strong> the toolbar emits', () => {
    expect(out).toContain('<strong>Bold run</strong>');
    expect(out).not.toContain('font-weight');
  });
  it('snaps an inline colour onto the palette class', () => {
    expect(out).toContain('text-red-600');
    expect(out).not.toContain('#DC2626');
  });
  it('snaps text-align onto the alignment class', () => {
    expect(out).toContain('text-center');
    expect(out).not.toContain('text-align');
  });
  it('turns Word’s &nbsp;-only spacer paragraph into the platform’s own empty line', () => {
    expect(out).not.toContain('&nbsp;');
    expect(out).toContain('<p><br /></p>');
  });
  it('unwraps span/div left with no attributes', () => {
    // "Ordinary text" was a black 14pt Times span — nothing survives to justify the wrapper.
    expect(out).toMatch(/<p>\s*Ordinary text<\/p>/);
    expect(out).not.toContain('<span>');
    expect(out).not.toContain('<div>');
  });

  it('keeps links, lists, images and tables', () => {
    const rich = cleanPastedHtml(
      '<div class=WordSection1><ul><li class=MsoListParagraph>one</li></ul>' +
        '<p><a href="https://example.com" style="color:#0563C1">link</a></p>' +
        '<img src="/media/x.png" alt="x" width="40" height="20">' +
        '<table style="width:100%"><tbody><tr><td style="width:120px">cell</td></tr></tbody></table></div>',
    );
    expect(rich).toContain('<li>one</li>');
    expect(rich).toContain('href="https://example.com"');
    expect(rich).toContain('<img src="/media/x.png" alt="x" width="40" height="20" />');
    expect(rich).toContain('width:100%');
    expect(rich).toContain('width:120px');
  });

  it('keeps a heading as the platform look-alike paragraph, never an <h*>', () => {
    const h = cleanPastedHtml('<h2 class=MsoHeading>Title</h2>');
    expect(h).toBe('<p class="sw-h2">Title</p>');
  });

  it('is a near no-op on content this editor produced', () => {
    const own = '<p class="text-center"><strong>Hi</strong> <span class="text-red-600">there</span></p>';
    expect(cleanPastedHtml(own)).toBe(own);
  });

  it('is idempotent', () => {
    expect(cleanPastedHtml(out)).toBe(out);
  });

  it('still drops script and event handlers (the sanitizer runs first)', () => {
    const bad = cleanPastedHtml('<p onclick="alert(1)" class=MsoNormal>x<script>alert(2)</script></p>');
    expect(bad).not.toContain('onclick');
    expect(bad).not.toContain('script');
    expect(bad).toContain('x');
  });

  it('returns empty for empty input', () => {
    expect(cleanPastedHtml('')).toBe('');
  });
});

describe('plainTextToHtml', () => {
  it('splits blank-line-separated paragraphs and keeps single newlines as breaks', () => {
    expect(plainTextToHtml('a\nb\n\nc')).toBe('<p>a<br>b</p><p>c</p>');
  });
  it('escapes markup characters', () => {
    expect(plainTextToHtml('<b>&x')).toBe('<p>&lt;b&gt;&amp;x</p>');
  });
  it('returns empty for blank input', () => {
    expect(plainTextToHtml('   ')).toBe('');
  });
});

describe('RICH_PASTE_PROMPT', () => {
  it('carries the wording both surfaces show', () => {
    expect(RICH_PASTE_PROMPT.title.length).toBeGreaterThan(0);
    expect(RICH_PASTE_PROMPT.clean).toBe('Clean up');
    expect(RICH_PASTE_PROMPT.keep).toBe('Keep original formatting');
  });
});
