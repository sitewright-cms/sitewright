import { describe, it, expect } from 'vitest';
import { renderClientConfig, listClients, clientIds } from '../src/connect.js';

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
    expect(out).toContain(`claude mcp add sitewright -- sitewright mcp --url ${INSTANCE}`);
    expect(out).not.toContain('{');
  });

  it('resolves aliases to their canonical client', () => {
    expect(renderClientConfig('claude-code', INSTANCE)).toBe(renderClientConfig('claude', INSTANCE));
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

describe('listClients', () => {
  it('lists every supported client and the usage line', () => {
    const out = listClients();
    expect(out).toContain('sitewright config <client> --url <instance>');
    for (const id of clientIds()) expect(out).toContain(id);
  });
});
