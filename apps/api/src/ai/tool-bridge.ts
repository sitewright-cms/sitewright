import type { FastifyInstance } from 'fastify';
import type { Capability } from '@sitewright/mcp';
import { MCP_TOOL_CATALOG } from '@sitewright/schema';
import type { AgentToolDef, ToolResultPart } from './agent-provider.js';

/** The stateless-JSON `/mcp` transport wants both accept types. */
const MCP_HEADERS = { accept: 'application/json, text/event-stream', 'content-type': 'application/json' } as const;

/** Orientation/auth tools that make no sense server-side (the loop is pre-connected + pre-scoped). */
const EXCLUDED_TOOLS = new Set(['login', 'switch_project', 'get_scope']);

/** name → required capability, from the pinned catalog (tools/list doesn't carry it). */
const TOOL_CAPABILITY = new Map<string, Capability | undefined>(
  MCP_TOOL_CATALOG.map((t) => [t.name, t.capability as Capability | undefined]),
);

export interface ToolCallResult {
  content: ToolResultPart[];
  isError: boolean;
}

interface JsonRpcResponse {
  result?: { tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>; content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>; isError?: boolean };
  error?: { message?: string };
}

/**
 * Drives the platform's MCP tools IN-PROCESS by injecting JSON-RPC into the deployed
 * `/mcp` route (the exact same path hosted MCP clients use) with a scoped bearer token.
 * So every tool call gets capability gating, template validation, revision history and
 * `actor:'agent'` change events for free — no bespoke duplication. The token's
 * capabilities are the real enforcement; the `allowed`/`withhold` filtering here just
 * keeps ungranted tools out of the prompt.
 */
export class McpToolBridge {
  private rpcId = 0;

  constructor(
    private readonly app: FastifyInstance,
    private readonly token: string,
  ) {}

  /**
   * The tool definitions offered to the model — the live registry (JSON-Schema typed),
   * minus orientation tools, minus any whose capability isn't in `allowed`, minus
   * `withhold` (e.g. `delete_media`, which is not yet recoverable).
   */
  async listTools(allowed: ReadonlySet<Capability>, withhold: ReadonlySet<string> = new Set()): Promise<AgentToolDef[]> {
    const res = await this.rpc('tools/list', {});
    const tools = res.result?.tools ?? [];
    return tools
      .filter((t) => !EXCLUDED_TOOLS.has(t.name) && !withhold.has(t.name))
      .filter((t) => {
        // Fail closed: a tool present in the live registry but ABSENT from the pinned catalog is not
        // offered (catalog-drift guard). A catalogued tool with no capability (get_guide/get_reference/
        // get_components) is ungated and always offered; otherwise its capability must be granted.
        if (!TOOL_CAPABILITY.has(t.name)) return false;
        const cap = TOOL_CAPABILITY.get(t.name);
        return !cap || allowed.has(cap);
      })
      .map((t) => ({ name: t.name, description: t.description ?? '', parameters: t.inputSchema ?? { type: 'object' } }));
  }

  /** Invoke a tool; result content maps to neutral tool-result parts. */
  async callTool(name: string, args: unknown): Promise<ToolCallResult> {
    const res = await this.rpc('tools/call', { name, arguments: args ?? {} });
    const content: ToolResultPart[] = (res.result?.content ?? []).map((c) =>
      c.type === 'image'
        ? { type: 'image', data: c.data ?? '', mimeType: c.mimeType ?? 'image/png' }
        : { type: 'text', text: c.text ?? '' },
    );
    return { content, isError: res.result?.isError ?? false };
  }

  private async rpc(method: string, params: unknown): Promise<JsonRpcResponse> {
    const injected = (await this.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { ...MCP_HEADERS, authorization: `Bearer ${this.token}` },
      payload: { jsonrpc: '2.0', id: ++this.rpcId, method, params },
    })) as unknown as { statusCode: number; payload: string };
    if (injected.statusCode < 200 || injected.statusCode >= 300) {
      throw new Error(`MCP ${method} failed (${injected.statusCode})`);
    }
    const body = JSON.parse(injected.payload) as JsonRpcResponse;
    if (body.error) throw new Error(body.error.message ?? `MCP ${method} error`);
    return body;
  }
}
