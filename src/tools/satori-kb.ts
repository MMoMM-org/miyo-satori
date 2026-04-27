import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { KnowledgeDB } from '../knowledge/knowledge-db.js';

const inputSchema = {
  sub_command: z.enum(['index', 'search', 'fetch_and_index']),
  content: z.string().optional(),
  title: z.string().optional(),
  type: z.enum(['prose', 'code']).optional(),
  query: z.string().optional(),
  contentType: z.enum(['prose', 'code']).optional(),
  limit: z.number().optional(),
  url: z.string().optional(),
  session_id: z.string().optional(),
};

export function registerSatoriKb(server: McpServer, knowledgeDb: KnowledgeDB, client: string): void {
  server.tool(
    'satori_kb',
    'Knowledge base: index markdown content or URLs, search with BM25+RRF, retrieve smart snippets',
    inputSchema,
    async (args) => {
      try {
        switch (args.sub_command) {
          case 'index': {
            if (!args.content) {
              return {
                content: [{ type: 'text' as const, text: 'content is required for index' }],
                isError: true,
              };
            }
            const chunkCount = knowledgeDb.index({
              client,
              content: args.content,
              title: args.title,
              type: args.type,
              sourceUrl: args.url,
            });
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ indexed: chunkCount }) }],
            };
          }

          case 'search': {
            if (!args.query) {
              return {
                content: [{ type: 'text' as const, text: 'query is required for search' }],
                isError: true,
              };
            }
            const result = knowledgeDb.search({
              client,
              query: args.query,
              contentType: args.contentType,
              limit: args.limit,
              sessionId: args.session_id,
            });
            // ThrottleBlock has blocked: true — valid response, not an error
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(result) }],
            };
          }

          case 'fetch_and_index': {
            if (!args.url) {
              return {
                content: [{ type: 'text' as const, text: 'url is required for fetch_and_index' }],
                isError: true,
              };
            }
            const result = await knowledgeDb.fetchAndIndex({
              client,
              url: args.url,
              title: args.title,
            });
            if ('error' in result) {
              return {
                content: [{ type: 'text' as const, text: result.error }],
                isError: true,
              };
            }
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ indexed: result.indexed }) }],
            };
          }

          default: {
            const cmd = (args as { sub_command: string }).sub_command;
            return {
              content: [{ type: 'text' as const, text: `Error: unknown sub_command "${cmd}"` }],
              isError: true,
            };
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
