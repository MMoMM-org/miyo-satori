import { spawn, type ChildProcess } from 'child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export interface NpxStartConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  startupTimeoutMs?: number;
}

export class NpxRuntime {
  private client: Client | null = null;
  private process: ChildProcess | null = null;

  async start(config: NpxStartConfig): Promise<void> {
    const { command, args = [], env = {}, startupTimeoutMs = 30000 } = config;

    const mergedEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries({ ...process.env, ...env })) {
      if (v !== undefined) mergedEnv[k] = v;
    }

    const proc = spawn('npx', ['-y', command, ...args], {
      env: mergedEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process = proc;

    const transport = new StdioClientTransport({
      command: 'npx',
      args: ['-y', command, ...args],
      env: mergedEnv,
    });

    const client = new Client({ name: 'satori', version: '0.1.0' }, {});
    await client.connect(transport);

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Startup timed out')), startupTimeoutMs),
    );

    await Promise.race([client.listTools(), timeoutPromise]);

    this.client = client;
  }

  async stop(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }

    if (this.process && this.process.pid) {
      this.process.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.process?.kill('SIGKILL');
          resolve();
        }, 3000);
        this.process!.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      this.process = null;
    }
  }

  getClient(): Client | null {
    return this.client;
  }
}

export function createNpxRuntime(): NpxRuntime {
  return new NpxRuntime();
}
