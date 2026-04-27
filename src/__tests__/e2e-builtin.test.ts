/**
 * E2E: BuiltinRuntime integration tests
 * Tests full path: GatewayRouter → BuiltinServer → PolyglotExecutor → ContentDB
 * Covers PRD F3 acceptance criteria.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GatewayRouter } from '../gateway/router.js';
import { ServerRegistry } from '../gateway/registry.js';
import { LifecycleManager } from '../lifecycle/manager.js';
import { HandlerRegistry } from '../handlers/registry.js';
import { SecurityScanner } from '../security/scanner.js';
import { AuditLog } from '../security/audit-log.js';
import { ContentDB } from '../context/content-db.js';
import { SessionDB } from '../context/session-db.js';
import { KnowledgeDB } from '../knowledge/knowledge-db.js';
import { PolyglotExecutor } from '../execution/executor.js';
import { BuiltinServer } from '../execution/builtin-server.js';

const C = 'test-client';

describe('E2E: BuiltinRuntime via GatewayRouter', () => {
  let tmpDir: string;
  let router: GatewayRouter;
  let contentDb: ContentDB;
  let knowledgeDb: KnowledgeDB;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'satori-e2e-builtin-'));
    const dbPath = join(tmpDir, 'db.sqlite');
    const sessionDb = new SessionDB(dbPath);
    contentDb = new ContentDB(dbPath);
    sessionDb.ensureSession(C, 'e2e-session', tmpDir);
    sessionDb.close();

    knowledgeDb = new KnowledgeDB(join(tmpDir, 'kb.sqlite'));
    const executor = new PolyglotExecutor();
    const builtinServer = new BuiltinServer(executor, knowledgeDb, C);

    const registry = new ServerRegistry();
    registry.load({
      servers: [{ name: 'bash', runtime: 'builtin', enabled: true }],
    });

    const lifecycle = new LifecycleManager();
    const handlerRegistry = new HandlerRegistry();
    const auditLog = new AuditLog(join(tmpDir, 'scanner.log'));
    const scanner = new SecurityScanner(auditLog);

    router = new GatewayRouter({
      registry,
      lifecycle,
      handlerRegistry,
      scanner,
      auditLog,
      contentDb,
      builtinServer,
      client: C,
      defaultSessionId: 'e2e-session',
      getClient: () => null,
    });
  });

  afterAll(() => {
    contentDb.close();
    knowledgeDb.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('run shell: returns stdout', async () => {
    const result = await router.exec('bash', 'run', { language: 'shell', code: 'echo hello' }, 'e2e-session');
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('hello');
  });

  it('run shell: output captured to ContentDB', async () => {
    await router.exec('bash', 'run', { language: 'shell', code: 'echo captured' }, 'e2e-session');
    // give the async summary a tick to complete
    await new Promise((r) => setImmediate(r));
    const captures = contentDb.search(C, 'captured');
    expect(captures.length).toBeGreaterThan(0);
  });

  it('run: unknown server returns isError', async () => {
    const result = await router.exec('unknown-server', 'run', { language: 'shell', code: 'echo x' });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content) as { error: string };
    expect(parsed.error).toContain('unknown-server');
  });

  it('run: unknown tool returns isError from builtinServer', async () => {
    const result = await router.exec('bash', 'unknown-tool', { language: 'shell', code: 'echo x' });
    expect(result.isError).toBe(true);
  });

  it('run with intent — small output ignores intent, returns full output', async () => {
    // output < 5000 bytes — intent should be ignored, full output returned
    const result = await router.exec('bash', 'run', {
      language: 'shell',
      code: 'echo small',
      intent: 'find something',
    }, 'e2e-session');
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('small');
  });

  it('batch: runs commands and returns indexed results', async () => {
    const result = await router.exec('bash', 'batch', {
      commands: [{ label: 'greet', command: 'echo greetings' }],
      queries: ['greetings'],
    }, 'e2e-session');
    expect(result.isError).toBeFalsy();
    // batch returns JSON with query results
    expect(result.content).toBeDefined();
  });
});
