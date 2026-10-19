import { describe, expect, it } from 'vitest';
import { botCategory, deviceClass, trafficClass, trafficSource } from '../src/analytics/classify.js';

// Real user agents, as the servers send them.
const UA = {
  chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  androidPhone: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  googlebot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  bingbot: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  gptbot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
  claudebot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  perplexity: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
  facebook: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  uptimerobot: 'Mozilla/5.0+(compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)',
  ahrefs: 'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
  headless: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.0.0 Safari/537.36',
  curl: 'curl/8.5.0',
};

describe('trafficClass', () => {
  it('counts an ordinary browser as human', () => {
    expect(trafficClass({ ua: UA.chromeWin })).toBe('human');
    expect(trafficClass({ ua: UA.iphone })).toBe('human');
  });

  it('sorts bots by what they are for', () => {
    expect(trafficClass({ ua: UA.googlebot })).toBe('search');
    expect(trafficClass({ ua: UA.bingbot })).toBe('search');
    expect(trafficClass({ ua: UA.gptbot })).toBe('ai');
    expect(trafficClass({ ua: UA.claudebot })).toBe('ai');
    expect(trafficClass({ ua: UA.perplexity })).toBe('ai');
    expect(trafficClass({ ua: UA.facebook })).toBe('social');
    expect(trafficClass({ ua: UA.uptimerobot })).toBe('monitor');
    expect(trafficClass({ ua: UA.ahrefs })).toBe('seo');
  });

  it('calls a bot of no known kind just a bot', () => {
    expect(trafficClass({ ua: UA.headless })).toBe('bot');
    expect(trafficClass({ ua: UA.curl })).toBe('bot');
  });

  it('★ counts an automated browser as a bot even when its user agent looks human', () => {
    expect(trafficClass({ ua: UA.chromeWin, webdriver: true })).toBe('bot');
  });

  it('counts a request with no user agent as a bot', () => {
    expect(trafficClass({ ua: '' })).toBe('bot');
    expect(trafficClass({ ua: '   ' })).toBe('bot');
  });

  it('★ budgets uncached category lookups, so a flood of made-up bot names cannot burn the CPU', () => {
    const t = Date.UTC(2030, 0, 1);
    const seen = Array.from({ length: 201 }, (_, i) => botCategory(`Googlebot/2.1 (+http://www.google.com/bot.html) flood-${i}`, t));
    expect(seen.slice(0, 200).every((c) => c === 'search')).toBe(true);
    // Past the budget: just "a bot", and not cached…
    expect(seen[200]).toBe('bot');
    // …so the same crawler is categorized properly in the next second.
    expect(botCategory('Googlebot/2.1 (+http://www.google.com/bot.html) flood-200', t + 1000)).toBe('search');
  });

  it('answers the same for a cached user agent', () => {
    expect(botCategory(UA.googlebot)).toBe('search');
    expect(botCategory(UA.googlebot)).toBe('search');
  });
});

describe('deviceClass', () => {
  it('tells desktops, phones and tablets apart from the user agent', () => {
    expect(deviceClass({ ua: UA.chromeWin })).toBe('desktop');
    expect(deviceClass({ ua: UA.safariMac })).toBe('desktop');
    expect(deviceClass({ ua: UA.iphone })).toBe('mobile');
    expect(deviceClass({ ua: UA.androidPhone })).toBe('mobile');
    expect(deviceClass({ ua: UA.androidTablet })).toBe('tablet');
    expect(deviceClass({ ua: UA.ipad })).toBe('tablet');
  });

  it('★ recognises an iPad that asks for the desktop site by its touch screen', () => {
    // iPadOS sends the Mac user agent by default; no Mac has a touch screen.
    expect(deviceClass({ ua: UA.safariMac, touch: true })).toBe('tablet');
  });

  it("trusts the browser's own mobile hint", () => {
    expect(deviceClass({ ua: UA.chromeWin, chMobile: true })).toBe('mobile');
    expect(deviceClass({ ua: UA.chromeWin, mobileHint: true })).toBe('mobile');
  });
});

describe('trafficSource', () => {
  const own = (h: string): boolean => h === 'example.com';

  it('classifies search engines, social networks and AI assistants by the referring host', () => {
    expect(trafficSource({ referrerHost: 'www.google.de', isOwnHost: own })).toEqual({ source: 'search', host: 'google.de' });
    expect(trafficSource({ referrerHost: 'duckduckgo.com', isOwnHost: own })).toEqual({ source: 'search', host: 'duckduckgo.com' });
    expect(trafficSource({ referrerHost: 't.co', isOwnHost: own })).toEqual({ source: 'social', host: 't.co' });
    expect(trafficSource({ referrerHost: 'l.facebook.com', isOwnHost: own })).toEqual({ source: 'social', host: 'l.facebook.com' });
    expect(trafficSource({ referrerHost: 'chatgpt.com', isOwnHost: own })).toEqual({ source: 'ai', host: 'chatgpt.com' });
    expect(trafficSource({ referrerHost: 'www.perplexity.ai', isOwnHost: own })).toEqual({ source: 'ai', host: 'perplexity.ai' });
  });

  it('calls any other site a referral', () => {
    expect(trafficSource({ referrerHost: 'blog.partner.org', isOwnHost: own })).toEqual({ source: 'referral', host: 'blog.partner.org' });
  });

  it('★ does not count the site itself as a source', () => {
    expect(trafficSource({ referrerHost: 'example.com', isOwnHost: own })).toEqual({ source: 'direct', host: '' });
  });

  it('is direct with no referrer, or with one that is not a host name', () => {
    expect(trafficSource({ isOwnHost: own })).toEqual({ source: 'direct', host: '' });
    expect(trafficSource({ referrerHost: 'not a host', isOwnHost: own })).toEqual({ source: 'direct', host: '' });
    expect(trafficSource({ referrerHost: 'localhost', isOwnHost: own })).toEqual({ source: 'direct', host: '' });
  });

  it('prefers a campaign name over the referrer', () => {
    expect(trafficSource({ referrerHost: 'google.com', campaign: 'Newsletter', isOwnHost: own })).toEqual({ source: 'campaign', host: 'newsletter' });
  });

  it('ignores a campaign name with characters a campaign never has', () => {
    expect(trafficSource({ campaign: '<script>', isOwnHost: own })).toEqual({ source: 'direct', host: '' });
  });
});
