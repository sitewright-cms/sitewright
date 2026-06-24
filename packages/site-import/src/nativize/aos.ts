// Re-express a source site's scroll-reveal motion (WOW.js / animate.css / AOS) as the platform's own
// data-aos runtime. The original animation is JS-driven and gets stripped on import; the capture records
// the COMPUTED animation (keyframe name + delay + duration), and this maps it to a platform effect +
// timing. Pure + unit-testable. Returns null for non-reveal keyframes (continuous spin/pulse/etc.).

export interface AosAttrs {
  effect: string;
  delay?: number;
  dur?: number;
}

/**
 * Map an animate.css/WOW keyframe (or class) name → a platform data-aos effect. Directions follow
 * animate.css semantics (fadeInLeft ENTERS from the left → AOS fade-right). Null = not a scroll reveal.
 */
export function mapAosEffect(c: string | null | undefined): string | null {
  if (!c) return null;
  if (/(fadeInLeft|slideInLeft|fade-?left)/i.test(c)) return 'fade-right';
  if (/(fadeInRight|slideInRight|fade-?right)/i.test(c)) return 'fade-left';
  if (/(fadeInDown|slideInDown|fade-?down)/i.test(c)) return 'fade-down';
  if (/(fadeInUp|slideInUp|fade-?up)/i.test(c)) return 'fade-up';
  if (/(zoomIn|zoom-?in)/i.test(c)) return 'zoom-in';
  if (/(zoomOut|zoom-?out)/i.test(c)) return 'zoom-out';
  if (/flip/i.test(c)) return 'flip-up';
  if (/(fadeIn|^fade$)/i.test(c)) return 'fade';
  if (/(wow|animated|animate__)/i.test(c)) return 'fade-up'; // generic reveal hint → tasteful default
  return null;
}

/** Parse a CSS time ("400ms" / "0.4s") → clamped integer milliseconds [0, 5000]. */
export function ms(v: string | undefined): number {
  if (!v) return 0;
  const m = String(v).match(/([\d.]+)\s*(ms|s)?/);
  if (!m) return 0;
  let n = parseFloat(m[1]!);
  if (m[2] !== 'ms') n *= 1000;
  return Math.max(0, Math.min(5000, Math.round(n)));
}

/** Build the data-aos attribute set from a captured {name,delay,dur}, or null if it isn't a scroll reveal. */
export function aosAttrs(a: { name: string; delay: string; dur: string } | null | undefined): AosAttrs | null {
  if (!a) return null;
  const effect = mapAosEffect(a.name);
  if (!effect) return null;
  const delay = ms(a.delay);
  const dur = ms(a.dur);
  const at: AosAttrs = { effect };
  if (delay >= 50) at.delay = Math.round(delay / 50) * 50;
  if (dur >= 100 && Math.abs(dur - 400) > 50) at.dur = dur;
  return at;
}
