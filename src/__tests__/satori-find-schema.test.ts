import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ToolCatalog } from '../gateway/catalog.js';
import { LifecycleManager } from '../lifecycle/manager.js';
import { registerSatoriFind } from '../tools/satori-find.js';
import { registerSatoriSchema } from '../tools/satori-schema.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

function makeTool(name: string, description: string): Tool {
  return {
    name,
    description,
    inputSchema: {
      type: 'object' as const,
      properties: { path: { type: 'string' } },
    },
  };
}

type McpRegisteredTools = Record<string, { handler: (args: Record<string, unknown>) => Promise<unknown> }>;

async function callTool(
  mcpServer: McpServer,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const registeredTools = (mcpServer as unknown as { _registeredTools: McpRegisteredTools })._registeredTools;
  const tool = registeredTools[toolName];
  if (!tool) throw new Error(`Tool ${toolName} not found`);
  return tool.handler(args) as Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
}

describe('satori_find', () => {
  let mcpServer: McpServer;
  let catalog: ToolCatalog;
  let lifecycle: LifecycleManager;

  beforeEach(() => {
    mcpServer = new McpServer({ name: 'test', version: '0.1.0' });
    catalog = new ToolCatalog();
    lifecycle = new LifecycleManager();

    catalog.populate('filesystem', [
      makeTool('read_file', 'Reads the contents of a file'),
      makeTool('write_file', 'Writes content to a file'),
      makeTool('list_directory', 'Lists directory contents'),
    ]);
    catalog.populate('other', [
      makeTool('read_resource', 'Reads a remote resource'),
    ]);

    registerSatoriFind(mcpServer, catalog, lifecycle);
  });

  it('empty query returns all tools', async () => {
    const result = await callTool(mcpServer, 'satori_find', { query: '' });
    const items = JSON.parse(result.content[0].text);
    expect(items).toHaveLength(4);
  });

  it('query "read" returns matching tools from all servers', async () => {
    const result = await callTool(mcpServer, 'satori_find', { query: 'read' });
    const items = JSON.parse(result.content[0].text);
    expect(items.some((i: { tool: string }) => i.tool === 'read_file')).toBe(true);
    expect(items.some((i: { tool: string }) => i.tool === 'read_resource')).toBe(true);
  });

  it('server filter limits results to one server', async () => {
    const result = await callTool(mcpServer, 'satori_find', { query: 'read', server: 'other' });
    const items = JSON.parse(result.content[0].text);
    expect(items).toHaveLength(1);
    expect(items[0].server).toBe('other');
    expect(items[0].tool).toBe('read_resource');
  });

  it('no match returns empty array, not error', async () => {
    const result = await callTool(mcpServer, 'satori_find', { query: 'zzznomatch' });
    expect(result.isError).toBeFalsy();
    const items = JSON.parse(result.content[0].text);
    expect(items).toHaveLength(0);
  });

  it('each result has server, tool, description, state fields', async () => {
    const result = await callTool(mcpServer, 'satori_find', { query: 'read_file' });
    const items = JSON.parse(result.content[0].text);
    expect(items[0]).toHaveProperty('server');
    expect(items[0]).toHaveProperty('tool');
    expect(items[0]).toHaveProperty('description');
    expect(items[0]).toHaveProperty('state');
  });
});

describe('satori_schema', () => {
  let mcpServer: McpServer;
  let catalog: ToolCatalog;

  beforeEach(() => {
    mcpServer = new McpServer({ name: 'test', version: '0.1.0' });
    catalog = new ToolCatalog();

    catalog.populate('filesystem', [
      makeTool('read_file', 'Reads the contents of a file'),
    ]);

    registerSatoriSchema(mcpServer, catalog);
  });

  it('returns correct schema shape for known server and tool', async () => {
    const result = await callTool(mcpServer, 'satori_schema', { server: 'filesystem', tool: 'read_file' });
    const schema = JSON.parse(result.content[0].text);
    expect(schema.name).toBe('read_file');
    expect(schema.description).toBe('Reads the contents of a file');
    expect(schema.inputSchema).toBeDefined();
  });

  it('returns error for unknown server', async () => {
    const result = await callTool(mcpServer, 'satori_schema', { server: 'unknown', tool: 'any' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeDefined();
    expect(typeof parsed.error).toBe('string');
  });

  it('returns error for unknown tool on known server', async () => {
    const result = await callTool(mcpServer, 'satori_schema', { server: 'filesystem', tool: 'nonexistent' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBeDefined();
  });
});
