import { describe, it, expect } from 'vitest';
import { DEFAULT_AGENT_INSTRUCTIONS } from '../src/agent.js';

describe('DEFAULT_AGENT_INSTRUCTIONS', () => {
  it('stays brand-neutral — no hardcoded platform name (white-label safe)', () => {
    // The agent/MCP instructions must read generically ("this server"/"this project") so a
    // white-labeled instance never leaks the "SiteWright" brand to a connected agent.
    expect(DEFAULT_AGENT_INSTRUCTIONS.toLowerCase()).not.toContain('sitewright');
  });

  it('still describes the core authoring workflow', () => {
    expect(DEFAULT_AGENT_INSTRUCTIONS).toContain('get_scope');
    expect(DEFAULT_AGENT_INSTRUCTIONS).toContain('CODE-FIRST static website');
  });
});
