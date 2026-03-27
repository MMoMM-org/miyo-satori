import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadConfig, expandEnv } from '../config/loader.js';

function writeTOML(dir: string, name: string, content: string): void {
  writeFileSync(join(dir, name), content, 'utf-8');
}

describe('loadConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'satori-cfg-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty config when no files exist', () => {
    const config = loadConfig(tmpDir);
    expect(config).toEqual({});
  });

  it('loads repo-level config when only satori.toml present', () => {
    writeTOML(tmpDir, 'satori.toml', `
[gateway]
auto_register_mcp_json = true

[[servers]]
name = "A"
runtime = "npx"
command = "@server/a"
`);
    const config = loadConfig(tmpDir);
    expect(config.gateway?.auto_register_mcp_json).toBe(true);
    expect(config.servers).toHaveLength(1);
    expect(config.servers![0].name).toBe('A');
  });

  it('merges global and repo configs: repo scalars override global', () => {
    const globalDir = join(tmpDir, '.satori');
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(join(globalDir, 'config.toml'), `
[context]
retain_days = 7

[[servers]]
name = "A"
runtime = "npx"
command = "@server/a-global"
`, 'utf-8');

    writeTOML(tmpDir, 'satori.toml', `
[context]
retain_days = 30

[[servers]]
name = "B"
runtime = "external"
host = "localhost"
port = 3001

[[servers]]
name = "A"
runtime = "npx"
command = "@server/a-repo"
`);

    // We need to redirect HOME to tmpDir for the global path resolution
    const origHome = process.env.HOME;
    process.env.HOME = tmpDir;
    try {
      const config = loadConfig(tmpDir);
      expect(config.context?.retain_days).toBe(30);
      expect(config.servers).toHaveLength(2);
      const serverA = config.servers!.find(s => s.name === 'A');
      const serverB = config.servers!.find(s => s.name === 'B');
      expect(serverA).toBeDefined();
      expect(serverA!.command).toBe('@server/a-repo');
      expect(serverB).toBeDefined();
    } finally {
      process.env.HOME = origHome;
    }
  });

  it('loads project-level config when project_dir is set in repo config', () => {
    const projectDir = join(tmpDir, 'project');
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(join(projectDir, 'satori.toml'), `
[context]
retain_days = 14

[[servers]]
name = "shared"
runtime = "npx"
command = "@org/shared-server"
`, 'utf-8');

    writeTOML(tmpDir, 'satori.toml', `
project_dir = "${projectDir}"

[context]
retain_days = 30

[[servers]]
name = "local"
runtime = "npx"
command = "@org/local-server"
`);

    const config = loadConfig(tmpDir);
    // repo retain_days wins over project
    expect(config.context?.retain_days).toBe(30);
    // servers from both levels present
    expect(config.servers).toHaveLength(2);
    expect(config.servers!.find(s => s.name === 'shared')).toBeDefined();
    expect(config.servers!.find(s => s.name === 'local')).toBeDefined();
  });

  it('project-level server is overridden by repo-level server with same name', () => {
    const projectDir = join(tmpDir, 'project');
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(join(projectDir, 'satori.toml'), `
[[servers]]
name = "shared"
runtime = "npx"
command = "@org/shared-project"
`, 'utf-8');

    writeTOML(tmpDir, 'satori.toml', `
project_dir = "${projectDir}"

[[servers]]
name = "shared"
runtime = "npx"
command = "@org/shared-repo"
`);

    const config = loadConfig(tmpDir);
    expect(config.servers).toHaveLength(1);
    expect(config.servers![0].command).toBe('@org/shared-repo');
  });

  it('skips project-level load when project_dir not set', () => {
    writeTOML(tmpDir, 'satori.toml', `
[[servers]]
name = "only-repo"
runtime = "npx"
command = "@org/repo-server"
`);

    const config = loadConfig(tmpDir);
    expect(config.servers).toHaveLength(1);
    expect(config.servers![0].name).toBe('only-repo');
  });

  it('parses all TOML scalar types correctly', () => {
    writeTOML(tmpDir, 'satori.toml', `
[gateway]
auto_register_mcp_json = false

[context]
db_path = ".satori/db.sqlite"
session_guide_max_bytes = 2048
retain_days = 30

[lifecycle]
npx_startup_timeout_ms = 30000

[security]
startup_scan = true
runtime_scan = true
return_scan = false
audit_log = ".satori/scanner.log"

[[servers]]
name = "test"
runtime = "npx"
command = "@test/server"
args = ["--flag", "--value"]
enabled = true
`);
    const config = loadConfig(tmpDir);
    expect(config.gateway?.auto_register_mcp_json).toBe(false);
    expect(config.context?.db_path).toBe('.satori/db.sqlite');
    expect(config.context?.session_guide_max_bytes).toBe(2048);
    expect(config.context?.retain_days).toBe(30);
    expect(config.lifecycle?.npx_startup_timeout_ms).toBe(30000);
    expect(config.security?.startup_scan).toBe(true);
    expect(config.security?.return_scan).toBe(false);
    expect(config.servers![0].args).toEqual(['--flag', '--value']);
    expect(config.servers![0].enabled).toBe(true);
  });
});

describe('expandEnv', () => {
  it('expands ${KEY} from env record', () => {
    const result = expandEnv('Bearer ${TOKEN}', { TOKEN: 'abc123' });
    expect(result).toBe('Bearer abc123');
  });

  it('expands multiple variables', () => {
    const result = expandEnv('${HOST}:${PORT}', { HOST: 'localhost', PORT: '3001' });
    expect(result).toBe('localhost:3001');
  });

  it('throws with variable name when key is missing', () => {
    expect(() => expandEnv('${GITHUB_TOKEN}', {})).toThrow('Unexpanded variable: ${GITHUB_TOKEN}');
  });

  it('returns string unchanged when no variables present', () => {
    const result = expandEnv('hello world', {});
    expect(result).toBe('hello world');
  });
});
