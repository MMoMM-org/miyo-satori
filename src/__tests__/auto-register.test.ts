import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parse } from 'smol-toml';
import { autoRegisterMcpJson } from '../config/auto-register.js';
import type { SatoriConfig } from '../config/schema.js';

function writeMcpJson(dir: string, content: object): void {
  writeFileSync(join(dir, '.mcp.json'), JSON.stringify(content), 'utf-8');
}

function readSatoriToml(dir: string): SatoriConfig {
  const raw = readFileSync(join(dir, 'satori.toml'), 'utf-8');
  return parse(raw) as unknown as SatoriConfig;
}

const sampleMcpJson = {
  mcpServers: {
    'my-server': {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
      env: { DEBUG: 'true' },
    },
    'another-server': {
      command: 'node',
      args: ['/absolute/path/server.js'],
    },
  },
};

describe('autoRegisterMcpJson', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'satori-autoreg-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns zeros when auto_register_mcp_json is false', async () => {
    writeMcpJson(tmpDir, sampleMcpJson);
    const config: SatoriConfig = { gateway: { auto_register_mcp_json: false } };
    const result = await autoRegisterMcpJson(tmpDir, config);
    expect(result).toEqual({ imported: 0, skipped: 0 });
    expect(existsSync(join(tmpDir, '.mcp.json'))).toBe(true);
  });

  it('returns zeros when .mcp.json is absent', async () => {
    const config: SatoriConfig = { gateway: { auto_register_mcp_json: true } };
    const result = await autoRegisterMcpJson(tmpDir, config);
    expect(result).toEqual({ imported: 0, skipped: 0 });
  });

  it('imports servers into satori.toml and renames .mcp.json', async () => {
    writeMcpJson(tmpDir, sampleMcpJson);
    const config: SatoriConfig = { gateway: { auto_register_mcp_json: true } };

    const result = await autoRegisterMcpJson(tmpDir, config);
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(0);

    expect(existsSync(join(tmpDir, '.mcp.json'))).toBe(false);
    expect(existsSync(join(tmpDir, '.mcp.satori-json'))).toBe(true);

    const parsed = readSatoriToml(tmpDir);
    expect(parsed.servers).toBeDefined();
    expect(parsed.servers!).toHaveLength(2);
    const names = parsed.servers!.map(s => s.name);
    expect(names).toContain('my-server');
    expect(names).toContain('another-server');
  });

  it('skips servers already present in config', async () => {
    writeMcpJson(tmpDir, sampleMcpJson);
    const config: SatoriConfig = {
      gateway: { auto_register_mcp_json: true },
      servers: [{ name: 'my-server', runtime: 'npx', command: 'existing' }],
    };

    const result = await autoRegisterMcpJson(tmpDir, config);
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);

    const parsed = readSatoriToml(tmpDir);
    expect(parsed.servers!).toHaveLength(1);
    expect(parsed.servers![0].name).toBe('another-server');
  });

  it('skips servers already in satori.toml on disk', async () => {
    writeFileSync(join(tmpDir, 'satori.toml'), `
[[servers]]
name = "my-server"
runtime = "npx"
command = "existing"
`, 'utf-8');

    writeMcpJson(tmpDir, sampleMcpJson);
    const config: SatoriConfig = { gateway: { auto_register_mcp_json: true } };
    const result = await autoRegisterMcpJson(tmpDir, config);
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it('creates satori.toml if it does not exist', async () => {
    writeMcpJson(tmpDir, {
      mcpServers: {
        'new-server': { command: 'npx', args: ['-y', '@pkg/server'] },
      },
    });
    const config: SatoriConfig = { gateway: { auto_register_mcp_json: true } };
    const result = await autoRegisterMcpJson(tmpDir, config);
    expect(result.imported).toBe(1);
    expect(existsSync(join(tmpDir, 'satori.toml'))).toBe(true);
  });
});
