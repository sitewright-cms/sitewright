import { describe, it, expect } from 'vitest';
import { AGENT_GUIDES } from '@sitewright/schema';
import { THUMB_SIZES, DEFAULT_SIZE, SIZE_TOKENS } from '@sitewright/image-pipeline';

/**
 * The agent-facing images guide quotes the delivery rungs and the implicit default as NUMBERS, because
 * an agent cannot size an image without knowing them. Those numbers live in @sitewright/image-pipeline,
 * and the guide lives in @sitewright/schema — which cannot import the pipeline (it is the base package,
 * and the dependency would point the wrong way). This file is the join: `blocks` is the package that
 * already depends on BOTH, so it is where the two can be pinned together.
 *
 * Without this, changing a rung width or the default size would leave the guide confidently telling
 * every agent a stale number — the exact failure mode that shipped a page whose backgrounds were all
 * 2400px because nothing told the agent that is what a bare media url serves.
 */
describe('the agent images guide stays in step with the real delivery rungs', () => {
  const body = AGENT_GUIDES.images.body;

  it('quotes every size token with its ACTUAL width', () => {
    for (const token of SIZE_TOKENS) {
      // e.g. `md=1000` — the guide's rung table.
      expect(body, `rung ${token} missing or wrong in the images guide`).toContain(`${token}=${THUMB_SIZES[token]}`);
    }
  });

  it('names the DEFAULT rung a bare media url actually serves', () => {
    // The guide's whole argument is "a url with no ?size= serves <DEFAULT> — 2400px". Both halves
    // have to be true: the token, and the width it resolves to.
    expect(body).toContain(`\`${DEFAULT_SIZE}\` rung`);
    expect(body).toContain(`${THUMB_SIZES[DEFAULT_SIZE]}px`);
  });
});
