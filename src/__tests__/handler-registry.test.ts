import { describe, it, expect } from 'vitest';
import { PassthroughHandler } from '../handlers/passthrough.js';
import { HandlerRegistry } from '../handlers/registry.js';

describe('PassthroughHandler', () => {
  const handler = new PassthroughHandler();

  it('beforeCall returns request unchanged', async () => {
    const req = { serverName: 'srv', toolName: 'tool', arguments: { key: 'val' } };
    const result = await handler.beforeCall(req);
    expect(result).toBe(req);
  });

  it('afterCall returns response unchanged', async () => {
    const req = { serverName: 'srv', toolName: 'tool', arguments: {} };
    const res = { content: 'result', isError: false };
    const result = await handler.afterCall(req, res);
    expect(result).toBe(res);
  });
});

describe('HandlerRegistry', () => {
  it('lookup returns passthrough for unknown name', () => {
    const registry = new HandlerRegistry();
    const handler = registry.lookup('nonexistent');
    expect(handler.name).toBe('passthrough');
  });

  it('lookup returns registered handler by name', () => {
    const registry = new HandlerRegistry();
    const custom = new PassthroughHandler();
    Object.defineProperty(custom, 'name', { value: 'custom', configurable: true });
    registry.register(custom);
    expect(registry.lookup('custom')).toBe(custom);
  });

  it('PassthroughHandler is always available', () => {
    const registry = new HandlerRegistry();
    expect(registry.lookup('passthrough')).toBeInstanceOf(PassthroughHandler);
  });
});
