# @sitewright/mcp

A stdio [MCP](https://modelcontextprotocol.io) bridge that exposes a single Sitewright **project** to any
MCP-capable agent (Claude Code, claude.ai, ChatGPT/codex, opencode, …). The agent is the MCP client; no
model API key is involved. Every tool is gated by the connecting token's role ∩ capabilities — all
authorization is enforced server-side.

## Connect to your website

Two ways to get a project-scoped token.

### A. OAuth login (recommended — pick your project in the browser)

```bash
export SITEWRIGHT_URL=https://your-instance.example   # e.g. http://dind.local:2003
sitewright-mcp login
```

This runs the OAuth **device grant**: it prints a URL + short code. Open the URL, sign in, and **choose
the project** to grant — then approve. The tokens are saved to `~/.sitewright/credentials.json` (`0600`).
No browser is needed on the same machine (works over SSH).

Then point your agent's MCP client at the bridge with **no token** — it uses the stored login and
auto-refreshes:

```jsonc
// .mcp.json  (Claude Code, or any MCP client)
{
  "mcpServers": {
    "sitewright": {
      "command": "sitewright-mcp",
      "env": { "SITEWRIGHT_URL": "https://your-instance.example" }
    }
  }
}
```

`sitewright-mcp logout` forgets the stored tokens.

### B. Static project API key (CI / non-interactive)

Mint a project-scoped key in the editor's **API Keys** panel (or `POST /orgs/:org/projects/:proj/api-keys`),
then:

```jsonc
{
  "mcpServers": {
    "sitewright": {
      "command": "sitewright-mcp",
      "env": {
        "SITEWRIGHT_URL": "https://your-instance.example",
        "SITEWRIGHT_TOKEN": "swk_…"
      }
    }
  }
}
```

Prefer `SITEWRIGHT_TOKEN` (env) over `--token` (visible in the process list).

## Scopes

`login` requests `content:read content:write publish` by default (override with `--scope` /
`SITEWRIGHT_SCOPE`). The server intersects the request with your role, so an over-broad request is
trimmed; a read-only token gets no write/publish tools.
