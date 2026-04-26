import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const transportInstances: Array<{ url: URL; options?: Record<string, unknown> }> = [];
const clientCloseMock = vi.fn().mockResolvedValue(undefined);
const clientConnectMock = vi.fn().mockResolvedValue(undefined);
const clientListToolsMock = vi.fn().mockResolvedValue({ tools: [{ name: 'kado-read' }] });

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: clientConnectMock,
    listTools: clientListToolsMock,
    close: clientCloseMock,
  })),
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation((url: URL, options?: Record<string, unknown>) => {
    transportInstances.push({ url, options });
    return {};
  }),
}));

import { HttpRuntime } from '../lifecycle/runtimes/http.js';

describe('HttpRuntime', () => {
  beforeEach(() => {
    transportInstances.length = 0;
    clientConnectMock.mockClear();
    clientListToolsMock.mockClear();
    clientCloseMock.mockClear();
  });

  afterEach(() => {
    delete process.env.SATORI_TEST_KADO_KEY;
  });

  it('connects to the server and exposes a client', async () => {
    const runtime = new HttpRuntime();
    await runtime.start({ url: 'http://127.0.0.1:23026/mcp' });
    expect(runtime.getClient()).not.toBeNull();
    expect(transportInstances).toHaveLength(1);
    expect(transportInstances[0].url.toString()).toBe('http://127.0.0.1:23026/mcp');
    expect(clientConnectMock).toHaveBeenCalledOnce();
  });

  it('passes headers through requestInit', async () => {
    const runtime = new HttpRuntime();
    await runtime.start({
      url: 'http://127.0.0.1:23026/mcp',
      headers: { Authorization: 'Bearer literal-key' },
    });
    const requestInit = transportInstances[0].options?.requestInit as RequestInit | undefined;
    expect(requestInit?.headers).toEqual({ Authorization: 'Bearer literal-key' });
  });

  it('expands ${VAR} env references inside header values', async () => {
    process.env.SATORI_TEST_KADO_KEY = 'secret-abc';
    const runtime = new HttpRuntime();
    await runtime.start({
      url: 'http://127.0.0.1:23026/mcp',
      headers: { Authorization: 'Bearer ${SATORI_TEST_KADO_KEY}' },
    });
    const requestInit = transportInstances[0].options?.requestInit as RequestInit | undefined;
    expect(requestInit?.headers).toEqual({ Authorization: 'Bearer secret-abc' });
  });

  it('throws when a referenced env var is missing', async () => {
    const runtime = new HttpRuntime();
    await expect(
      runtime.start({
        url: 'http://127.0.0.1:23026/mcp',
        headers: { Authorization: 'Bearer ${SATORI_TEST_KADO_KEY}' },
      }),
    ).rejects.toThrow(/SATORI_TEST_KADO_KEY/);
  });

  it('rejects when url is missing', async () => {
    const runtime = new HttpRuntime();
    await expect(runtime.start({} as unknown as { url: string })).rejects.toThrow(/url/i);
  });

  it('stop closes the client and clears it', async () => {
    const runtime = new HttpRuntime();
    await runtime.start({ url: 'http://127.0.0.1:23026/mcp' });
    await runtime.stop();
    expect(clientCloseMock).toHaveBeenCalledOnce();
    expect(runtime.getClient()).toBeNull();
  });
});
