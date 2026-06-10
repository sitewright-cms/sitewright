import { describe, it, expect } from 'vitest';
import { renderClientConfig, listClients, clientIds, hasClient } from '../src/connect.js';

const INSTANCE = 'https://acme.sitewright.app';

describe('renderClientConfig', () => {
  it('renders the universal mcpServers block for stdio agents (Cursor/Cline/Windsurf/Gemini)', () => {
    for (const id of ['cursor', 'cline', 'windsurf', 'gemini', 'json']) {
      const out = renderClientConfig(id, INSTANCE)!;
      expect(out).toContain('"mcpServers"');
      // The bridge is always launched as `sitewright mcp --url <instance>`.
      expect(out).toContain('"command": "sitewright"');
      expect(out).toMatch(/"mcp",\s+"--url",\s+/);
      expect(out).toContain(`"${INSTANCE}"`);
    }
  });

  it('points each stdio client at its own config file path', () => {
    expect(renderClientConfig('cursor', INSTANCE)).toContain('~/.cursor/mcp.json');
    expect(renderClientConfig('windsurf', INSTANCE)).toContain('~/.codeium/windsurf/mcp_config.json');
    expect(renderClientConfig('gemini', INSTANCE)).toContain('~/.gemini/settings.json');
    expect(renderClientConfig('cline', INSTANCE)).toContain('cline_mcp_settings.json');
  });

  it('uses the VS Code servers/type shape, not mcpServers', () => {
    const out = renderClientConfig('vscode', INSTANCE)!;
    expect(out).toContain('"servers"');
    expect(out).toContain('"type": "stdio"');
    expect(out).not.toContain('"mcpServers"');
    expect(out).toContain('.vscode/mcp.json');
  });

  it('renders Claude Code as a one-line `claude mcp add` command, not JSON', () => {
    const out = renderClientConfig('claude', INSTANCE)!;
    // The instance URL is single-quoted so a URL with shell metacharacters can't execute on paste.
    expect(out).toContain(`claude mcp add sitewright -- sitewright mcp --url '${INSTANCE}'`);
    expect(out).not.toContain('{');
  });

  it('shell-quotes a hostile instance URL in the claude one-liner (no command injection on paste)', () => {
    const out = renderClientConfig('claude', "https://x.test/$(touch pwned)")!;
    expect(out).toContain(`--url 'https://x.test/$(touch pwned)'`); // wrapped — the $() can't expand
  });

  it('resolves aliases to their canonical client', () => {
    expect(renderClientConfig('claude-code', INSTANCE)).toBe(renderClientConfig('claude', INSTANCE));
    expect(renderClientConfig('claudecode', INSTANCE)).toBe(renderClientConfig('claude', INSTANCE));
    expect(renderClientConfig('gemini-cli', INSTANCE)).toBe(renderClientConfig('gemini', INSTANCE));
    expect(renderClientConfig('code', INSTANCE)).toBe(renderClientConfig('vscode', INSTANCE));
    expect(renderClientConfig('generic', INSTANCE)).toBe(renderClientConfig('json', INSTANCE));
  });

  it('returns null for an unknown client', () => {
    expect(renderClientConfig('nope', INSTANCE)).toBeNull();
  });

  it('always names the client in the header', () => {
    for (const id of clientIds()) {
      expect(renderClientConfig(id, INSTANCE)).toMatch(/^Sitewright MCP — /);
    }
  });
});

describe('hasClient', () => {
  it('accepts canonical ids and aliases, rejects unknowns', () => {
    expect(hasClient('cursor')).toBe(true);
    expect(hasClient('claude-code')).toBe(true);
    expect(hasClient('code')).toBe(true);
    expect(hasClient('nope')).toBe(false);
  });
});

describe('listClients', () => {
  it('lists every supported client, its aliases, and the usage line', () => {
    const out = listClients();
    expect(out).toContain('sitewright config <client> --url <instance>');
    for (const id of clientIds()) expect(out).toContain(id);
    // Aliases are surfaced so users discover e.g. `code` → VS Code.
    expect(out).toContain('also: claude-code');
  });
});
