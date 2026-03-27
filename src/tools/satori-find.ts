import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolCatalog } from '../gateway/catalog.js';
import type { LifecycleManager } from '../lifecycle/manager.js';

export function registerSatoriFind(
  server: McpServer,
  catalog: ToolCatalog,
  lifecycle: LifecycleManager,
): void {
  server.tool(
    'satori_find',
    'Search for tools across downstream MCP servers by name or description',
    {
      query: z.string(),
      server: z.string().optional(),
    },
    async (args) => {
      const entries = catalog.search(args.query, args.server);
      const results = entries.map(entry => ({
        server: entry.server,
        tool: entry.tool.name,
        description: entry.tool.description ?? '',
        state: lifecycle.getState(entry.server),
      }));
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
      };
    },
  );
}
