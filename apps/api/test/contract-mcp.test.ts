import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createSitewrightMcpServer, SitewrightClient, type BridgeAuth, type ScopeHolder } from '@sitewright/mcp';
import { expectContract } from './contract-helpers.js';

/**
 * The MCP tool surface, pinned.
 *
 * Agents are written against tool NAMES, and a rename breaks every stored prompt and workflow
 * silently — the agent simply stops being able to do the thing. Required inputs are pinned for the
 * same reason: making an optional argument required breaks callers that never passed it.
 *
 * Listed through a real client over an in-memory transport rather than by reading the source or
 * poking at SDK internals, so this asserts what an agent would actually be offered.
 */
async function listTools() {
  const holder: ScopeHolder = { scope: null };
  const auth: BridgeAuth = {
    interactive: false,
    token: async () => null,
    forceRefresh: async () => null,
    beginLogin: () => {
      throw new Error('not interactive');
    },
  };
  const server = createSitewrightMcpServer(new SitewrightClient('http://contract.invalid', async () => null), holder, auth);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'contract', version: '0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  const { tools } = await client.listTools();
  await client.close();
  return tools;
}

describe('contract: MCP tools', () => {
  it('matches the committed tool surface', async () => {
    const tools = await listTools();
    // Name + required inputs only. Descriptions are prose tuned for model behaviour and change
    // freely (contract/README.md calls them Internal) — pinning them would make every wording tweak
    // look like a contract change and train people to regenerate without reading.
    const surface = tools
      .map((t) => ({
        name: t.name,
        required: ((t.inputSchema as { required?: string[] } | undefined)?.required ?? []).slice().sort(),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    expectContract('mcp-tools.json', surface);
  });

  it('offers login and orientation before a connection exists', async () => {
    // An unconnected bridge must still advertise the way IN, or an agent has no first move.
    const names = (await listTools()).map((t) => t.name);
    expect(names).toContain('login');
    expect(names).toContain('get_scope');
  });
});
