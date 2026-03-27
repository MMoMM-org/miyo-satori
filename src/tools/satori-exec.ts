import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GatewayRouter } from '../gateway/router.js';

export function registerSatoriExec(
  server: McpServer,
  router: GatewayRouter,
): void {
  server.tool(
    'satori_exec',
    'Execute a tool on a downstream MCP server through the Satori gateway',
    {
      server: z.string(),
      tool: z.string(),
      args: z.record(z.string(), z.unknown()).optional(),
      session_id: z.string().optional(),
    },
    async (inputArgs) => {
      if (!inputArgs.server) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'server is required' }) }],
          isError: true,
        };
      }
      if (!inputArgs.tool) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'tool is required' }) }],
          isError: true,
        };
      }

      const result = await router.exec(
        inputArgs.server,
        inputArgs.tool,
        (inputArgs.args as Record<string, unknown>) ?? {},
        inputArgs.session_id,
      );

      return {
        content: [{ type: 'text' as const, text: result.content }],
        ...(result.isError ? { isError: true } : {}),
      };
    },
  );
}
