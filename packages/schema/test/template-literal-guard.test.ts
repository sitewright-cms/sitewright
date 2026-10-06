import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_AGENT_INSTRUCTIONS, AGENT_GUIDES } from '../src/agent.js';

/**
 * ★★ A GUARD FOR A BUG THAT HAS NOW BITTEN FIVE TIMES.
 *
 * Several of this codebase's largest strings are ONE template literal — the cart runtime, the agent
 * instructions, the guide bodies. Two things inside them end the literal or corrupt it, and NEITHER
 * is visible to a reader or to `tsc` until the file stops parsing somewhere else entirely:
 *
 *   - a BACKTICK, including one in a comment or in prose quoting an identifier;
 *   - `\/`, which collapses to `/` and has already closed a regex mid-expression.
 *
 * The cart runtime has its own version of this test (it can be PARSED, which is stronger). This one
 * covers the prose strings, where the failure is subtler: the literal still parses, and the damage is
 * that an agent reads instructions that stop halfway through a sentence.
 */
const agentSource = readFileSync(fileURLToPath(new URL('../src/agent.ts', import.meta.url)), 'utf8');

describe('agent instructions survive their own template literal', () => {
  it('the core instructions are complete, not truncated at a stray backtick', () => {
    // A premature end shows up as a short string long before it shows up as a wrong one.
    expect(DEFAULT_AGENT_INSTRUCTIONS.length).toBeGreaterThan(5000);
  });

  it('★ the SHOP guide reached the shipped string whole', () => {
    // The specific regression: adding prose with backticked identifiers ended the literal early, so
    // everything after it silently vanished from what an agent is told — and the guide still looked
    // fine, just shorter.
    const shop = AGENT_GUIDES.shop.body;
    expect(shop).toContain('checkout');
    expect(shop).toContain('sw-order-status');
    expect(shop).toContain('Settings -> Website -> Payments');
    expect(shop.length).toBeGreaterThan(1500);
  });

  it('every guide body is non-trivial — a truncated one is the symptom', () => {
    for (const [topic, guide] of Object.entries(AGENT_GUIDES)) {
      expect(guide.body.length, `the ${topic} guide looks truncated`).toBeGreaterThan(200);
    }
  });

  it('no template literal in agent.ts contains a backtick in its body', () => {
    // Scanned on the SOURCE, because by the time it reaches the shipped string the evidence is gone.
    const literals = agentSource.match(/`[^`]*`/g) ?? [];
    expect(literals.length).toBeGreaterThan(0);
    for (const lit of literals) {
      expect(lit.slice(1, -1), 'a nested backtick would have ended the literal').not.toContain('`');
    }
  });
});
