import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerSatoriExec } from '../tools/satori-exec.js';
import type { GatewayRouter } from '../gateway/router.js';

type McpRegisteredTools = Record<string, { handler: (args: Record<string, unknown>) => Promise<unknown> }>;

async function callTool(
  mcpServer: McpServer,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const registeredTools = (mcpServer as unknown as { _registeredTools: McpRegisteredTools })._registeredTools;
  const tool = registeredTools[toolName];
  if (!tool) throw new Error(`Tool ${toolName} not found`);
  return tool.handler(args) as Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
}

describe('satori_exec', () => {
  let mcpServer: McpServer;
  let mockRouter: GatewayRouter;

  beforeEach(() => {
    mcpServer = new McpServer({ name: 'test', version: '0.1.0' });
    mockRouter = {
      exec: vi.fn().mockResolvedValue({ content: JSON.stringify({ result: 'success' }) }),
    } as unknown as GatewayRouter;
    registerSatoriExec(mcpServer, mockRouter);
  });

  it('missing server returns isError: true', async () => {
    const result = await callTool(mcpServer, 'satori_exec', { server: '', tool: 'read_file', args: {} });
    expect(result.isError).toBe(true);
    expect(mockRouter.exec).not.toHaveBeenCalled();
  });

  it('missing tool returns isError: true', async () => {
    const result = await callTool(mcpServer, 'satori_exec', { server: 'filesystem', tool: '', args: {} });
    expect(result.isError).toBe(true);
    expect(mockRouter.exec).not.toHaveBeenCalled();
  });

  it('valid call invokes router.exec with correct args', async () => {
    const toolArgs = { path: '/tmp/test.txt' };
    await callTool(mcpServer, 'satori_exec', {
      server: 'filesystem',
      tool: 'read_file',
      args: toolArgs,
      session_id: 'sess-1',
    });
    expect(mockRouter.exec).toHaveBeenCalledWith('filesystem', 'read_file', toolArgs, 'sess-1');
  });

  it('returns router content as text', async () => {
    const result = await callTool(mcpServer, 'satori_exec', {
      server: 'filesystem',
      tool: 'read_file',
      args: {},
    });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toBe(JSON.stringify({ result: 'success' }));
  });

  it('router returning error JSON is returned as content (not isError)', async () => {
    (mockRouter.exec as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: JSON.stringify({ error: 'server not found' }),
      isError: true,
    });
    const result = await callTool(mcpServer, 'satori_exec', {
      server: 'unknown',
      tool: 'read_file',
      args: {},
    });
    // The content is the error JSON from the router
    expect(result.content[0].text).toContain('error');
  });
});
