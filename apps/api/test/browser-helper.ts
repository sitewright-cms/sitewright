import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright-core';

/**
 * A headless Chromium for the tests that must measure REAL layout, or null when the machine has none
 * (CI installs no browsers — those suites skip, exactly like the php/openssl-gated ones).
 *
 * Playwright's own pinned build is tried first. Failing that, any headless-shell / chromium build in
 * PLAYWRIGHT_BROWSERS_PATH or the default cache is used — the same discovery the Lighthouse runner does —
 * because a dev box often carries a NEWER revision than this playwright-core pins, and refusing it would
 * silently skip the very tests that prove a capture keeps the page's layout.
 */
export async function launchTestBrowser(): Promise<Browser | null> {
  const args = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];
  try {
    return await chromium.launch({ channel: 'chromium-headless-shell', args });
  } catch {
    /* not the pinned revision — look for any installed one */
  }
  for (const executablePath of installedChromes()) {
    try {
      return await chromium.launch({ executablePath, args });
    } catch {
      /* try the next */
    }
  }
  return null;
}

function installedChromes(): string[] {
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, join(homedir(), '.cache', 'ms-playwright')].filter((r): r is string => !!r && existsSync(r));
  const layouts: Array<[string, string]> = [
    ['chromium_headless_shell-', 'chrome-headless-shell-linux64/chrome-headless-shell'],
    ['chromium-', 'chrome-linux64/chrome'],
  ];
  const out: string[] = [];
  for (const root of roots) {
    const dirs = readdirSync(root).sort().reverse();
    for (const [prefix, binary] of layouts) {
      for (const dir of dirs.filter((d) => d.startsWith(prefix))) {
        const candidate = join(root, dir, binary);
        if (existsSync(candidate)) out.push(candidate);
      }
    }
  }
  return out;
}
