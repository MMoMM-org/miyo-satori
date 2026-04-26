import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expandEnv } from '../../config/loader.js';

export interface HttpStartConfig {
  url: string;
  headers?: Record<string, string>;
  startupTimeoutMs?: number;
}

function expandHeaders(headers: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!headers) return undefined;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  const expanded: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    expanded[k] = expandEnv(v, env);
  }
  return expanded;
}

export class HttpRuntime {
  private client: Client | null = null;

  async start(config: HttpStartConfig): Promise<void> {
    const { url, headers, startupTimeoutMs = 30000 } = config;

    if (!url) {
      throw new Error('HttpRuntime requires a url');
    }

    const expandedHeaders = expandHeaders(headers);
    const requestInit: RequestInit | undefined = expandedHeaders ? { headers: expandedHeaders } : undefined;

    const transport = new StreamableHTTPClientTransport(
      new URL(url),
      requestInit ? { requestInit } : undefined,
    );

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
  }

  getClient(): Client | null {
    return this.client;
  }
}

export function createHttpRuntime(): HttpRuntime {
  return new HttpRuntime();
}
