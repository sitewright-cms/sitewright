import { SCREENSHOT_VIEWPORTS, type ScreenshotViewportName } from '@sitewright/schema';
import type { PreviewCapture, PreviewCaptureNote } from './client.js';

/**
 * How `preview_page` presents SEGMENTED captures: a line per viewport saying what the images cover and
 * exactly how to ask for the rest, then each image under a label naming its place on the page.
 *
 * The words carry as much as the pixels. A long page arrives in parts — two desktop segments, or a
 * phone page tiled into columns — and a model that is not told so reads two segments as two pages, or
 * a four-column image as one very wide one, and has no way to know the footer is a `segment` away.
 */

export type CaptureBlock = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

const num = (v: number): string => Math.round(v).toLocaleString('en-US');

function span(segments: PreviewCapture['segments']): string {
  const first = segments[0]!;
  const last = segments[segments.length - 1]!;
  return first.index === last.index ? `segment ${first.index}` : `segments ${first.index}–${last.index}`;
}

/** Captures grouped by viewport, in the order they arrived. */
function byViewport(captures: readonly PreviewCapture[]): Array<[ScreenshotViewportName, PreviewCapture[]]> {
  const groups = new Map<ScreenshotViewportName, PreviewCapture[]>();
  for (const c of captures) groups.set(c.viewport, [...(groups.get(c.viewport) ?? []), c]);
  return [...groups.entries()];
}

/** One line per viewport: what is shown, at what scale, and the call that shows what is not. */
export function captureSummary(captures: readonly PreviewCapture[], notes: readonly PreviewCaptureNote[] = []): string[] {
  const groups = byViewport(captures);
  const several = new Set([...captures.map((c) => c.viewport), ...notes.map((n) => n.viewport)]).size > 1;
  const lines = groups.map(([vp, group]) => {
    const head = group[0]!;
    const segments = group.flatMap((c) => c.segments);
    const first = segments[0]!;
    const last = segments[segments.length - 1]!;
    const what =
      head.kind === 'element'
        ? `${vp} — element "${head.selector}"${(head.matches ?? 1) > 1 ? ` (the first of ${head.matches} matches)` : ''}, ${num(head.totalHeight)}px tall`
        : `${vp} (${SCREENSHOT_VIEWPORTS[vp].width}px wide) — page ${num(head.totalHeight)}px tall`;
    const parts = [
      `${what}, at ${Math.round(head.scale * 100)}% scale: ${span(segments)} of ${head.segmentCount}, y ${num(first.top)}–${num(last.bottom)}`,
    ];
    if (group.some((c) => c.segments.length > 1)) parts.push('shown SIDE BY SIDE as columns — read left to right, the left column is the top');
    let line = parts.join('; ') + '.';
    if (last.index < head.segmentCount) {
      line += ` More below: call again with segment:${last.index + 1}${several ? ` and viewports:["${vp}"]` : ''}.`;
    } else if (first.index === 1) {
      line += head.kind === 'element' ? ' The whole element.' : ' The whole page.';
    }
    if (head.truncated) line += ` The page runs on past the ${num(head.totalHeight)}px capture limit; nothing below that is captured.`;
    return line;
  });
  for (const n of notes) lines.push(`${n.viewport}: ${n.message}`);
  return lines;
}

/** The label above one image. */
export function captureLabel(c: PreviewCapture): string {
  const first = c.segments[0]!;
  const last = c.segments[c.segments.length - 1]!;
  const columns = c.segments.length > 1 ? ', as columns left to right' : '';
  return `— ${c.viewport} · ${span(c.segments)} of ${c.segmentCount} (y ${num(first.top)}–${num(last.bottom)}${columns}) —`;
}

/** The images, each preceded by its label. */
export function captureImageBlocks(captures: readonly PreviewCapture[]): CaptureBlock[] {
  return captures.flatMap((c): CaptureBlock[] => [
    { type: 'text', text: captureLabel(c) },
    { type: 'image', data: c.base64, mimeType: c.mimeType },
  ]);
}
