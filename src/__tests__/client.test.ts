import { describe, it, expect } from 'vitest';
import { resolveClient } from '../config/client.js';
import type { SatoriConfig } from '../config/schema.js';

describe('resolveClient', () => {
  it('auto-derives client from basename(repoRoot) when nothing is set', () => {
    expect(resolveClient({}, {}, '/Volumes/Moon/Coding/MiYo/Satori')).toBe('Satori');
  });

  it('preserves basename casing', () => {
    expect(resolveClient({}, {}, '/work/Tomo')).toBe('Tomo');
    expect(resolveClient({}, {}, '/work/kado')).toBe('kado');
  });

  it('toml [context] client beats auto-derive', () => {
    const cfg: SatoriConfig = { context: { client: 'personal' } };
    expect(resolveClient({}, cfg, '/work/Satori')).toBe('personal');
  });

  it('CLI override beats toml setting', () => {
    const cfg: SatoriConfig = { context: { client: 'from-toml' } };
    expect(resolveClient({ client: 'from-cli' }, cfg, '/work/Satori')).toBe('from-cli');
  });

  it('CLI override beats auto-derive', () => {
    expect(resolveClient({ client: 'work' }, {}, '/work/Satori')).toBe('work');
  });

  it('throws when repoRoot has no basename and no override is given', () => {
    expect(() => resolveClient({}, {}, '/')).toThrow(/auto-derive/);
  });

  it('handles trailing slash via Node basename normalisation', () => {
    expect(resolveClient({}, {}, '/work/Satori/')).toBe('Satori');
  });
});
