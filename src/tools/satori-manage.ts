import { z } from 'zod';
import { join } from 'path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerRegistry } from '../gateway/registry.js';
import { SecurityScanner } from '../security/scanner.js';
import { AuditLog } from '../security/audit-log.js';

const inputSchema = {
  sub_command: z.enum(['list', 'state', 'scan']),
  name: z.string().optional(),
};

export function registerSatoriManage(
  server: McpServer,
  registry: ServerRegistry,
  repoRoot: string,
): void {
  const auditLogPath = join(repoRoot, 'satori', 'scanner.log');
  const auditLog = new AuditLog(auditLogPath);
  const scanner = new SecurityScanner(auditLog);

  server.tool(
    'satori_manage',
    'Inspect downstream MCP servers (read-only): list, state, scan. Edit satori.toml directly to add, remove, enable, or disable servers.',
    inputSchema,
    async (args) => {
      const { sub_command } = args;

      switch (sub_command) {
        case 'list': {
          const servers = registry.list().map(s => ({
            name: s.name,
            runtime: s.runtime,
            enabled: s.enabled ?? true,
            handler: s.handler ?? 'passthrough',
          }));
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(servers, null, 2) }],
          };
        }

        case 'state': {
          if (!args.name) {
            return {
              content: [{ type: 'text' as const, text: 'Error: name is required for state' }],
              isError: true,
            };
          }
          const srv = registry.lookup(args.name);
          if (!srv) {
            return {
              content: [{ type: 'text' as const, text: `Server "${args.name}" not found` }],
              isError: true,
            };
          }
          const state = {
            name: srv.name,
            runtime: srv.runtime,
            enabled: srv.enabled ?? true,
            handler: srv.handler ?? 'passthrough',
            lifecycle: 'stopped',
          };
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(state, null, 2) }],
          };
        }

        case 'scan': {
          if (args.name) {
            const srv = registry.lookup(args.name);
            if (!srv) {
              return {
                content: [{ type: 'text' as const, text: `Server "${args.name}" not found` }],
                isError: true,
              };
            }
            const result = scanner.scanConfig(srv);
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ server: args.name, ...result }) }],
            };
          }

          const results = registry.list().map(srv => ({
            server: srv.name,
            ...scanner.scanConfig(srv),
          }));
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
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
