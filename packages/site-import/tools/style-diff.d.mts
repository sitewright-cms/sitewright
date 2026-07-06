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
export function matchAndDiff(orig: StyleEl[], clone: StyleEl[]): MatchResult;
export function scorePage(r: MatchResult, opts?: GateThresholds): GateScore;
