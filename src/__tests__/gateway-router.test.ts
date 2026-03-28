import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GatewayRouter } from '../gateway/router.js';
import type { RouterDeps } from '../gateway/router.js';
import type { ServerRegistry } from '../gateway/registry.js';
import type { LifecycleManager } from '../lifecycle/manager.js';
import type { HandlerRegistry } from '../handlers/registry.js';
import type { SecurityScanner } from '../security/scanner.js';
import type { AuditLog } from '../security/audit-log.js';
import type { ContentDB } from '../context/content-db.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ServerConfig } from '../config/schema.js';
import type { BuiltinServer } from '../execution/builtin-server.js';

function makeServerConfig(overrides?: Partial<ServerConfig>): ServerConfig {
  return {
    name: 'filesystem',
    runtime: 'npx',
    handler: 'passthrough',
    ...overrides,
  };
}

function makeDeps(overrides?: Partial<RouterDeps>): RouterDeps {
  const mockClient = {
    callTool: vi.fn().mockResolvedValue({ content: 'tool output', isError: false }),
  } as unknown as Client;

  const mockHandler = {
    name: 'passthrough',
    onRegister: vi.fn(),
    beforeCall: vi.fn().mockImplementation(async (req) => req),
    afterCall: vi.fn().mockImplementation(async (_req, res) => res),
  };

  const mockHandlerRegistry = {
    lookup: vi.fn().mockReturnValue(mockHandler),
  } as unknown as HandlerRegistry;

  const mockRegistry = {
    lookup: vi.fn().mockReturnValue(makeServerConfig()),
    list: vi.fn().mockReturnValue([]),
  } as unknown as ServerRegistry;

  const mockLifecycle = {
    getState: vi.fn().mockReturnValue('running'),
    getEntry: vi.fn().mockReturnValue({ state: 'running' }),
    start: vi.fn().mockResolvedValue({ success: true }),
  } as unknown as LifecycleManager;

  const mockScanner = {
    scanOut: vi.fn().mockReturnValue(null),
    scanArgs: vi.fn().mockReturnValue(null),
  } as unknown as SecurityScanner;

  const mockBuiltinServer = {
    exec: vi.fn().mockResolvedValue({ content: 'builtin output' }),
  } as unknown as BuiltinServer;

  const mockAuditLog = {
    append: vi.fn(),
  } as unknown as AuditLog;

  const mockContentDb = {
    insertCapture: vi.fn().mockReturnValue(1),
    updateSummary: vi.fn(),
  } as unknown as ContentDB;

  return {
    registry: mockRegistry,
    lifecycle: mockLifecycle,
    handlerRegistry: mockHandlerRegistry,
    scanner: mockScanner,
    auditLog: mockAuditLog,
    contentDb: mockContentDb,
    builtinServer: mockBuiltinServer,
    getClient: vi.fn().mockReturnValue(mockClient),
    ...overrides,
  } as RouterDeps;
}

describe('GatewayRouter', () => {
  describe('happy path', () => {
    it('calls all deps in order and returns string content', async () => {
      const deps = makeDeps();
      const router = new GatewayRouter(deps);

      const result = await router.exec('filesystem', 'read_file', { path: '/tmp/test.txt' }, 'session-1');

      expect(result.isError).toBeFalsy();
      expect(typeof result.content).toBe('string');
      expect(deps.registry.lookup).toHaveBeenCalledWith('filesystem');
      expect(deps.lifecycle.getState).toHaveBeenCalledWith('filesystem');
      expect(deps.handlerRegistry.lookup).toHaveBeenCalledWith('passthrough');
      expect(deps.scanner.scanOut).toHaveBeenCalledWith('filesystem', 'read_file', { path: '/tmp/test.txt' });
      expect(deps.getClient).toHaveBeenCalledWith('filesystem');
      expect(deps.contentDb.insertCapture).toHaveBeenCalled();
    });
  });

  describe('unknown server', () => {
    it('returns error JSON when registry.lookup returns null', async () => {
      const deps = makeDeps({
        registry: { lookup: vi.fn().mockReturnValue(null), list: vi.fn() } as unknown as ServerRegistry,
      });
      const router = new GatewayRouter(deps);

      const result = await router.exec('unknown', 'tool', {});

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content);
      expect(parsed.error).toContain('unknown');
      expect(deps.handlerRegistry.lookup).not.toHaveBeenCalled();
      expect(deps.getClient).not.toHaveBeenCalled();
    });
  });

  describe('handler blocks', () => {
    it('returns error, writes audit, does not call downstream', async () => {
      const blockedHandler = {
        name: 'blocking',
        onRegister: vi.fn(),
        beforeCall: vi.fn().mockResolvedValue({ blocked: true, reason: 'forbidden tool' }),
        afterCall: vi.fn(),
      };
      const deps = makeDeps({
        handlerRegistry: { lookup: vi.fn().mockReturnValue(blockedHandler) } as unknown as HandlerRegistry,
      });
      const router = new GatewayRouter(deps);

      const result = await router.exec('filesystem', 'bad_tool', {});

      expect(result.isError).toBe(true);
      expect(deps.auditLog.append).toHaveBeenCalled();
      expect(deps.getClient).not.toHaveBeenCalled();
    });
  });

  describe('scanner blocks', () => {
    it('returns error, does not call downstream', async () => {
      const deps = makeDeps({
        scanner: {
          scanOut: vi.fn().mockReturnValue({ blocked: true, reason: 'secret detected' }),
        } as unknown as SecurityScanner,
      });
      const router = new GatewayRouter(deps);

      const result = await router.exec('filesystem', 'write_file', { content: 'TOKEN=abc123' });

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content);
      expect(parsed.error).toBeDefined();
      expect(deps.getClient).not.toHaveBeenCalled();
    });
  });

  describe('start failure', () => {
    it('returns error when lifecycle.start returns success:false', async () => {
      const deps = makeDeps({
        lifecycle: {
          getState: vi.fn().mockReturnValue('stopped'),
          getEntry: vi.fn().mockReturnValue({ state: 'stopped' }),
          start: vi.fn().mockResolvedValue({ success: false, error: 'spawn failed' }),
        } as unknown as LifecycleManager,
      });
      const router = new GatewayRouter(deps);

      const result = await router.exec('filesystem', 'read_file', {});

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content);
      expect(parsed.error).toContain('spawn failed');
      expect(deps.getClient).not.toHaveBeenCalled();
    });
  });

  describe('server not connected', () => {
    it('returns error when getClient returns null', async () => {
      const deps = makeDeps({
        getClient: vi.fn().mockReturnValue(null),
      });
      const router = new GatewayRouter(deps);

      const result = await router.exec('filesystem', 'read_file', {});

      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content);
      expect(parsed.error).toContain('not connected');
    });
  });

  describe('builtin server routing', () => {
    it('routes to builtinServer bypassing lifecycle', async () => {
      const deps = makeDeps({
        registry: {
          lookup: vi.fn().mockReturnValue(makeServerConfig({ runtime: 'builtin' })),
          list: vi.fn().mockReturnValue([]),
        } as unknown as ServerRegistry,
      });
      const router = new GatewayRouter(deps);

      const result = await router.exec('bash', 'run', { language: 'shell', code: 'echo 1' }, 'sess-1');

      expect(result.isError).toBeFalsy();
      expect(deps.builtinServer.exec).toHaveBeenCalledWith('bash', 'run', { language: 'shell', code: 'echo 1' });
      expect(deps.lifecycle.getState).not.toHaveBeenCalled();
      expect(deps.getClient).not.toHaveBeenCalled();
      expect(deps.contentDb.insertCapture).toHaveBeenCalled();
    });

    it('calls scanArgs before dispatch and blocks on secret', async () => {
      const deps = makeDeps({
        registry: {
          lookup: vi.fn().mockReturnValue(makeServerConfig({ runtime: 'builtin' })),
          list: vi.fn().mockReturnValue([]),
        } as unknown as ServerRegistry,
        scanner: {
          scanArgs: vi.fn().mockReturnValue({ blocked: true, reason: 'secret detected' }),
          scanOut: vi.fn().mockReturnValue(null),
        } as unknown as SecurityScanner,
      });
      const router = new GatewayRouter(deps);

      const result = await router.exec('bash', 'run', { code: 'TOKEN=secret' });

      expect(result.isError).toBe(true);
      expect(deps.builtinServer.exec).not.toHaveBeenCalled();
    });
  });

  describe('blocked server state', () => {
    it('returns error immediately for blocked server', async () => {
      const deps = makeDeps({
        lifecycle: {
          getState: vi.fn().mockReturnValue('blocked'),
          getEntry: vi.fn().mockReturnValue({ state: 'blocked', lastError: 'security scan failed' }),
          start: vi.fn(),
        } as unknown as LifecycleManager,
      });
      const router = new GatewayRouter(deps);

      const result = await router.exec('filesystem', 'read_file', {});

      expect(result.isError).toBe(true);
      expect(deps.lifecycle.start).not.toHaveBeenCalled();
    });
  });
});
