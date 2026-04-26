import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ServerRegistry } from '../gateway/registry.js';
import { registerSatoriManage } from '../tools/satori-manage.js';

async function callTool(
  mcpServer: McpServer,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const registeredTools = (mcpServer as unknown as { _registeredTools: Record<string, { handler: (args: Record<string, unknown>) => Promise<unknown> }> })._registeredTools;
  const tool = registeredTools[toolName];
  if (!tool) throw new Error(`Tool ${toolName} not found`);
  return tool.handler(args) as Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
}

describe('satori_manage (read-only)', () => {
  let tmpDir: string;
  let registry: ServerRegistry;
  let mcpServer: McpServer;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'satori-manage-'));
    registry = new ServerRegistry();
    mcpServer = new McpServer({ name: 'satori-test', version: '0.1.0' });
    registerSatoriManage(mcpServer, registry, tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('list', () => {
    it('returns empty array when no servers registered', async () => {
      const result = await callTool(mcpServer, 'satori_manage', { sub_command: 'list' });
      const list = JSON.parse(result.content[0].text);
      expect(list).toEqual([]);
    });

    it('returns all registered servers', async () => {
      registry.load({
        servers: [
          { name: 'alpha', runtime: 'npx', enabled: true },
          { name: 'beta', runtime: 'docker', enabled: false },
        ],
      });

      const result = await callTool(mcpServer, 'satori_manage', { sub_command: 'list' });
      const list = JSON.parse(result.content[0].text);
      expect(list).toHaveLength(2);
      expect(list[0].name).toBe('alpha');
      expect(list[1].name).toBe('beta');
    });
  });

  describe('state', () => {
    it('returns server info with lifecycle placeholder', async () => {
      registry.load({ servers: [{ name: 'my-srv', runtime: 'npx', handler: 'passthrough' }] });

      const result = await callTool(mcpServer, 'satori_manage', {
        sub_command: 'state',
        name: 'my-srv',
      });
      const state = JSON.parse(result.content[0].text);
      expect(state.name).toBe('my-srv');
      expect(state.runtime).toBe('npx');
      expect(state.lifecycle).toBe('stopped');
    });

    it('returns error for unknown server', async () => {
      const result = await callTool(mcpServer, 'satori_manage', {
        sub_command: 'state',
        name: 'unknown',
      });
      expect(result.isError).toBe(true);
    });

    it('returns error when name is missing', async () => {
      const result = await callTool(mcpServer, 'satori_manage', { sub_command: 'state' });
      expect(result.isError).toBe(true);
    });
  });

  describe('scan', () => {
    it('scans named server config', async () => {
      registry.load({ servers: [{ name: 'safe', runtime: 'npx', command: '@safe/server' }] });

      const result = await callTool(mcpServer, 'satori_manage', {
        sub_command: 'scan',
        name: 'safe',
      });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.status).toBe('passed');
    });

    it('scans all servers when name omitted', async () => {
      registry.load({
        servers: [
          { name: 'a', runtime: 'npx', command: '@safe/a' },
          { name: 'b', runtime: 'npx', command: '@safe/b' },
        ],
      });

      const result = await callTool(mcpServer, 'satori_manage', { sub_command: 'scan' });
      const parsed = JSON.parse(result.content[0].text);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(2);
    });

    it('returns error when scanning unknown server', async () => {
      const result = await callTool(mcpServer, 'satori_manage', {
        sub_command: 'scan',
        name: 'unknown',
      });
      expect(result.isError).toBe(true);
    });
  });
});
