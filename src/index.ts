import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { join } from 'path';
import { loadConfig } from './config/loader.js';
import { autoRegisterMcpJson } from './config/auto-register.js';
import { ServerRegistry } from './gateway/registry.js';
import { ToolCatalog } from './gateway/catalog.js';
import { GatewayRouter } from './gateway/router.js';
import { LifecycleManager } from './lifecycle/manager.js';
import { NpxRuntime } from './lifecycle/runtimes/npx.js';
import { DockerRuntime } from './lifecycle/runtimes/docker.js';
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

const server = new McpServer({ name: 'satori', version: '0.1.0' });

async function main() {
  const repoRoot = process.cwd();

  // Config
  const config = loadConfig(repoRoot);
  if (config.gateway?.auto_register_mcp_json) {
    await autoRegisterMcpJson(repoRoot, config);
  }

  // Infrastructure
  const dbPath = config.context?.db_path
    ? join(repoRoot, config.context.db_path)
    : SessionDB.defaultDBPath(repoRoot);
  const sessionDb = new SessionDB(dbPath);
  const contentDb = new ContentDB(dbPath);
  const auditLog = new AuditLog(
    config.security?.audit_log
      ? join(repoRoot, config.security.audit_log)
      : join(repoRoot, '.satori', 'scanner.log'),
  );

  // Registry + lifecycle
  const registry = new ServerRegistry();
  registry.load(config);

  const lifecycle = new LifecycleManager();
  lifecycle.registerRuntime('npx', new NpxRuntime());
  lifecycle.registerRuntime('docker', new DockerRuntime());

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
    getClient: (name) => lifecycle.getClient(name),
  });

  // Register all 5 tools
  registerSatoriContext(server, sessionDb, contentDb);
  registerSatoriManage(server, registry, repoRoot);
  registerSatoriFind(server, catalog, lifecycle);
  registerSatoriSchema(server, catalog);
  registerSatoriExec(server, router);

  // Connect
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on('SIGINT', async () => {
    await server.close();
    sessionDb.close();
    contentDb.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await server.close();
    sessionDb.close();
    contentDb.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Failed to start satori:', err);
  process.exit(1);
});
