import { describe, it, expect, beforeEach } from 'vitest';
import { ToolCatalog } from '../gateway/catalog.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

function makeTool(name: string, description: string): Tool {
  return {
    name,
    description,
    inputSchema: { type: 'object' as const, properties: {} },
  };
}

describe('ToolCatalog', () => {
  let catalog: ToolCatalog;

  beforeEach(() => {
    catalog = new ToolCatalog();
  });

  describe('populate + search', () => {
    it('finds tool by name substring match', () => {
      catalog.populate('fs', [makeTool('read_file', 'Reads a file'), makeTool('write_file', 'Writes a file')]);
      const results = catalog.search('read');
      expect(results).toHaveLength(1);
      expect(results[0].tool.name).toBe('read_file');
      expect(results[0].server).toBe('fs');
    });

    it('finds tool by description substring match', () => {
      catalog.populate('fs', [makeTool('list_dir', 'Lists directory contents'), makeTool('read_file', 'Reads a file')]);
      const results = catalog.search('directory');
      expect(results).toHaveLength(1);
      expect(results[0].tool.name).toBe('list_dir');
    });

    it('is case-insensitive', () => {
      catalog.populate('fs', [makeTool('ReadFile', 'Reads a file')]);
      expect(catalog.search('readfile')).toHaveLength(1);
      expect(catalog.search('READS')).toHaveLength(1);
    });

    it('empty query returns all tools', () => {
      catalog.populate('fs', [makeTool('read_file', 'r'), makeTool('write_file', 'w')]);
      catalog.populate('git', [makeTool('commit', 'c')]);
      const results = catalog.search('');
      expect(results).toHaveLength(3);
    });

    it('server filter limits to one server', () => {
      catalog.populate('fs', [makeTool('read_file', 'read'), makeTool('write_file', 'write')]);
      catalog.populate('git', [makeTool('read_tree', 'read git tree')]);
      const results = catalog.search('read', 'fs');
      expect(results).toHaveLength(1);
      expect(results[0].server).toBe('fs');
    });

    it('unknown server returns empty results', () => {
      catalog.populate('fs', [makeTool('read_file', 'r')]);
      const results = catalog.search('read', 'unknown');
      expect(results).toHaveLength(0);
    });

    it('no match returns empty results', () => {
      catalog.populate('fs', [makeTool('read_file', 'r')]);
      const results = catalog.search('zzznomatch');
      expect(results).toHaveLength(0);
    });
  });

  describe('getSchema', () => {
    it('returns the tool when found', () => {
      const tool = makeTool('read_file', 'Reads a file');
      catalog.populate('fs', [tool]);
      const result = catalog.getSchema('fs', 'read_file');
      expect(result).not.toBeNull();
      expect(result?.name).toBe('read_file');
    });

    it('returns null for unknown server', () => {
      expect(catalog.getSchema('unknown', 'any')).toBeNull();
    });

    it('returns null for unknown tool on known server', () => {
      catalog.populate('fs', [makeTool('read_file', 'r')]);
      expect(catalog.getSchema('fs', 'write_file')).toBeNull();
    });
  });

  describe('serverTools', () => {
    it('returns all tools for a server', () => {
      const tools = [makeTool('a', ''), makeTool('b', '')];
      catalog.populate('srv', tools);
      expect(catalog.serverTools('srv')).toHaveLength(2);
    });

    it('returns empty array for unknown server', () => {
      expect(catalog.serverTools('unknown')).toEqual([]);
    });
  });

  describe('clear', () => {
    it('clear() clears all servers', () => {
      catalog.populate('fs', [makeTool('read_file', 'r')]);
      catalog.populate('git', [makeTool('commit', 'c')]);
      catalog.clear();
      expect(catalog.search('')).toHaveLength(0);
    });

    it('clear("srv") clears just that server', () => {
      catalog.populate('fs', [makeTool('read_file', 'r')]);
      catalog.populate('git', [makeTool('commit', 'c')]);
      catalog.clear('fs');
      expect(catalog.serverTools('fs')).toHaveLength(0);
      expect(catalog.serverTools('git')).toHaveLength(1);
    });
  });
});
