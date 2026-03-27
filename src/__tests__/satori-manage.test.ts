import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parse } from 'smol-toml';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ServerRegistry } from '../gateway/registry.js';
import { registerSatoriManage } from '../tools/satori-manage.js';
import type { SatoriConfig } from '../config/schema.js';

function makeSatoriToml(dir: string, content: string): void {
  writeFileSync(join(dir, 'satori.toml'), content, 'utf-8');
}

function readParsedToml(dir: string): SatoriConfig {
  const raw = readFileSync(join(dir, 'satori.toml'), 'utf-8');
  return parse(raw) as unknown as SatoriConfig;
}

async function callTool(
  mcpServer: McpServer,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  // Access internal tool registry via the underlying server (_registeredTools is a plain object)
  const registeredTools = (mcpServer as unknown as { _registeredTools: Record<string, { handler: (args: Record<string, unknown>) => Promise<unknown> }> })._registeredTools;
  const tool = registeredTools[toolName];
  if (!tool) throw new Error(`Tool ${toolName} not found`);
  return tool.handler(args) as Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
}

describe('satori_manage', () => {
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

  describe('add', () => {
    it('writes new server to satori.toml and updates registry', async () => {
      const result = await callTool(mcpServer, 'satori_manage', {
        sub_command: 'add',
        name: 'new-server',
        runtime: 'npx',
        command: '@test/server',
      });

      expect(result.content[0].text).toContain('new-server');
      expect(existsSync(join(tmpDir, 'satori.toml'))).toBe(true);

      const parsed = readParsedToml(tmpDir);
      expect(parsed.servers).toBeDefined();
      expect(parsed.servers!.some(s => s.name === 'new-server')).toBe(true);

      const listed = registry.lookup('new-server');
      expect(listed).not.toBeNull();
    });

    it('returns error when name is missing', async () => {
      const result = await callTool(mcpServer, 'satori_manage', {
        sub_command: 'add',
        runtime: 'npx',
      });
      expect(result.isError).toBe(true);
    });
  });

  describe('remove', () => {
    it('removes server from satori.toml and registry', async () => {
      makeSatoriToml(tmpDir, `
[[servers]]
name = "to-remove"
runtime = "npx"
command = "@test/server"

[[servers]]
name = "keep"
runtime = "external"
host = "localhost"
port = 9000
`);
      registry.load({
        servers: [
          { name: 'to-remove', runtime: 'npx' },
          { name: 'keep', runtime: 'external', host: 'localhost', port: 9000 },
        ],
      });

      await callTool(mcpServer, 'satori_manage', { sub_command: 'remove', name: 'to-remove' });

      const parsed = readParsedToml(tmpDir);
      expect(parsed.servers!.some(s => s.name === 'to-remove')).toBe(false);
      expect(parsed.servers!.some(s => s.name === 'keep')).toBe(true);
      expect(registry.lookup('to-remove')).toBeNull();
    });

    it('returns message when server not found', async () => {
      makeSatoriToml(tmpDir, '');
      const result = await callTool(mcpServer, 'satori_manage', {
        sub_command: 'remove',
        name: 'nonexistent',
      });
      expect(result.content[0].text).toContain('not found');
    });
  });

  describe('enable/disable', () => {
    it('toggles enabled flag in satori.toml', async () => {
      makeSatoriToml(tmpDir, `
[[servers]]
name = "srv"
runtime = "npx"
command = "@test/server"
enabled = true
`);
      registry.load({ servers: [{ name: 'srv', runtime: 'npx', enabled: true }] });

      await callTool(mcpServer, 'satori_manage', { sub_command: 'disable', name: 'srv' });
      expect(registry.lookup('srv')!.enabled).toBe(false);

      const parsed = readParsedToml(tmpDir);
      const srv = parsed.servers!.find(s => s.name === 'srv');
      expect(srv!.enabled).toBe(false);

      await callTool(mcpServer, 'satori_manage', { sub_command: 'enable', name: 'srv' });
      expect(registry.lookup('srv')!.enabled).toBe(true);
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
  });

  describe('reload', () => {
    it('returns reload message', async () => {
      const result = await callTool(mcpServer, 'satori_manage', { sub_command: 'reload' });
      expect(result.content[0].text).toContain('reload');
    });
  });

  describe('set_project_dir', () => {
    it('writes project_dir to satori.toml (new file)', async () => {
      const result = await callTool(mcpServer, 'satori_manage', {
        sub_command: 'set_project_dir',
        dir: '/tmp/my-project',
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('/tmp/my-project');
      expect(existsSync(join(tmpDir, 'satori.toml'))).toBe(true);

      const raw = readFileSync(join(tmpDir, 'satori.toml'), 'utf-8');
      expect(raw).toContain('project_dir = "/tmp/my-project"');
    });

    it('updates existing project_dir line in satori.toml', async () => {
      makeSatoriToml(tmpDir, 'project_dir = "/old/path"\n\n[gateway]\nauto_register_mcp_json = false\n');

      await callTool(mcpServer, 'satori_manage', {
        sub_command: 'set_project_dir',
        dir: '/new/path',
      });

      const raw = readFileSync(join(tmpDir, 'satori.toml'), 'utf-8');
      expect(raw).toContain('project_dir = "/new/path"');
      expect(raw).not.toContain('/old/path');
      expect(raw).toContain('auto_register_mcp_json');
    });

    it('returns error when dir is missing', async () => {
      const result = await callTool(mcpServer, 'satori_manage', {
        sub_command: 'set_project_dir',
      });
      expect(result.isError).toBe(true);
    });

    it('scope=project resolves to project satori.toml when project_dir is set', async () => {
      const projectDir = join(tmpDir, 'project');
      mkdirSync(projectDir, { recursive: true });
      // Set project_dir in repo satori.toml
      makeSatoriToml(tmpDir, `project_dir = "${projectDir}"\n`);

      // Add a server to scope=project → should write to projectDir/satori.toml
      const result = await callTool(mcpServer, 'satori_manage', {
        sub_command: 'add',
        name: 'project-server',
        runtime: 'npx',
        command: '@org/project-server',
        scope: 'project',
      });

      expect(result.isError).toBeUndefined();
      expect(existsSync(join(projectDir, 'satori.toml'))).toBe(true);
      const raw = readFileSync(join(projectDir, 'satori.toml'), 'utf-8');
      expect(raw).toContain('project-server');
    });
  });
});
