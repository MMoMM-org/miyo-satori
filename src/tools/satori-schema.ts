import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolCatalog } from '../gateway/catalog.js';

export function registerSatoriSchema(
  server: McpServer,
  catalog: ToolCatalog,
): void {
  server.tool(
    'satori_schema',
    'Get the input schema for a specific tool on a downstream MCP server',
    {
      server: z.string(),
      tool: z.string(),
    },
    async (args) => {
      const schema = catalog.getSchema(args.server, args.tool);
      if (!schema) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: `Tool "${args.tool}" not found on server "${args.server}"` }) }],
        };
      }
      const result = {
        name: schema.name,
        description: schema.description ?? '',
        inputSchema: schema.inputSchema,
      };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );
}
