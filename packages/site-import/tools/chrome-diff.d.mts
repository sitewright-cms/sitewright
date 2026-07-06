// Types for the chrome (nav/footer) structural diff (chrome-diff.mjs).
import type { StyleEl } from './style-diff.d.mts';

/** A chrome element also carries its region + layout box (the body diff ignores these). */
export interface HoverState {
  bg: string;
  bgImage: string;
  color: string;
}
export interface ChromeEl extends StyleEl {
  region: 'header' | 'footer' | 'body';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Computed bg/gradient/colour while the real mouse hovers this element (header interactive elements only). */
  hover?: HoverState;
}
export interface ChromePair {
  region: 'header' | 'footer';
  o: ChromeEl;
  c: ChromeEl;
}
export interface ChromeMatch {
  pairs: ChromePair[];
  unmatched: ChromeEl[];
}
export interface ChromeDiff {
  region: string;
  label: string;
  props: string[];
}
export interface ChromeThresholds {
  maxPosDx?: number;
  maxSizeRatio?: number;
  minCoverage?: number;
}
export interface ChromeScore {
  matched: number;
  origCount: number;
  coverage: number;
  posOff: number;
  sizeOff: number;
  styleOff: number;
  diffs: ChromeDiff[];
  unmatched: ChromeEl[];
  pass: boolean;
}
export function matchChrome(orig: ChromeEl[], clone: ChromeEl[], regions?: Array<'header' | 'footer'>): ChromeMatch;
export function scoreChrome(match: ChromeMatch, opts?: ChromeThresholds): ChromeScore;
