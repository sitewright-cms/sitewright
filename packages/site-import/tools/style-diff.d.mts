// Type declarations for the pure gate diff logic (style-diff.mjs) so the .ts test + tsc typecheck it.
export interface StyleEl {
  role: 'heading' | 'button' | 'text' | 'other';
  tag: string;
  text: string;
  font: string;
  size: string;
  weight: string;
  color: string;
  bg: string;
  bgImage: string;
  shadow: string;
  transform: string;
  radius: string;
  /** letter-spacing (computed; `normal` or a px/em value). Optional — the body diff doesn't compare it. */
  ls?: string;
}
export interface StyleDiff {
  role: string;
  text: string;
  props: string[];
}
export interface MatchResult {
  matched: number;
  origCount: number;
  diffs: StyleDiff[];
  unmatched: StyleEl[];
}
export interface GateThresholds {
  minCoverage?: number;
  maxFontMiss?: number;
  maxGradFail?: number;
  maxScore?: number;
}
export interface GateScore {
  coverage: number;
  matched: number;
  origCount: number;
  fontMiss: number;
  /** gradient:MISSING or gradient:DIFF on a heading/button. */
  gradFail: number;
  skewMiss: number;
  diffCount: number;
  score: number;
  pass: boolean;
}
export function firstFamily(f: string): string;
export function stripWs(s: string): string;
/** Numeric font-weight (`normal`→400, `bold`→700, else the number). */
export function weightNum(w: string | number | null | undefined): number;
/** skewX angle in degrees parsed from a computed `transform` matrix (`none`→0). */
export function skewDeg(t: string | null | undefined): number;
/** letter-spacing in px (`normal`→0; `em` resolved against `size`). */
export function lsPx(ls: string | null | undefined, size: string | null | undefined): number;
/** First border-radius value in px (`none`/empty→0). */
export function radiusPx(r: string | null | undefined): number;
/** Whether a computed `box-shadow` is present. */
export function hasShadow(s: string | null | undefined): boolean;
export function matchAndDiff(orig: StyleEl[], clone: StyleEl[]): MatchResult;
export function scorePage(r: MatchResult, opts?: GateThresholds): GateScore;
