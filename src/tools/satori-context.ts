import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionDB } from '../context/session-db.js';
import type { ContentDB } from '../context/content-db.js';
import { buildResumeSnapshot } from '../context/snapshot.js';

const TOOL_SESSION_ID = 'tool-session';

const inputSchema = {
  sub_command: z.enum(['restore', 'query', 'status', 'flush']),
  q: z.string().optional(),
  limit: z.number().optional(),
  session_id: z.string().optional(),
};

export function registerSatoriContext(
  server: McpServer,
  sessionDb: SessionDB,
  contentDb: ContentDB,
): void {
  server.tool(
    'satori_context',
    'Context DB: restore session snapshot, query captured tool output, check status, or force flush.',
    inputSchema,
    async (args) => {
      try {
        const result = handleSubCommand(args, sessionDb, contentDb);
        return {
          content: [{ type: 'text' as const, text: result }],
        };
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

function handleSubCommand(
  args: {
    sub_command: 'restore' | 'query' | 'status' | 'flush';
    q?: string;
    limit?: number;
    session_id?: string;
  },
  sessionDb: SessionDB,
  contentDb: ContentDB,
): string {
  const sessionId = args.session_id ?? TOOL_SESSION_ID;

  switch (args.sub_command) {
    case 'restore': {
      const resume = sessionDb.getResume(sessionId);
      if (!resume) return 'No session snapshot available.';
      sessionDb.markResumeConsumed(sessionId);
      return resume.snapshot;
    }

    case 'query': {
      const q = args.q ?? '';
      if (!q) return JSON.stringify([]);
      const results = contentDb.search(q, args.limit ?? 10);
      return JSON.stringify(results);
    }

    case 'status': {
      const stats = sessionDb.getSessionStats();
      const captureCount = contentDb.getBySession(sessionId).length;
      const status = {
        sessions: stats.session_count,
        events: stats.event_count,
        resumes: stats.resume_count,
        captures: captureCount,
      };
      return JSON.stringify(status);
    }

    case 'flush': {
      const events = sessionDb.getEvents(sessionId);
      const snapshot = buildResumeSnapshot(events);
      sessionDb.upsertResume(sessionId, snapshot, events.length);
      return `Snapshot generated: ${Buffer.byteLength(snapshot, 'utf8')} bytes`;
    }

    default: {
      const cmd = (args as { sub_command: string }).sub_command;
      return `Error: unknown sub_command "${cmd}"`;
    }
  }
}
