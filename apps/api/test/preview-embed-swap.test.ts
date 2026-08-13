import { describe, it, expect } from 'vitest';
import { replacePreviewStorageEmbeds } from '../src/publish/build.js';

const iframe = (attrs: string): string => `<iframe ${attrs}></iframe>`;

describe('replacePreviewStorageEmbeds', () => {
  it('swaps a YouTube embed for a placeholder that links to the watch page', () => {
    const out = replacePreviewStorageEmbeds(
      iframe('class="aspect-video w-full" src="https://www.youtube.com/embed/ayFX9ocE_hE" title="Our film"'),
    );
    expect(out).not.toContain('<iframe');
    expect(out).toContain('https://www.youtube.com/watch?v=ayFX9ocE_hE');
    expect(out).toContain('Watch on YouTube');
    expect(out).toContain('target="_blank"');
    // The box must keep the author's layout classes, or the preview stops representing the page.
    expect(out).toContain('class="aspect-video w-full"');
    expect(out).toContain('Our film');
  });

  it('★ drops the LOADING-PLACEHOLDER classes — the stand-in never finishes loading', () => {
    // The platform puts loading="lazy" + a .skeleton shimmer on iframes, so a lazy embed arrives here
    // carrying them. Copied onto the placeholder they do not decorate it, they break it:
    //   · .skeleton is an animated shimmer with its own background — on a real embed the content paints
    //     over it, on the placeholder nothing ever does, so the card sits under a pulsing grey wash.
    //   · .loading is worse: base-css neutralises daisyUI's spinner only for MEDIA
    //     (:is(iframe,img,video,embed,object).loading) and the placeholder is a DIV, so it gets the raw
    //     component — 1.5rem, aspect-ratio:1, masked — and the card collapses to a small square.
    const out = replacePreviewStorageEmbeds(
      iframe('class="skeleton loading loading-spinner loading-lg aspect-video w-full rounded-xl" src="https://www.youtube.com/embed/ayFX9ocE_hE"'),
    );
    // The author's LAYOUT classes survive — dropping those would stop the preview representing the page.
    expect(out).toContain('class="aspect-video w-full rounded-xl"');
    for (const gone of ['skeleton', 'loading', 'loading-spinner', 'loading-lg']) {
      expect(out.match(new RegExp(`class="[^"]*\\b${gone}\\b`)), gone).toBeNull();
    }
    // …and the placeholder itself is still there.
    expect(out).toContain('Watch on YouTube');
  });

  it('emits no class attribute at all when nothing survives the strip', () => {
    const out = replacePreviewStorageEmbeds(iframe('class="skeleton loading" src="https://www.youtube.com/embed/ayFX9ocE_hE"'));
    expect(out).not.toContain('class=""'); // an empty attribute, not just an empty value
    expect(out).not.toContain('class=');
    expect(out).toContain('Watch on YouTube');
  });

  it('finds the URL in data-src — the platform lazy-loads third-party embeds', () => {
    // The real defect: every authored embed carries data-src (no src at all), so a src-only
    // matcher silently swapped nothing and the blank frame stayed blank.
    const out = replacePreviewStorageEmbeds(iframe('data-src="https://www.youtube.com/embed/abc12" title="Clip"'));
    expect(out).not.toContain('<iframe');
    expect(out).toContain('https://www.youtube.com/watch?v=abc12');
  });

  it('covers youtube-nocookie, youtu.be and Vimeo', () => {
    expect(replacePreviewStorageEmbeds(iframe('src="https://www.youtube-nocookie.com/embed/abc12"'))).not.toContain('<iframe');
    expect(replacePreviewStorageEmbeds(iframe('src="https://youtu.be/abc12"'))).not.toContain('<iframe');
    const vimeo = replacePreviewStorageEmbeds(iframe('src="https://player.vimeo.com/video/76979871"'));
    expect(vimeo).toContain('https://vimeo.com/76979871');
    expect(vimeo).toContain('Watch on Vimeo');
  });

  it('LEAVES maps alone — they render fine sandboxed (measured), so swapping them would be a regression', () => {
    for (const src of [
      'https://www.google.com/maps/embed?pb=!1m18!1m12',
      'https://www.openstreetmap.org/export/embed.html?bbox=17,-22,17.2,-22.5',
    ]) {
      expect(replacePreviewStorageEmbeds(iframe(`src="${src}"`))).toContain('<iframe');
    }
  });

  it('leaves same-origin, relative and malformed sources alone', () => {
    for (const attrs of ['src="/media/acme/abc-clip.mp4"', 'src="about:blank"', 'src=""', 'title="no src at all"']) {
      expect(replacePreviewStorageEmbeds(iframe(attrs)), attrs).toContain('<iframe');
    }
  });

  it('escapes a raw `<` a serializer may have left in an attribute value', () => {
    const out = replacePreviewStorageEmbeds(iframe('src="https://www.youtube.com/embed/abc12" title="a <b tag"'));
    expect(out).not.toContain('<iframe');
    expect(out).toContain('a &lt;b tag');
  });

  it('leaves a tag whose attribute contains a raw `>` untouched — it never re-emits it', () => {
    // The tag matcher is `[^>]*`, so a raw `>` inside an attribute ends the match and the tag is not
    // recognised as an embed. That FAILS SAFE and is the property worth pinning: no swap, and
    // therefore nothing from that attribute is ever re-emitted into the placeholder's markup.
    const hostile = iframe('src="https://www.youtube.com/embed/abc12" title="<script>alert(1)</script>"');
    const out = replacePreviewStorageEmbeds(hostile);
    expect(out).toBe(hostile);
  });

  it('does not double-encode an already-escaped ampersand in the title', () => {
    const out = replacePreviewStorageEmbeds(iframe('src="https://www.youtube.com/embed/abc12" title="Bell &amp; Co"'));
    expect(out).toContain('Bell &amp; Co');
    expect(out).not.toContain('&amp;amp;');
  });

  it('is a no-op on markup with no iframes at all', () => {
    const html = '<p>Just text</p>';
    expect(replacePreviewStorageEmbeds(html)).toBe(html);
  });
});

describe('the watch link is escaped on the fallback path too', () => {
  it('escapes angle brackets in a recognised-host URL whose PATH we do not rebuild', () => {
    // watchUrlFor rebuilds a clean URL from an id it matched — but FALLS BACK to the author's own src
    // for a host we recognise on a path we don't. That value lands in href="…", so it is escaped like
    // every other author-derived value rather than trusted because "the other branch is clean".
    const out = replacePreviewStorageEmbeds(
      iframe('src="https://www.youtube.com/playlist?list=a<b" title="List"'),
    );
    expect(out).not.toContain('<iframe');
    expect(out).toContain('href="https://www.youtube.com/playlist?list=a&lt;b"');
    expect(out).not.toMatch(/href="[^"]*<[^"]*"/);
  });
});
