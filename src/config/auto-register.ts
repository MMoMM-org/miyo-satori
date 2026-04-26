import { readFileSync, writeFileSync, existsSync, renameSync } from 'fs';
import { join } from 'path';
import { parse } from 'smol-toml';
import type { SatoriConfig, ServerConfig } from './schema.js';

interface McpServerEntry {
  type?: 'http' | 'sse' | 'stdio';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

interface McpJson {
  mcpServers: Record<string, McpServerEntry>;
}

type DetectedRuntime = { kind: 'npx' | 'external' } | { kind: 'skip'; reason: string };

function detectRuntime(entry: McpServerEntry): DetectedRuntime {
  // Explicit `type` wins; otherwise infer from shape (command → stdio, url → http).
  const effectiveType =
    entry.type ?? (entry.command ? 'stdio' : entry.url ? 'http' : undefined);

  if (effectiveType === 'sse') {
    return { kind: 'skip', reason: 'SSE transport is not supported (only Streamable HTTP)' };
  }
  if (effectiveType === 'http') {
    if (!entry.url) {
      return { kind: 'skip', reason: 'http entry missing url' };
    }
    return { kind: 'external' };
  }
  if (effectiveType === 'stdio') {
    if (!entry.command) {
      return { kind: 'skip', reason: 'stdio entry missing command' };
    }
    return { kind: 'npx' };
  }
  return { kind: 'skip', reason: 'entry has neither command nor url' };
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
  if (server.url !== undefined) {
    lines.push(`url = "${server.url}"`);
  }
  if (server.headers !== undefined && Object.keys(server.headers).length > 0) {
    const headerParts = Object.entries(server.headers)
      .map(([k, v]) => `${k} = "${v.replace(/"/g, '\\"')}"`)
      .join(', ');
    lines.push(`headers = { ${headerParts} }`);
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

function buildServerConfig(name: string, entry: McpServerEntry, runtime: 'npx' | 'external'): ServerConfig {
  if (runtime === 'external') {
    return {
      name,
      runtime,
      url: entry.url,
      headers: entry.headers,
    };
  }
  return {
    name,
    runtime,
    command: entry.command,
    args: entry.args,
    env: entry.env,
  };
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

    const detected = detectRuntime(entry);
    if (detected.kind === 'skip') {
      process.stderr.write(`[satori] auto-register: skipping "${name}" — ${detected.reason}\n`);
      skipped++;
      continue;
    }

    newBlocks.push(serializeServerBlock(buildServerConfig(name, entry, detected.kind)));
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
