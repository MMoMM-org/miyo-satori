import { describe, it, expect, beforeEach } from 'vitest';
import { ServerRegistry } from '../gateway/registry.js';
import type { SatoriConfig } from '../config/schema.js';

const sampleConfig: SatoriConfig = {
  servers: [
    { name: 'alpha', runtime: 'npx', command: '@server/alpha', enabled: true },
    { name: 'beta', runtime: 'docker', image: 'beta:latest', enabled: true },
    { name: 'gamma', runtime: 'external', host: 'localhost', port: 9000, enabled: false },
  ],
};

describe('ServerRegistry', () => {
  let registry: ServerRegistry;

  beforeEach(() => {
    registry = new ServerRegistry();
    registry.load(sampleConfig);
  });

  it('lookup returns correct config for each registered server', () => {
    const alpha = registry.lookup('alpha');
    expect(alpha).not.toBeNull();
    expect(alpha!.runtime).toBe('npx');
    expect(alpha!.command).toBe('@server/alpha');

    const beta = registry.lookup('beta');
    expect(beta).not.toBeNull();
    expect(beta!.runtime).toBe('docker');

    const gamma = registry.lookup('gamma');
    expect(gamma).not.toBeNull();
    expect(gamma!.port).toBe(9000);
  });

  it('lookup returns null for unknown server', () => {
    expect(registry.lookup('unknown')).toBeNull();
    expect(registry.lookup('')).toBeNull();
  });

  it('list returns all 3 entries', () => {
    const list = registry.list();
    expect(list).toHaveLength(3);
    const names = list.map(s => s.name);
    expect(names).toContain('alpha');
    expect(names).toContain('beta');
    expect(names).toContain('gamma');
  });

  it('setEnabled toggles enabled flag in registry', () => {
    registry.setEnabled('gamma', true);
    expect(registry.lookup('gamma')!.enabled).toBe(true);

    registry.setEnabled('alpha', false);
    expect(registry.lookup('alpha')!.enabled).toBe(false);
  });

  it('load with duplicate names: last wins', () => {
    const dupConfig: SatoriConfig = {
      servers: [
        { name: 'dup', runtime: 'npx', command: 'first' },
        { name: 'dup', runtime: 'docker', image: 'second' },
      ],
    };
    const reg = new ServerRegistry();
    reg.load(dupConfig);
    const result = reg.lookup('dup');
    expect(result).not.toBeNull();
    expect(result!.image).toBe('second');
    expect(reg.list()).toHaveLength(1);
  });

  it('load clears previous state', () => {
    registry.load({ servers: [{ name: 'new', runtime: 'external', host: 'h', port: 1 }] });
    expect(registry.list()).toHaveLength(1);
    expect(registry.lookup('alpha')).toBeNull();
  });
});
