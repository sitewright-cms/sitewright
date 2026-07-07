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
  /** Max skewX difference in degrees before a tab's parallelogram angle is flagged (default 4). */
  maxSkewDeg?: number;
  /** Min font-weight difference (numeric) before flagged — 400-vs-700 breaches, 600-vs-700 does not (default 150). */
  minWeightDelta?: number;
  /** Max letter-spacing difference in px before flagged (default 0.6). */
  maxLsDx?: number;
  /** Max border-radius difference in px before flagged (default 3). */
  maxRadiusDx?: number;
}
/** Whole-bar / behavioural chrome facts the per-element diff can't see. */
export interface ChromeMeta {
  /** Computed `position` of the header/nav container (`fixed`/`sticky` = pinned). */
  position?: string;
  /** Count of ripple markers (`waves-effect` / ripple runtime) in the chrome. */
  ripple?: number;
  /** Count of nav elements that open a modal. */
  modalTriggers?: number;
}
export interface ChromeMetaScore {
  diffs: string[];
  metaOff: number;
  pass: boolean;
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
export function scoreChromeMeta(orig?: ChromeMeta, clone?: ChromeMeta): ChromeMetaScore;
