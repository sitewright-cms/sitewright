import { createRequire } from 'node:module';
import { isbot } from 'isbot';
import type { StatsClass, StatsDevice, StatsSource } from '@sitewright/schema';

/**
 * Classification for the built-in statistics: bot or human, which kind of bot, which device, which source.
 *
 * All of it runs on every counted pageview, so it is built to be cheap. `isbot` is one precompiled pattern
 * (~1 µs). The bot CATEGORY list (crawler-user-agents, 1,500 patterns) is only consulted for traffic `isbot`
 * already flagged, so human pageviews never pay for it, and its answers are cached per user agent. The device
 * needs no parser library: the browser's own mobile hint and a short user-agent check are enough to tell a
 * desktop, a phone and a tablet apart.
 */

export interface TrafficSignals {
  /** The `User-Agent` header (may be empty). */
  ua: string;
  /** The page reported `navigator.webdriver` — an automated browser. */
  webdriver?: boolean;
}

/** Bot or human, and for a bot what kind. */
export function trafficClass(s: TrafficSignals): StatsClass {
  const ua = s.ua.trim();
  if (!ua) return 'bot';
  if (isbot(ua)) return botCategory(ua);
  return s.webdriver ? 'bot' : 'human';
}

// ---- bot categories ------------------------------------------------------------------------------------

type BotClass = Exclude<StatsClass, 'human'>;

/** crawler-user-agents tag → our class, in priority order (an AI search bot is tagged both ai and search). */
const TAG_CLASSES: ReadonlyArray<readonly [string, BotClass]> = [
  ['ai-crawler', 'ai'],
  ['search-engine', 'search'],
  ['social-preview', 'social'],
  ['monitoring', 'monitor'],
  ['seo', 'seo'],
];

let categoryPatterns: Array<readonly [RegExp, BotClass]> | null = null;

function loadCategoryPatterns(): Array<readonly [RegExp, BotClass]> {
  const list = createRequire(import.meta.url)('crawler-user-agents') as Array<{ pattern: string; tags?: string[] }>;
  return TAG_CLASSES.flatMap(([tag, cls]) => {
    const sources = list.filter((e) => e.tags?.includes(tag)).map((e) => `(?:${e.pattern})`);
    if (!sources.length) return [];
    // eslint-disable-next-line security/detect-non-literal-regexp -- patterns from a vetted, pinned dependency
    return [[new RegExp(sources.join('|')), cls] as const];
  });
}

/** Most bots send the same few user agents over and over: remember the last answers. */
const CATEGORY_CACHE_MAX = 512;
const categoryCache = new Map<string, BotClass>();
/**
 * Uncached category lookups allowed per second. One costs up to ~0.5 ms (five large alternations), and the user
 * agent is the visitor's to choose — a flood of made-up bot names would miss the cache every time. Past the
 * budget a bot is simply `bot` (and not cached, so a real crawler is categorized on its next visit).
 */
const CATEGORY_LOOKUPS_PER_SECOND = 200;
let budgetSecond = 0;
let budgetUsed = 0;

/** The kind of bot a (known-bot) user agent is. */
export function botCategory(ua: string, nowMs: number = Date.now()): BotClass {
  const key = ua.slice(0, 512);
  const hit = categoryCache.get(key);
  if (hit) return hit;
  const second = Math.floor(nowMs / 1000);
  if (second !== budgetSecond) {
    budgetSecond = second;
    budgetUsed = 0;
  }
  if (budgetUsed >= CATEGORY_LOOKUPS_PER_SECOND) return 'bot';
  budgetUsed++;
  categoryPatterns ??= loadCategoryPatterns();
  const found = categoryPatterns.find(([re]) => re.test(key))?.[1] ?? 'bot';
  if (categoryCache.size >= CATEGORY_CACHE_MAX) categoryCache.delete(categoryCache.keys().next().value!);
  categoryCache.set(key, found);
  return found;
}

// ---- device ----------------------------------------------------------------------------------------------

export interface DeviceSignals {
  ua: string;
  /** `Sec-CH-UA-Mobile: ?1` (Chromium sends it without being asked). */
  chMobile?: boolean;
  /** The page's `navigator.userAgentData.mobile`. */
  mobileHint?: boolean;
  /** The page reported a touch screen (`maxTouchPoints > 1`). */
  touch?: boolean;
}

const TABLET_RE = /iPad|Tablet|Kindle|Silk\/|PlayBook|Nexus (?:7|9|10)\b|SM-T\d|Android(?!.*Mobile)/i;
const MOBILE_RE = /Mobi|iPhone|iPod|Android|Windows Phone|BlackBerry|BB10|Opera Mini|IEMobile|webOS/i;

/** Desktop, mobile or tablet. */
export function deviceClass(s: DeviceSignals): StatsDevice {
  if (s.chMobile || s.mobileHint) return 'mobile';
  const ua = s.ua;
  if (TABLET_RE.test(ua)) return 'tablet';
  if (MOBILE_RE.test(ua)) return 'mobile';
  // iPadOS asks for desktop sites by default and says "Macintosh" — but no Mac has a touch screen.
  if (s.touch && /Macintosh/.test(ua)) return 'tablet';
  return 'desktop';
}

// ---- source ----------------------------------------------------------------------------------------------

/** Registrable-domain patterns per source kind, matched against the referring host. */
const SOURCE_HOSTS: ReadonlyArray<readonly [Exclude<StatsSource, 'direct' | 'referral' | 'campaign'>, RegExp]> = [
  ['ai', /(?:^|\.)(?:chatgpt\.com|openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com|you\.com|phind\.com|poe\.com|meta\.ai|deepseek\.com|grok\.com|mistral\.ai)$/],
  ['search', /(?:^|\.)(?:google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.yahoo\.com|yahoo\.[a-z.]+|yandex\.[a-z.]+|baidu\.com|ecosia\.org|startpage\.com|qwant\.com|search\.brave\.com|naver\.com|seznam\.cz|sogou\.com|so\.com|ask\.com|aol\.com|kagi\.com|mojeek\.com)$/],
  ['social', /(?:^|\.)(?:facebook\.com|fb\.com|fb\.me|instagram\.com|t\.co|twitter\.com|x\.com|linkedin\.com|lnkd\.in|reddit\.com|pinterest\.[a-z.]+|youtube\.com|youtu\.be|tiktok\.com|threads\.net|bsky\.app|mastodon\.social|whatsapp\.com|telegram\.org|t\.me|vk\.com|xing\.com|snapchat\.com|tumblr\.com|news\.ycombinator\.com)$/],
];

// Each label is bounded and every repetition starts with a literal '.', so backtracking stays linear; the input
// is length-checked before it gets here.
// eslint-disable-next-line security/detect-unsafe-regex -- bounded labels, '.'-delimited repetition, length-capped input
const HOST_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const CAMPAIGN_RE = /^[a-z0-9][a-z0-9._ -]{0,63}$/;

export interface SourceSignals {
  /** The referring site's host, as the page reported it. */
  referrerHost?: string;
  /** The campaign name from `utm_source` / `ref`. */
  campaign?: string;
  /** Whether a host is this site's own (an internal navigation is not a source). */
  isOwnHost: (host: string) => boolean;
}

/** Where a visit came from: a kind and the host (or campaign name) to show. */
export function trafficSource(s: SourceSignals): { source: StatsSource; host: string } {
  const campaign = s.campaign?.trim().toLowerCase();
  if (campaign && CAMPAIGN_RE.test(campaign)) return { source: 'campaign', host: campaign };
  const host = s.referrerHost?.trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  if (!host || host.length > 253 || !HOST_RE.test(host) || s.isOwnHost(host)) return { source: 'direct', host: '' };
  for (const [source, re] of SOURCE_HOSTS) if (re.test(host)) return { source, host };
  return { source: 'referral', host };
}
