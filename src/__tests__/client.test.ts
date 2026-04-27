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
    expect(() => resolveClient({}, {}, '/')).toThrow(/blank|invalid/);
  });

  it('handles trailing slash via Node basename normalisation', () => {
    expect(resolveClient({}, {}, '/work/Satori/')).toBe('Satori');
  });

  // -- edge cases (R10 + R14) --

  it('throws on empty CLI override (does not silently fall through)', () => {
    expect(() => resolveClient({ client: '' }, {}, '/work/Satori')).toThrow(/CLI flag/);
  });

  it('throws on whitespace-only CLI override', () => {
    expect(() => resolveClient({ client: '   ' }, {}, '/work/Satori')).toThrow(/CLI flag.*blank/);
  });

  it('trims whitespace around valid CLI override', () => {
    expect(resolveClient({ client: '  work  ' }, {}, '/work/Satori')).toBe('work');
  });

  it('throws on CLI override with shell metacharacters', () => {
    expect(() => resolveClient({ client: "'; DROP TABLE chunks; --" }, {}, '/'))
      .toThrow(/invalid/);
  });

  it('throws on CLI override containing slash (path-like)', () => {
    expect(() => resolveClient({ client: '../etc/passwd' }, {}, '/'))
      .toThrow(/invalid/);
  });

  it('throws on CLI override longer than 64 chars', () => {
    expect(() => resolveClient({ client: 'a'.repeat(65) }, {}, '/')).toThrow(/invalid/);
  });

  it('accepts CLI override at exactly 64 chars', () => {
    const sixtyFour = 'a'.repeat(64);
    expect(resolveClient({ client: sixtyFour }, {}, '/')).toBe(sixtyFour);
  });

  it('throws on toml [context] client with invalid chars', () => {
    const cfg: SatoriConfig = { context: { client: 'has spaces' } };
    expect(() => resolveClient({}, cfg, '/work/Satori')).toThrow(/satori\.toml.*invalid/);
  });

  it('throws on basename with non-ASCII characters', () => {
    expect(() => resolveClient({}, {}, '/work/プロジェクト')).toThrow(/basename.*invalid/);
  });

  it('throws on basename with spaces', () => {
    expect(() => resolveClient({}, {}, '/work/My Project')).toThrow(/basename.*invalid/);
  });

  it('accepts hyphenated client names like claude-code', () => {
    expect(resolveClient({ client: 'claude-code' }, {}, '/')).toBe('claude-code');
  });

  it('accepts underscored client names', () => {
    expect(resolveClient({ client: 'my_client_42' }, {}, '/')).toBe('my_client_42');
  });
});
