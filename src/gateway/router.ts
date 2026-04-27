import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ServerRegistry } from './registry.js';
import type { LifecycleManager } from '../lifecycle/manager.js';
import type { HandlerRegistry } from '../handlers/registry.js';
import type { SecurityScanner } from '../security/scanner.js';
import type { AuditLog } from '../security/audit-log.js';
import type { ContentDB } from '../context/content-db.js';
import type { BuiltinServer } from '../execution/builtin-server.js';
import { summarize } from '../context/summarizer.js';

export interface RouterDeps {
  registry: ServerRegistry;
  lifecycle: LifecycleManager;
  handlerRegistry: HandlerRegistry;
  scanner: SecurityScanner;
  auditLog: AuditLog;
  contentDb: ContentDB;
  builtinServer: BuiltinServer;
  client: string;
  defaultSessionId: string;
  getClient: (serverName: string) => Client | null;
}

function errorResult(message: string): { content: string; isError: true } {
  return { content: JSON.stringify({ error: message }), isError: true };
}

function extractOutput(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  return JSON.stringify(raw);
}

export class GatewayRouter {
  constructor(private deps: RouterDeps) {}

  async exec(
    server: string,
    tool: string,
    args: Record<string, unknown>,
    sessionId?: string,
  ): Promise<{ content: string; isError?: boolean }> {
    // Step 1: validate args
    if (!server || typeof server !== 'string') {
      return errorResult('server must be a non-empty string');
    }
    if (!tool || typeof tool !== 'string') {
      return errorResult('tool must be a non-empty string');
    }

    // Step 2: registry lookup
    const config = this.deps.registry.lookup(server);
    if (!config) {
      return errorResult(`Server "${server}" not found in registry`);
    }

    // Step 2.5: Builtin server dispatch (bypasses LifecycleManager entirely)
    if (config.runtime === 'builtin') {
      const argsBlocked = this.deps.scanner.scanArgs(server, tool, args);
      if (argsBlocked) {
        return errorResult(`Call blocked by scanner: ${argsBlocked.reason}`);
      }
      const builtinResult = await this.deps.builtinServer.exec(server, tool, args);
      const outputStr = extractOutput(builtinResult.content);
      const captureId = this.deps.contentDb.insertCapture(
        this.deps.client,
        sessionId ?? this.deps.defaultSessionId,
        server,
        tool,
        JSON.stringify(args),
        outputStr,
      );
      const summary = summarize(server, tool, outputStr);
      void Promise.resolve().then(() => {
        this.deps.contentDb.updateSummary(captureId, summary);
      });
      return { content: summary, ...(builtinResult.isError ? { isError: true as const } : {}) };
    }

    // Step 3: check state, start if stopped
    const state = this.deps.lifecycle.getState(server);
    if (state === 'blocked') {
      const entry = this.deps.lifecycle.getEntry(server);
      return errorResult(`Server "${server}" is blocked: ${entry.lastError ?? 'reason unknown'}`);
    }
    if (state === 'error') {
      const entry = this.deps.lifecycle.getEntry(server);
      return errorResult(`Server "${server}" is in error state: ${entry.lastError ?? 'unknown error'}`);
    }
    if (state === 'stopped') {
      const startResult = await this.deps.lifecycle.start(server, config.runtime, config);
      if (!startResult.success) {
        return errorResult(`Failed to start server "${server}": ${startResult.error ?? 'unknown error'}`);
      }
    }

    // Step 4: get handler
    const handler = this.deps.handlerRegistry.lookup(config.handler ?? 'passthrough');

    // Step 5: handler.beforeCall
    const request = { serverName: server, toolName: tool, arguments: args };
    const beforeResult = await handler.beforeCall(request);
    if ('blocked' in beforeResult && beforeResult.blocked) {
      this.deps.auditLog.append({
        event: 'BLOCKED',
        server,
        tool,
        status: 'blocked',
        reason: beforeResult.reason,
        via: 'satori_exec',
      });
      return errorResult(`Call blocked by handler: ${beforeResult.reason}`);
    }

    const resolvedRequest = beforeResult as typeof request;

    // Step 6: scanner.scanOut
    const scanResult = this.deps.scanner.scanOut(server, tool, resolvedRequest.arguments);
    if (scanResult) {
      // auditLog already written by scanner
      return errorResult(`Call blocked by scanner: ${scanResult.reason}`);
    }

    // Step 7: get client
    const client = this.deps.getClient(server);
    if (!client) {
      return errorResult(`Server "${server}" is not connected`);
    }

    // Step 8: call the tool
    const rawResponse = await client.callTool({
      name: resolvedRequest.toolName,
      arguments: resolvedRequest.arguments,
    });

    // Step 9: handler.afterCall
    const isError = typeof rawResponse.isError === 'boolean' ? rawResponse.isError : undefined;
    const toolResponse = { content: rawResponse.content, isError };
    const afterResponse = await handler.afterCall(resolvedRequest, toolResponse);

    // Step 10: insert capture
    const outputStr = extractOutput(afterResponse.content);
    const captureId = this.deps.contentDb.insertCapture(
      this.deps.client,
      sessionId ?? '',
      server,
      tool,
      JSON.stringify(resolvedRequest.arguments),
      outputStr,
    );

    // Step 11: update summary (non-blocking)
    const summary = summarize(server, tool, outputStr);
    void Promise.resolve().then(() => {
      this.deps.contentDb.updateSummary(captureId, summary);
    });

    return { content: summary };
  }
}
