import { z } from 'zod';
import { parse } from 'smol-toml';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerRegistry } from '../gateway/registry.js';
import { SecurityScanner } from '../security/scanner.js';
import { AuditLog } from '../security/audit-log.js';
import type { SatoriConfig, ServerConfig } from '../config/schema.js';

const inputSchema = {
  sub_command: z.enum(['list', 'add', 'remove', 'enable', 'disable', 'state', 'scan', 'reload']),
  name: z.string().optional(),
  runtime: z.enum(['npx', 'docker', 'external']).optional(),
  command: z.string().optional(),
  image: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  handler: z.string().optional(),
  scope: z.enum(['repo', 'project', 'global']).optional(),
};

function resolveTomlPath(scope: string | undefined, repoRoot: string): string {
  if (scope === 'global') return join(homedir(), '.satori', 'config.toml');
  return join(repoRoot, 'satori.toml');
}

function readTomlConfig(tomlPath: string): SatoriConfig {
  if (!existsSync(tomlPath)) return {};
  try {
    const raw = readFileSync(tomlPath, 'utf-8');
    return parse(raw) as unknown as SatoriConfig;
  } catch {
    return {};
  }
}

function serializeServerBlock(server: ServerConfig): string {
  const lines: string[] = ['[[servers]]'];
  lines.push(`name = "${server.name}"`);
  lines.push(`runtime = "${server.runtime}"`);

  if (server.command !== undefined) lines.push(`command = "${server.command}"`);
  if (server.image !== undefined) lines.push(`image = "${server.image}"`);
  if (server.enabled !== undefined) lines.push(`enabled = ${server.enabled}`);
  if (server.handler !== undefined) lines.push(`handler = "${server.handler}"`);

  if (server.args !== undefined && server.args.length > 0) {
    const argsStr = server.args.map(a => `"${a}"`).join(', ');
    lines.push(`args = [${argsStr}]`);
  }
  if (server.env !== undefined && Object.keys(server.env).length > 0) {
    const envParts = Object.entries(server.env)
      .map(([k, v]) => `${k} = "${v}"`)
      .join(', ');
    lines.push(`env = { ${envParts} }`);
  }
  if (server.host !== undefined) lines.push(`host = "${server.host}"`);
  if (server.port !== undefined) lines.push(`port = ${server.port}`);
  if (server.transport !== undefined) lines.push(`transport = "${server.transport}"`);

  return lines.join('\n');
}

function appendServerToToml(tomlPath: string, server: ServerConfig): void {
  const existing = existsSync(tomlPath) ? readFileSync(tomlPath, 'utf-8') : '';
  const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  const block = serializeServerBlock(server);
  writeFileSync(tomlPath, existing + separator + block + '\n', 'utf-8');
}

function removeServerFromToml(tomlPath: string, name: string): boolean {
  if (!existsSync(tomlPath)) return false;
  const raw = readFileSync(tomlPath, 'utf-8');
  const lines = raw.split('\n');

  // First pass: identify blocks and check which ones match the target name
  type Block = { start: number; end: number; isTarget: boolean };
  const blocks: Block[] = [];
  let currentBlockStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '[[servers]]') {
      if (currentBlockStart >= 0) {
        // Close previous block
        let isTarget = false;
        for (let j = currentBlockStart + 1; j < i; j++) {
          const t = lines[j].trim();
          if (t.startsWith('name') && t.includes(`"${name}"`)) {
            isTarget = true;
            break;
          }
        }
        blocks.push({ start: currentBlockStart, end: i - 1, isTarget });
      }
      currentBlockStart = i;
    }
  }

  if (currentBlockStart >= 0) {
    let isTarget = false;
    for (let j = currentBlockStart + 1; j < lines.length; j++) {
      const t = lines[j].trim();
      if (t.startsWith('name') && t.includes(`"${name}"`)) {
        isTarget = true;
        break;
      }
    }
    blocks.push({ start: currentBlockStart, end: lines.length - 1, isTarget });
  }

  const targetBlock = blocks.find(b => b.isTarget);
  if (!targetBlock) return false;

  const resultLines = lines.filter((_, idx) => idx < targetBlock.start || idx > targetBlock.end);
  writeFileSync(tomlPath, resultLines.join('\n'), 'utf-8');
  return true;
}

function updateServerEnabledInToml(tomlPath: string, name: string, enabled: boolean): boolean {
  if (!existsSync(tomlPath)) return false;
  const raw = readFileSync(tomlPath, 'utf-8');
  const lines = raw.split('\n');

  let inTargetBlock = false;
  let updated = false;
  const resultLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '[[servers]]') {
      inTargetBlock = false;
      // Peek ahead for name match
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j].trim();
        if (next === '[[servers]]') break;
        if (next.startsWith('name') && next.includes(`"${name}"`)) {
          inTargetBlock = true;
          break;
        }
      }
    }

    if (inTargetBlock && trimmed.startsWith('enabled')) {
      resultLines.push(`enabled = ${enabled}`);
      updated = true;
      continue;
    }

    resultLines.push(line);
  }

  if (inTargetBlock && !updated) {
    // Server found but no enabled line exists — append it before next [[servers]] or at end
    let insertIdx = -1;
    for (let k = resultLines.length - 1; k > 0; k--) {
      const trimmed = resultLines[k].trim();
      if (trimmed !== '' && !trimmed.startsWith('[[servers]]')) {
        insertIdx = k;
        break;
      }
    }
    if (insertIdx >= 0) {
      resultLines.splice(insertIdx + 1, 0, `enabled = ${enabled}`);
      updated = true;
    }
  }

  writeFileSync(tomlPath, resultLines.join('\n'), 'utf-8');
  return updated;
}

export function registerSatoriManage(
  server: McpServer,
  registry: ServerRegistry,
  repoRoot: string,
): void {
  const auditLogPath = join(repoRoot, '.satori', 'scanner.log');
  const auditLog = new AuditLog(auditLogPath);
  const scanner = new SecurityScanner(auditLog);

  server.tool(
    'satori_manage',
    'Manage downstream MCP servers: list, add, remove, enable, disable, state, scan, reload',
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

        case 'add': {
          if (!args.name || !args.runtime) {
            return {
              content: [{ type: 'text' as const, text: 'Error: name and runtime are required for add' }],
              isError: true,
            };
          }
          const tomlPath = resolveTomlPath(args.scope, repoRoot);
          const newServer: ServerConfig = {
            name: args.name,
            runtime: args.runtime,
            command: args.command,
            image: args.image,
            args: args.args,
            env: args.env,
            handler: args.handler,
            enabled: true,
          };
          appendServerToToml(tomlPath, newServer);
          const config = readTomlConfig(tomlPath);
          registry.load(config);
          return {
            content: [{ type: 'text' as const, text: `Server "${args.name}" added to ${tomlPath}` }],
          };
        }

        case 'remove': {
          if (!args.name) {
            return {
              content: [{ type: 'text' as const, text: 'Error: name is required for remove' }],
              isError: true,
            };
          }
          const tomlPath = resolveTomlPath(args.scope, repoRoot);
          const removed = removeServerFromToml(tomlPath, args.name);
          const config = readTomlConfig(tomlPath);
          registry.load(config);
          return {
            content: [{
              type: 'text' as const,
              text: removed
                ? `Server "${args.name}" removed from ${tomlPath}`
                : `Server "${args.name}" not found in ${tomlPath}`,
            }],
          };
        }

        case 'enable':
        case 'disable': {
          if (!args.name) {
            return {
              content: [{ type: 'text' as const, text: `Error: name is required for ${sub_command}` }],
              isError: true,
            };
          }
          const enabled = sub_command === 'enable';
          const tomlPath = resolveTomlPath(args.scope, repoRoot);
          updateServerEnabledInToml(tomlPath, args.name, enabled);
          registry.setEnabled(args.name, enabled);
          return {
            content: [{
              type: 'text' as const,
              text: `Server "${args.name}" ${sub_command}d`,
            }],
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

        case 'reload': {
          return {
            content: [{
              type: 'text' as const,
              text: 'Catalog reload available after Phase 5 (catalog not yet initialized)',
            }],
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
