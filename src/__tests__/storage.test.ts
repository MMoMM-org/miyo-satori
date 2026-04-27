import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { homedir } from 'os';
import { resolveStorageDir, resolveFilePath } from '../config/storage.js';
import type { SatoriConfig } from '../config/schema.js';

const REPO = '/work/myrepo';

describe('resolveStorageDir', () => {
  it('defaults to <repoRoot>/satori when nothing is set', () => {
    expect(resolveStorageDir({}, {}, REPO)).toBe('/work/myrepo/satori');
  });

  it('honours storage_dir = "repo" (explicit default)', () => {
    const cfg: SatoriConfig = { context: { storage_dir: 'repo' } };
    expect(resolveStorageDir({}, cfg, REPO)).toBe('/work/myrepo/satori');
  });

  it('resolves storage_dir = "project" using project_dir', () => {
    const cfg: SatoriConfig = {
      project_dir: '/work/MiYo',
      context: { storage_dir: 'project' },
    };
    expect(resolveStorageDir({}, cfg, REPO)).toBe('/work/MiYo/satori');
  });

  it('expands ~ in project_dir for the project form', () => {
    const cfg: SatoriConfig = {
      project_dir: '~/Coding/MiYo',
      context: { storage_dir: 'project' },
    };
    expect(resolveStorageDir({}, cfg, REPO)).toBe(join(homedir(), 'Coding/MiYo/satori'));
  });

  it('throws if storage_dir = "project" but project_dir is missing', () => {
    const cfg: SatoriConfig = { context: { storage_dir: 'project' } };
    expect(() => resolveStorageDir({}, cfg, REPO)).toThrow(/project_dir/);
  });

  it('resolves storage_dir = "global" to ~/.satori/data', () => {
    const cfg: SatoriConfig = { context: { storage_dir: 'global' } };
    expect(resolveStorageDir({}, cfg, REPO)).toBe(join(homedir(), '.satori', 'data'));
  });

  it('resolves bare name to ~/.satori/projects/<name>', () => {
    const cfg: SatoriConfig = { context: { storage_dir: 'miyo' } };
    expect(resolveStorageDir({}, cfg, REPO)).toBe(join(homedir(), '.satori', 'projects', 'miyo'));
  });

  it('expands ~ in absolute-style values', () => {
    const cfg: SatoriConfig = { context: { storage_dir: '~/custom-store' } };
    expect(resolveStorageDir({}, cfg, REPO)).toBe(join(homedir(), 'custom-store'));
  });

  it('uses absolute path as-is', () => {
    const cfg: SatoriConfig = { context: { storage_dir: '/var/lib/satori' } };
    expect(resolveStorageDir({}, cfg, REPO)).toBe('/var/lib/satori');
  });

  it('CLI override beats toml setting', () => {
    const cfg: SatoriConfig = { context: { storage_dir: 'repo' } };
    expect(resolveStorageDir({ storage: 'global' }, cfg, REPO)).toBe(join(homedir(), '.satori', 'data'));
  });

  it('CLI override accepts bare name for named-project form', () => {
    expect(resolveStorageDir({ storage: 'miyo' }, {}, REPO)).toBe(
      join(homedir(), '.satori', 'projects', 'miyo'),
    );
  });
});

describe('resolveFilePath', () => {
  const STORAGE = '/work/repo/satori';

  it('joins default name to storage dir when no override', () => {
    expect(resolveFilePath(STORAGE, undefined, 'db.sqlite')).toBe('/work/repo/satori/db.sqlite');
  });

  it('joins relative override to storage dir', () => {
    expect(resolveFilePath(STORAGE, 'sub/data.sqlite', 'db.sqlite')).toBe('/work/repo/satori/sub/data.sqlite');
  });

  it('uses absolute override as-is', () => {
    expect(resolveFilePath(STORAGE, '/var/lib/foo.sqlite', 'db.sqlite')).toBe('/var/lib/foo.sqlite');
  });

  it('expands ~ in override', () => {
    expect(resolveFilePath(STORAGE, '~/foo.sqlite', 'db.sqlite')).toBe(join(homedir(), 'foo.sqlite'));
  });
});
