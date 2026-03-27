import { describe, it, expect, vi } from 'vitest';
import { LifecycleManager } from '../lifecycle/manager.js';

describe('LifecycleManager', () => {
  it('returns stopped for unknown server', () => {
    const mgr = new LifecycleManager();
    expect(mgr.getState('unknown')).toBe('stopped');
  });

  it('transitions stopped → starting → running', async () => {
    const mgr = new LifecycleManager();
    const mockRuntime = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    mgr.registerRuntime('npx', mockRuntime);
    const result = await mgr.start('my-server', 'npx', { command: 'test' });
    expect(result.success).toBe(true);
    expect(mgr.getState('my-server')).toBe('running');
  });

  it('start on running server is a no-op', async () => {
    const mgr = new LifecycleManager();
    const mockRuntime = { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn() };
    mgr.registerRuntime('npx', mockRuntime);
    await mgr.start('srv', 'npx', {});
    await mgr.start('srv', 'npx', {}); // second call
    expect(mockRuntime.start).toHaveBeenCalledTimes(1); // only spawned once
  });

  it('start on blocked server returns error immediately', async () => {
    const mgr = new LifecycleManager();
    mgr.setBlocked('srv', 'security scan failed');
    const result = await mgr.start('srv', 'npx', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('blocked');
  });

  it('stop transitions running → stopped', async () => {
    const mgr = new LifecycleManager();
    const mockRuntime = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    mgr.registerRuntime('npx', mockRuntime);
    await mgr.start('srv', 'npx', {});
    await mgr.stop('srv');
    expect(mgr.getState('srv')).toBe('stopped');
  });

  it('runtime error transitions to error state', async () => {
    const mgr = new LifecycleManager();
    const mockRuntime = {
      start: vi.fn().mockRejectedValue(new Error('spawn failed')),
      stop: vi.fn(),
    };
    mgr.registerRuntime('npx', mockRuntime);
    const result = await mgr.start('srv', 'npx', {});
    expect(result.success).toBe(false);
    expect(mgr.getState('srv')).toBe('error');
  });
});
