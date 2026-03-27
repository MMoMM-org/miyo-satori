import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';

// Mock child_process.spawn
vi.mock('child_process', () => ({
  spawn: vi.fn(() => {
    const proc = new EventEmitter() as any;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = { write: vi.fn(), end: vi.fn() };
    proc.kill = vi.fn();
    proc.pid = 12345;
    return proc;
  }),
}));

// Mock MCP SDK Client
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue({ tools: [{ name: 'test' }] }),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation(() => ({})),
}));

import { NpxRuntime } from '../lifecycle/runtimes/npx.js';

describe('NpxRuntime', () => {
  it('starts and connects to a server', async () => {
    const runtime = new NpxRuntime();
    await runtime.start({ command: '@test/server', args: [], env: {} });
    expect(runtime.getClient()).not.toBeNull();
  });

  it('stop calls process kill', async () => {
    const runtime = new NpxRuntime();
    await runtime.start({ command: '@test/server' });
    await runtime.stop();
    // Client close should have been called
    expect(runtime.getClient()).toBeNull();
  });
});
