#!/usr/bin/env node
// Thin CLI over the real Sitewright MCP server (stdio) pointed at :2003.
// Usage:  SW_TOKEN=<key> node mcp.mjs <tool> '<json-args>'      (or @file.json)
//         SW_TOKEN=<key> node mcp.mjs __list__
// Prints text content; SAVES any image blocks to ./mcpimg/<tool>-<i>.jpg and prints their paths
// (so a vision agent can Read them — e.g. compare_to_source / preview_page screenshots).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

const IMGDIR = process.env.SW_IMGDIR || '/tmp/claude-1000/-workspace-sitewright/0d7b4751-f6d5-4ce4-9a50-d85f3b151a6b/scratchpad/mcpimg';
const tool = process.argv[2];
if (!tool) { console.error('usage: node mcp.mjs <tool> <json|@file>'); process.exit(2); }
let args = {};
if (process.argv[3]) args = process.argv[3].startsWith('@') ? JSON.parse(readFileSync(process.argv[3].slice(1), 'utf8')) : JSON.parse(process.argv[3]);

const token = process.env.SW_TOKEN;
const url = process.env.SW_URL || 'http://dind.local:2003';
if (!token) { console.error('set SW_TOKEN'); process.exit(2); }

const t = new StdioClientTransport({
  command: 'node',
  args: ['/workspace/sitewright/packages/mcp/dist/bin.js'],
  env: { ...process.env, SITEWRIGHT_URL: url, SITEWRIGHT_TOKEN: token },
});
const c = new Client({ name: 'clonetest', version: '1' }, { capabilities: {} });
await c.connect(t);

if (tool === '__list__') {
  const r = await c.listTools();
  console.log(r.tools.map((x) => x.name).join('\n'));
} else if (tool === '__schemas__') {
  const r = await c.listTools();
  for (const x of r.tools) console.log(`\n## ${x.name}\n${x.description || ''}\nargs: ${JSON.stringify(x.inputSchema)}`);
} else {
  const r = await c.callTool({ name: tool, arguments: args });
  let imgN = 0;
  for (const block of r.content || []) {
    if (block.type === 'text') {
      process.stdout.write(block.text + '\n');
    } else if (block.type === 'image') {
      mkdirSync(IMGDIR, { recursive: true });
      const ext = (block.mimeType || 'image/jpeg').split('/')[1] || 'jpg';
      const f = join(IMGDIR, `${tool}-${Date.now()}-${imgN++}.${ext}`);
      writeFileSync(f, Buffer.from(block.data, 'base64'));
      process.stdout.write(`[image saved: ${f}]\n`);
    }
  }
  if (r.isError) { process.stderr.write('\n[isError]\n'); process.exitCode = 1; }
}
await c.close();
