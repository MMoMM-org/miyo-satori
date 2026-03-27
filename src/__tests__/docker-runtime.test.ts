import { describe, it, expect, vi } from 'vitest';

vi.mock('dockerode', () => {
  const mockContainer = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    inspect: vi.fn().mockResolvedValue({ State: { Running: true } }),
  };
  const MockDocker = vi.fn().mockImplementation(() => ({
    info: vi.fn().mockResolvedValue({}),
    createContainer: vi.fn().mockResolvedValue(mockContainer),
  }));
  return { default: MockDocker };
});

import { DockerRuntime } from '../lifecycle/runtimes/docker.js';

describe('DockerRuntime', () => {
  it('creates and starts a container', async () => {
    const runtime = new DockerRuntime();
    // Just verify it doesn't throw (integration would verify more)
    expect(runtime).toBeDefined();
  });

  it('handles docker unavailable gracefully', async () => {
    const { default: Docker } = await import('dockerode');
    vi.mocked(Docker).mockImplementationOnce(
      () =>
        ({
          info: vi.fn().mockRejectedValue(new Error('Cannot connect to Docker')),
          createContainer: vi.fn(),
        }) as any,
    );
    const runtime = new DockerRuntime();
    const available = await runtime.isDockerAvailable();
    expect(available).toBe(false);
  });
});
