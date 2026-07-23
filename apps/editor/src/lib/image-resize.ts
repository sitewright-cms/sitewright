// Inline image resize for the dataset richtext `contentEditable` (RichTextField). Clicking an <img> shows an
// aspect-locked corner-drag overlay that writes the width/height attributes; on release it fires `onResize`
// so the field re-emits. Imperative (a body-level overlay + direct DOM writes during drag) so a drag never
// triggers a React re-render. Mirrors the on-page bridge's resize (preview-bridge.ts) — keep them in step.

/** Pure aspect-locked resize math for a bottom-right (SE) corner drag: new width = startW + cursor dx,
 *  clamped to [min,max]; height keeps the aspect. Exported for unit testing (jsdom has no layout). */
export function computeResize(startW: number, aspect: number, dx: number, min = 24, max = 4000): { width: number; height: number } {
  const width = Math.round(Math.max(min, Math.min(startW + dx, max)));
  return { width, height: Math.round(width / (aspect || 1)) };
}

/** Attach the resizer to `editable`; returns a cleanup that removes listeners + the overlay. */
export function attachImageResize(editable: HTMLElement, onResize: () => void): () => void {
  let img: HTMLImageElement | null = null;
  let drag: { x: number; w: number; aspect: number } | null = null;

  const box = document.createElement('div');
  // Very high z-index so it floats above the entry-editor modal the field lives in.
  box.style.cssText = 'position:fixed;z-index:2147483000;box-sizing:border-box;display:none;border:1.5px solid #6366f1;pointer-events:none';
  // Only the bottom-right handle: an <img> in normal flow keeps its top-left origin when its width/height
  // ATTRIBUTES change (the sanitizer strips margin/transform, so other corners can't anchor under the cursor).
  const handle = document.createElement('div');
  handle.style.cssText = 'position:absolute;width:11px;height:11px;background:#fff;border:1.5px solid #6366f1;border-radius:2px;pointer-events:auto;right:-6px;bottom:-6px;cursor:nwse-resize';
  handle.addEventListener('mousedown', start);
  box.appendChild(handle);
  const dim = document.createElement('div');
  dim.style.cssText =
    'position:absolute;right:0;bottom:-21px;background:#0f172a;color:#fff;font:600 10px system-ui,sans-serif;padding:1px 6px;border-radius:4px;white-space:nowrap;pointer-events:none';
  box.appendChild(dim);
  document.body.appendChild(box);

  function position(): void {
    if (!img || !img.getClientRects().length) {
      hide();
      return;
    }
    const r = img.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = `${r.left}px`;
    box.style.top = `${r.top}px`;
    box.style.width = `${r.width}px`;
    box.style.height = `${r.height}px`;
    dim.textContent = `${Math.round(r.width)} × ${Math.round(r.height)}`;
  }
  function hide(): void {
    img = null;
    box.style.display = 'none';
  }
  function start(e: MouseEvent): void {
    if (!img) return;
    e.preventDefault();
    e.stopPropagation();
    const r = img.getBoundingClientRect();
    drag = { x: e.clientX, w: r.width, aspect: r.width / (r.height || 1) };
    document.addEventListener('mousemove', move, true);
    document.addEventListener('mouseup', end, true);
  }
  function move(e: MouseEvent): void {
    if (!drag || !img) return;
    const { width, height } = computeResize(drag.w, drag.aspect, e.clientX - drag.x);
    img.setAttribute('width', String(width));
    img.setAttribute('height', String(height)); // aspect-locked
    position();
  }
  function end(): void {
    document.removeEventListener('mousemove', move, true);
    document.removeEventListener('mouseup', end, true);
    drag = null;
    onResize();
    position();
  }
  function onClick(e: MouseEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && t.tagName === 'IMG' && editable.contains(t)) {
      img = t as HTMLImageElement;
      position();
    } else if (t && !box.contains(t)) {
      hide();
    }
  }
  const reposition = (): void => {
    if (img) position();
  };
  document.addEventListener('click', onClick, true);
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);

  return () => {
    document.removeEventListener('click', onClick, true);
    window.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition);
    document.removeEventListener('mousemove', move, true);
    document.removeEventListener('mouseup', end, true);
    box.remove();
  };
}
