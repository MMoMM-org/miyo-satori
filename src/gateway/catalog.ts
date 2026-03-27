import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export interface CatalogEntry {
  server: string;
  tool: Tool;
}

export class ToolCatalog {
  private catalog = new Map<string, Tool[]>();

  populate(server: string, tools: Tool[]): void {
    this.catalog.set(server, [...tools]);
  }

  search(query: string, server?: string): CatalogEntry[] {
    const lowerQuery = query.toLowerCase();
    const results: CatalogEntry[] = [];

    for (const [serverName, tools] of this.catalog) {
      if (server !== undefined && serverName !== server) continue;
      for (const tool of tools) {
        if (query === '') {
          results.push({ server: serverName, tool });
          continue;
        }
        const nameMatch = tool.name.toLowerCase().includes(lowerQuery);
        const descMatch = (tool.description ?? '').toLowerCase().includes(lowerQuery);
        if (nameMatch || descMatch) {
          results.push({ server: serverName, tool });
        }
      }
    }

    return results;
  }

  getSchema(server: string, tool: string): Tool | null {
    const tools = this.catalog.get(server);
    if (!tools) return null;
    return tools.find(t => t.name === tool) ?? null;
  }

  serverTools(server: string): Tool[] {
    return this.catalog.get(server) ?? [];
  }

  clear(server?: string): void {
    if (server !== undefined) {
      this.catalog.delete(server);
    } else {
      this.catalog.clear();
    }
  }
}
