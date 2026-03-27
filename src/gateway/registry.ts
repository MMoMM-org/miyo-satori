import type { SatoriConfig, ServerConfig } from '../config/schema.js';

export class ServerRegistry {
  private servers: Map<string, ServerConfig> = new Map();

  load(config: SatoriConfig): void {
    this.servers.clear();
    for (const server of config.servers ?? []) {
      this.servers.set(server.name, { ...server });
    }
  }

  lookup(name: string): ServerConfig | null {
    return this.servers.get(name) ?? null;
  }

  list(): ServerConfig[] {
    return Array.from(this.servers.values());
  }

  setEnabled(name: string, enabled: boolean): void {
    const server = this.servers.get(name);
    if (server) {
      server.enabled = enabled;
    }
  }
}
