/**
 * E2E: Two-client isolation through GatewayRouter on shared storage.
 *
 * Asserts the property the (client, session_id) identity model exists for:
 * captures and search results never bleed across clients even when both
 * routers write into the same SQLite file.
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

function buildRouter(client: string, sharedDbPath: string, sharedKbPath: string, scratchDir: string): {
  router: GatewayRouter;
  contentDb: ContentDB;
  knowledgeDb: KnowledgeDB;
} {
  const sessionDb = new SessionDB(sharedDbPath);
  const contentDb = new ContentDB(sharedDbPath);
  sessionDb.ensureSession(client, `${client}-session`, scratchDir);
  sessionDb.close();

  const knowledgeDb = new KnowledgeDB(sharedKbPath);
  const executor = new PolyglotExecutor();
  const builtinServer = new BuiltinServer(executor, knowledgeDb, client);

  const registry = new ServerRegistry();
  registry.load({
    servers: [{ name: 'bash', runtime: 'builtin', enabled: true }],
  });

  const lifecycle = new LifecycleManager();
  const handlerRegistry = new HandlerRegistry();
  const auditLog = new AuditLog(join(scratchDir, `${client}-scanner.log`));
  const scanner = new SecurityScanner(auditLog);

  const router = new GatewayRouter({
    registry,
    lifecycle,
    handlerRegistry,
    scanner,
    auditLog,
    contentDb,
    builtinServer,
    client,
    defaultSessionId: `${client}-session`,
    getClient: () => null,
  });

  return { router, contentDb, knowledgeDb };
}

describe('E2E: two clients sharing one DB are isolated', () => {
  let tmpDir: string;
  let dbPath: string;
  let kbPath: string;
  let alpha: ReturnType<typeof buildRouter>;
  let beta: ReturnType<typeof buildRouter>;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'satori-e2e-multi-'));
    dbPath = join(tmpDir, 'db.sqlite');
    kbPath = join(tmpDir, 'kb.sqlite');
    alpha = buildRouter('alpha', dbPath, kbPath, tmpDir);
    beta = buildRouter('beta', dbPath, kbPath, tmpDir);
  });

  afterAll(() => {
    alpha.contentDb.close();
    beta.contentDb.close();
    alpha.knowledgeDb.close();
    beta.knowledgeDb.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('captures from alpha do not appear in beta search results', async () => {
    await alpha.router.exec(
      'bash',
      'run',
      { language: 'shell', code: 'echo alpha-only-marker' },
      'alpha-session',
    );
    await new Promise((r) => setImmediate(r));

    const alphaHits = alpha.contentDb.search('alpha', 'alpha-only-marker');
    const betaHits = beta.contentDb.search('beta', 'alpha-only-marker');
    expect(alphaHits.length).toBeGreaterThan(0);
    expect(betaHits).toHaveLength(0);
  });

  it('captures from beta do not appear in alpha getBySession', async () => {
    await beta.router.exec(
      'bash',
      'run',
      { language: 'shell', code: 'echo beta-only-marker' },
      'beta-session',
    );
    await new Promise((r) => setImmediate(r));

    const betaCaptures = beta.contentDb.getBySession('beta', 'beta-session');
    expect(betaCaptures.some((c) => c.output_text.includes('beta-only-marker'))).toBe(true);

    const alphaCaptures = alpha.contentDb.getBySession('alpha', 'alpha-session');
    expect(alphaCaptures.some((c) => c.output_text.includes('beta-only-marker'))).toBe(false);
  });

  it('KB indexed by alpha is not searchable by beta', () => {
    alpha.knowledgeDb.index({
      client: 'alpha',
      content: '# Alpha\nalpha-secret-knowledge content',
      title: 'alpha-doc',
    });

    const alphaSearch = alpha.knowledgeDb.search({ client: 'alpha', query: 'alpha-secret-knowledge' });
    const betaSearch = beta.knowledgeDb.search({ client: 'beta', query: 'alpha-secret-knowledge' });

    expect(Array.isArray(alphaSearch)).toBe(true);
    expect((alphaSearch as unknown[]).length).toBeGreaterThan(0);
    expect(Array.isArray(betaSearch)).toBe(true);
    expect((betaSearch as unknown[]).length).toBe(0);
  });
});
