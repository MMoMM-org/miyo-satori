import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SessionDB } from '../../src/context/session-db.js';
import { ContentDB } from '../../src/context/content-db.js';
import { ServerRegistry } from '../../src/gateway/registry.js';
import { LifecycleManager } from '../../src/lifecycle/manager.js';
import { NpxRuntime } from '../../src/lifecycle/runtimes/npx.js';
import { HandlerRegistry } from '../../src/handlers/registry.js';
import { SecurityScanner } from '../../src/security/scanner.js';
import { AuditLog } from '../../src/security/audit-log.js';
import { GatewayRouter } from '../../src/gateway/router.js';
import { BuiltinServer } from '../../src/execution/builtin-server.js';
import { PolyglotExecutor } from '../../src/execution/executor.js';
import { KnowledgeDB } from '../../src/knowledge/knowledge-db.js';
import { buildResumeSnapshot } from '../../src/context/snapshot.js';

const RUN_E2E = !!process.env.RUN_E2E;

describe.skipIf(!RUN_E2E)('E2E: full satori_exec roundtrip', () => {
  let tmpDir: string;
  let sessionDb: SessionDB;
  let contentDb: ContentDB;
  let registry: ServerRegistry;
  let lifecycle: LifecycleManager;
  let router: GatewayRouter;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'satori-e2e-'));
    const dbPath = join(tmpDir, 'db.sqlite');
    sessionDb = new SessionDB(dbPath);
    contentDb = new ContentDB(dbPath);
    sessionDb.ensureSession('e2e-session', tmpDir);

    registry = new ServerRegistry();
    registry.load({
      servers: [{
        name: 'memory',
        runtime: 'npx',
        command: '@modelcontextprotocol/server-memory',
        enabled: true,
      }],
    });

    lifecycle = new LifecycleManager();
    const npxRuntime = new NpxRuntime();
    lifecycle.registerRuntime('npx', npxRuntime);

    const handlerRegistry = new HandlerRegistry();
    const auditLog = new AuditLog(join(tmpDir, 'scanner.log'));
    const scanner = new SecurityScanner(auditLog);
    const executor = new PolyglotExecutor();
    const knowledgeDb = new KnowledgeDB(join(tmpDir, 'kb.sqlite'));
    const builtinServer = new BuiltinServer(executor, knowledgeDb);

    router = new GatewayRouter({
      registry,
      lifecycle,
      handlerRegistry,
      scanner,
      auditLog,
      contentDb,
      builtinServer,
      getClient: (name) => lifecycle.getClient(name),
    });
  }, 60000);

  afterAll(async () => {
    await lifecycle.stop('memory').catch(() => {});
    sessionDb.close();
    contentDb.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('Step 1: satori_exec starts server and routes call', async () => {
    const result = await router.exec(
      'memory',
      'create_entities',
      { entities: [{ name: 'e2e-test', entityType: 'test', observations: ['hello satori'] }] },
      'e2e-session',
    );
    expect(result.isError).not.toBe(true);
    expect(typeof result.content).toBe('string');
  }, 60000);

  it('Step 2: capture stored in ContentDB', () => {
    const results = contentDb.search('hello satori', 5);
    expect(results.length).toBeGreaterThan(0);
  });

  it('Step 3: session snapshot builds from events', () => {
    sessionDb.insertEvent('e2e-session', 'mcp_call', 'mcp', 4, 'memory:create_entities', 'e2e');
    const events = sessionDb.getEvents('e2e-session');
    const xml = buildResumeSnapshot(events);
    expect(xml).toContain('<session_resume');
    expect(xml.length).toBeLessThanOrEqual(2048);
  });

  it('Step 4: resume stored and retrievable', () => {
    const events = sessionDb.getEvents('e2e-session');
    const xml = buildResumeSnapshot(events);
    sessionDb.upsertResume('e2e-session', xml, 1);
    const resume = sessionDb.getResume('e2e-session');
    expect(resume).not.toBeNull();
    expect(resume!.snapshot).toContain('<session_resume');
  });
});
