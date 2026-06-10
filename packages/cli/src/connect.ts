/**
 * Ready-to-paste MCP client configs for `sitewright config <client>`.
 *
 * The local bridge (`sitewright mcp --url <instance>`) is a stdio MCP server. Most coding agents
 * consume the SAME `mcpServers` JSON shape, so we render that once and stamp the per-client
 * variations (VS Code's `servers`/`type` shape, Claude Code's `mcp add` one-liner) on top — users
 * paste instead of hand-writing. Pure functions of (client id, instance url) → printable text, so
 * the renderers are unit-testable without a live instance.
 */

/** Args the bridge is always launched with — `sitewright mcp --url <instance>`. */
function bridgeArgs(url: string): string[] {
  return ['mcp', '--url', url];
}

/**
 * POSIX single-quote a value for the one client (Claude Code) whose config is a SHELL COMMAND the
 * user pastes. JSON clients are safe via JSON.stringify; the shell one-liner is not — an instance
 * URL with shell metacharacters (`$(…)`, backticks, `;`) would otherwise execute on paste.
 */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** The block Cursor / Cline / Windsurf / Gemini CLI accept verbatim under `mcpServers`. */
function mcpServersBlock(url: string): string {
  return JSON.stringify({ mcpServers: { sitewright: { command: 'sitewright', args: bridgeArgs(url) } } }, null, 2);
}

/** VS Code (GitHub Copilot) uses a `servers` key and an explicit `type`. */
function vscodeBlock(url: string): string {
  return JSON.stringify({ servers: { sitewright: { type: 'stdio', command: 'sitewright', args: bridgeArgs(url) } } }, null, 2);
}

interface McpClient {
  id: string;
  label: string;
  /** Where this config goes — a file path, or a one-line "how". */
  location: (url: string) => string;
  /** The ready-to-paste block: JSON, or a shell command for CLI-driven clients. */
  body: (url: string) => string;
}

const CLIENTS: readonly McpClient[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    location: () => 'Run in your project (add --scope user to enable it everywhere):',
    body: (url) => `  claude mcp add sitewright -- sitewright mcp --url ${shellQuote(url)}`,
  },
  {
    id: 'cursor',
    label: 'Cursor',
    location: () => 'Add to ~/.cursor/mcp.json (or .cursor/mcp.json in a project):',
    body: mcpServersBlock,
  },
  {
    id: 'cline',
    label: 'Cline',
    location: () => 'In Cline → MCP Servers → Configure, add to cline_mcp_settings.json:',
    body: mcpServersBlock,
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    location: () => 'Add to ~/.codeium/windsurf/mcp_config.json:',
    body: mcpServersBlock,
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    location: () => 'Add to ~/.gemini/settings.json:',
    body: mcpServersBlock,
  },
  {
    id: 'vscode',
    label: 'VS Code (Copilot)',
    location: () => 'Add to .vscode/mcp.json (workspace) or your user mcp.json:',
    body: vscodeBlock,
  },
  {
    id: 'json',
    label: 'Generic (mcpServers JSON)',
    location: () => 'Paste into any MCP-aware agent that reads an mcpServers block:',
    body: mcpServersBlock,
  },
];

/** Aliases so `claude-code`, `code`, etc. resolve to the canonical client. */
const ALIASES = new Map<string, string>([
  ['claude-code', 'claude'],
  ['claudecode', 'claude'],
  ['code', 'vscode'],
  ['gemini-cli', 'gemini'],
  ['generic', 'json'],
]);

function find(id: string): McpClient | undefined {
  const key = ALIASES.get(id) ?? id;
  return CLIENTS.find((c) => c.id === key);
}

/** Known client ids, for help text and error messages. */
export function clientIds(): string[] {
  return CLIENTS.map((c) => c.id);
}

/** Whether an id (canonical or alias) names a known client — lets the caller validate before requiring a URL. */
export function hasClient(id: string): boolean {
  return find(id) !== undefined;
}

/**
 * The printable config for one client, or null if the id is unknown. The body is the exact
 * snippet/command to paste; the header names the client and where it goes.
 */
export function renderClientConfig(clientId: string, url: string): string | null {
  const client = find(clientId);
  if (!client) return null;
  return `Sitewright MCP — ${client.label}\n${client.location(url)}\n\n${client.body(url)}\n`;
}

/** A one-screen listing of supported clients (and their aliases) for `sitewright config` with no client. */
export function listClients(): string {
  const aliasesFor = new Map<string, string[]>();
  for (const [alias, canonical] of ALIASES) {
    const list = aliasesFor.get(canonical) ?? [];
    list.push(alias);
    aliasesFor.set(canonical, list);
  }
  const rows = CLIENTS.map((c) => {
    const also = aliasesFor.get(c.id);
    return `  ${c.id.padEnd(10)} ${c.label}${also ? `  (also: ${also.join(', ')})` : ''}`;
  }).join('\n');
  return `Print a ready-to-paste MCP config for your agent:\n\n  sitewright config <client> --url <instance>\n\nClients:\n${rows}\n`;
}
