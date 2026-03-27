import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionDB } from '../context/session-db.js';
import type { ContentDB } from '../context/content-db.js';

export function registerSatoriContext(
  server: McpServer,
  sessionDb: SessionDB,
  contentDb: ContentDB,
): void {
  server.tool(
    'satori_context',
    'Manage session context and search captured tool interactions',
    {
      sub_command: z.enum(['init', 'search']),
      session_id: z.string().optional(),
      query: z.string().optional(),
      limit: z.number().int().positive().optional(),
    },
    async (args) => {
      const { sub_command } = args;

      switch (sub_command) {
        case 'init': {
          if (!args.session_id) {
            return {
              content: [{ type: 'text' as const, text: 'Error: session_id is required for init' }],
              isError: true,
            };
          }
          sessionDb.upsert(args.session_id);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ session_id: args.session_id, status: 'initialized' }) }],
          };
        }

        case 'search': {
          const query = args.query ?? '';
          const limit = args.limit ?? 20;
          const results = contentDb.search(query, limit);
          const rows = results.map(r => ({
            id: r.id,
            session_id: r.session_id,
            server: r.server,
            tool: r.tool,
            summary: r.summary,
            created_at: r.created_at,
          }));
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(rows, null, 2) }],
          };
        }

        default: {
          return {
            content: [{ type: 'text' as const, text: `Unknown sub_command: ${sub_command}` }],
            isError: true,
          };
        }
      }
    },
  );
}
