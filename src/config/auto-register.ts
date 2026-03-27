import { readFileSync, writeFileSync, existsSync, renameSync } from 'fs';
import { join } from 'path';
import { parse } from 'smol-toml';
import type { SatoriConfig, ServerConfig } from './schema.js';

interface McpServerEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface McpJson {
  mcpServers: Record<string, McpServerEntry>;
}

function detectRuntime(entry: McpServerEntry): 'npx' | 'external' {
  if (entry.command.includes('npx')) return 'npx';
  if (entry.args && entry.args[0] && !entry.args[0].startsWith('-')) return 'npx';
  return 'external';
}

function serializeServerBlock(server: ServerConfig): string {
  const lines: string[] = ['[[servers]]'];
  lines.push(`name = "${server.name}"`);
  lines.push(`runtime = "${server.runtime}"`);

  if (server.command !== undefined) {
    lines.push(`command = "${server.command}"`);
  }
  if (server.image !== undefined) {
    lines.push(`image = "${server.image}"`);
  }
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
  if (server.host !== undefined) {
    lines.push(`host = "${server.host}"`);
  }
  if (server.port !== undefined) {
    lines.push(`port = ${server.port}`);
  }

  return lines.join('\n');
}

function existingServerNames(tomlPath: string): Set<string> {
  if (!existsSync(tomlPath)) return new Set();
  try {
    const raw = readFileSync(tomlPath, 'utf-8');
    const config = parse(raw) as unknown as SatoriConfig;
    return new Set((config.servers ?? []).map(s => s.name));
  } catch {
    return new Set();
  }
}

function appendToToml(tomlPath: string, blocks: string[]): void {
  const existing = existsSync(tomlPath) ? readFileSync(tomlPath, 'utf-8') : '';
  const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  const appended = separator + blocks.join('\n\n') + '\n';
  writeFileSync(tomlPath, existing + appended, 'utf-8');
}

export async function autoRegisterMcpJson(
  repoRoot: string,
  config: SatoriConfig,
): Promise<{ imported: number; skipped: number }> {
  if (config.gateway?.auto_register_mcp_json !== true) {
    return { imported: 0, skipped: 0 };
  }

  const mcpJsonPath = join(repoRoot, '.mcp.json');
  if (!existsSync(mcpJsonPath)) {
    return { imported: 0, skipped: 0 };
  }

  const raw = readFileSync(mcpJsonPath, 'utf-8');
  const mcpJson = JSON.parse(raw) as McpJson;

  const tomlPath = join(repoRoot, 'satori.toml');
  const knownNames = existingServerNames(tomlPath);

  const configNames = new Set((config.servers ?? []).map(s => s.name));
  const allKnown = new Set([...knownNames, ...configNames]);

  let imported = 0;
  let skipped = 0;
  const newBlocks: string[] = [];

  for (const [name, entry] of Object.entries(mcpJson.mcpServers)) {
    if (allKnown.has(name)) {
      skipped++;
      continue;
    }

    const runtime = detectRuntime(entry);
    const server: ServerConfig = {
      name,
      runtime,
      command: entry.command,
      args: entry.args,
      env: entry.env,
    };

    newBlocks.push(serializeServerBlock(server));
    allKnown.add(name);
    imported++;
  }

  if (newBlocks.length > 0) {
    appendToToml(tomlPath, newBlocks);
  }

  const satoriJsonPath = join(repoRoot, '.mcp.satori-json');
  renameSync(mcpJsonPath, satoriJsonPath);

  return { imported, skipped };
}
