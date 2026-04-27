#!/usr/bin/env node
const cliArgs = process.argv.slice(2);
if (cliArgs[0] === 'install-hooks') {
  const { runInstallHooksCli } = await import('../hooks/scripts/install-hooks.js');
  runInstallHooksCli(cliArgs.slice(1));
  process.exit(0);
}

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadConfig } from './config/loader.js';
import { autoRegisterMcpJson } from './config/auto-register.js';
import { resolveStorageDir, resolveFilePath } from './config/storage.js';
import { resolveClient } from './config/client.js';
import { ServerRegistry } from './gateway/registry.js';
import { ToolCatalog } from './gateway/catalog.js';
import { GatewayRouter } from './gateway/router.js';
import { LifecycleManager } from './lifecycle/manager.js';
import { NpxRuntime } from './lifecycle/runtimes/npx.js';
import { DockerRuntime } from './lifecycle/runtimes/docker.js';
import { HttpRuntime } from './lifecycle/runtimes/http.js';
import { HandlerRegistry } from './handlers/registry.js';
import { SecurityScanner } from './security/scanner.js';
import { AuditLog } from './security/audit-log.js';
import { SessionDB } from './context/session-db.js';
import { ContentDB } from './context/content-db.js';
import { registerSatoriContext } from './tools/satori-context.js';
import { registerSatoriManage } from './tools/satori-manage.js';
import { registerSatoriFind } from './tools/satori-find.js';
import { registerSatoriSchema } from './tools/satori-schema.js';
import { registerSatoriExec } from './tools/satori-exec.js';
import { registerSatoriKb } from './tools/satori-kb.js';
import { KnowledgeDB } from './knowledge/knowledge-db.js';
import { PolyglotExecutor } from './execution/executor.js';
import { BuiltinServer } from './execution/builtin-server.js';

interface ParsedFlags {
  root?: string;
  storage?: string;
  client?: string;
}

function parseFlags(argv: string[]): ParsedFlags {
  const out: ParsedFlags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root' && i + 1 < argv.length) {
      out.root = argv[++i];
    } else if ((argv[i] === '--storage' || argv[i] === '--project') && i + 1 < argv.length) {
      out.storage = argv[++i];
    } else if (argv[i] === '--client' && i + 1 < argv.length) {
      out.client = argv[++i];
    }
  }
  return out;
}

const server = new McpServer({ name: 'satori', version: '0.1.0' });

async function main() {
  const flags = parseFlags(cliArgs);
  const repoRoot = flags.root ?? process.cwd();

  // Config
  const config = loadConfig(repoRoot);
  if (config.gateway?.auto_register_mcp_json) {
    await autoRegisterMcpJson(repoRoot, config);
  }

  // Storage location: CLI flag → toml setting → default repo-local
  const storageDir = resolveStorageDir({ storage: flags.storage }, config, repoRoot);
  // Client identifier: CLI flag → toml setting → basename(repoRoot)
  const client = resolveClient({ client: flags.client }, config, repoRoot);
  // Default session-id for tool-calls: env-var (set by Claude Code) or synthetic
  const defaultSessionId =
    process.env.CLAUDE_SESSION_ID ?? `satori-pid-${process.pid}`;

  // Infrastructure
  const dbPath = resolveFilePath(storageDir, config.context?.db_path, 'db.sqlite');
  const sessionDb = new SessionDB(dbPath);
  const contentDb = new ContentDB(dbPath);
  contentDb.pruneOlderThan(config.context?.retain_days ?? 30);
  const auditLog = new AuditLog(
    resolveFilePath(storageDir, config.security?.audit_log, 'scanner.log'),
  );

  // Knowledge + execution
  const knowledgeDb = new KnowledgeDB(
    resolveFilePath(storageDir, config.context?.kb_path, 'kb.sqlite'),
  );
  const executor = new PolyglotExecutor();
  const builtinServer = new BuiltinServer(executor, knowledgeDb, client);

  // Kairn backend warning
  if (config.context?.backend === 'kairn') {
    process.stderr.write('[satori] warning: context.backend="kairn" is not yet supported — falling back to satori\n');
  }

  // Registry + lifecycle — prepend builtin "bash" server so it's always available
  const registry = new ServerRegistry();
  registry.load({
    ...config,
    servers: [{ name: 'bash', runtime: 'builtin', enabled: true }, ...(config.servers ?? [])],
  });

  const lifecycle = new LifecycleManager();
  lifecycle.registerRuntime('npx', new NpxRuntime());
  lifecycle.registerRuntime('docker', new DockerRuntime());
  lifecycle.registerRuntime('external', new HttpRuntime());

  // Security scan at startup
  const scanner = new SecurityScanner(auditLog);
  for (const serverConfig of registry.list()) {
    const scanResult = scanner.scanConfig(serverConfig);
    if (scanResult.status === 'blocked') {
      lifecycle.setBlocked(serverConfig.name, scanResult.reason ?? 'blocked by startup scan');
    }
  }

  // Catalog + handler registry
  const catalog = new ToolCatalog();
  const handlerRegistry = new HandlerRegistry();

  // Router
  const router = new GatewayRouter({
    registry,
    lifecycle,
    handlerRegistry,
    scanner,
    auditLog,
    contentDb,
    builtinServer,
    client,
    getClient: (name) => lifecycle.getClient(name),
  });

  // Register all 6 tools
  registerSatoriContext(server, sessionDb, contentDb, client, defaultSessionId);
  registerSatoriManage(server, registry, repoRoot);
  registerSatoriFind(server, catalog, lifecycle);
  registerSatoriSchema(server, catalog);
  registerSatoriExec(server, router);
  registerSatoriKb(server, knowledgeDb, client);

  // Connect
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on('SIGINT', async () => {
    await server.close();
    sessionDb.close();
    contentDb.close();
    knowledgeDb.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await server.close();
    sessionDb.close();
    contentDb.close();
    knowledgeDb.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Failed to start satori:', err);
  process.exit(1);
});
