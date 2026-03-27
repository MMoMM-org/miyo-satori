import Docker from 'dockerode';

export interface DockerStartConfig {
  image: string;
  args?: string[];
  env?: Record<string, string>;
  port?: number;
}

export class DockerRuntime {
  private docker: Docker;
  private container: Docker.Container | null = null;

  constructor() {
    this.docker = new Docker();
  }

  async isDockerAvailable(): Promise<boolean> {
    try {
      await this.docker.info();
      return true;
    } catch {
      return false;
    }
  }

  async start(config: DockerStartConfig): Promise<void> {
    const available = await this.isDockerAvailable();
    if (!available) {
      throw new Error('Docker is not available: cannot connect to Docker daemon');
    }

    const { image, args = [], env = {} } = config;

    const envArray = Object.entries(env).map(([k, v]) => `${k}=${v}`);

    const container = await this.docker.createContainer({
      Image: image,
      Cmd: args.length > 0 ? args : undefined,
      Env: envArray.length > 0 ? envArray : undefined,
    });

    await container.start();
    this.container = container;

    await this.waitUntilRunning(30000);
  }

  private async waitUntilRunning(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const info = await this.container!.inspect();
      if (info.State.Running) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('Container did not start within timeout');
  }

  async stop(): Promise<void> {
    if (this.container) {
      await this.container.stop();
      this.container = null;
    }
  }
}

export function createDockerRuntime(): DockerRuntime {
  return new DockerRuntime();
}
