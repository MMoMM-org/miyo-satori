import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { installHooks } from '../../hooks/scripts/install-hooks.js';

interface SettingsFile {
  hooks?: Record<string, { matcher: string; hooks: { type: string; command: string }[] }[]>;
  [key: string]: unknown;
}

function readSettings(file: string): SettingsFile {
  return JSON.parse(readFileSync(file, 'utf-8')) as SettingsFile;
}

describe('installHooks', () => {
  let tmpDir: string;
  let hooksDir: string;
  let settingsFile: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'satori-install-hooks-'));
    hooksDir = join(tmpDir, 'hooks-dist');
    mkdirSync(hooksDir, { recursive: true });
    for (const file of [
      'post-tool-use.js',
      'pre-compact.js',
      'session-start.js',
      'user-prompt-submit.js',
      'pre-tool-use.js',
    ]) {
      writeFileSync(join(hooksDir, file), '// stub\n');
    }
    settingsFile = join(tmpDir, 'settings.json');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates settings.json and registers all five hooks', () => {
    const result = installHooks({ hooksDir, settingsFile });

    expect(result.added).toEqual([
      'PostToolUse',
      'PreCompact',
      'SessionStart',
      'UserPromptSubmit',
      'PreToolUse',
    ]);
    expect(existsSync(settingsFile)).toBe(true);

    const settings = readSettings(settingsFile);
    expect(Object.keys(settings.hooks ?? {}).sort()).toEqual([
      'PostToolUse',
      'PreCompact',
      'PreToolUse',
      'SessionStart',
      'UserPromptSubmit',
    ]);
    const postToolEntry = settings.hooks!.PostToolUse[0];
    expect(postToolEntry.hooks[0].command).toBe(`node ${join(hooksDir, 'post-tool-use.js')}`);
  });

  it('is idempotent — second run adds nothing', () => {
    installHooks({ hooksDir, settingsFile });
    const result = installHooks({ hooksDir, settingsFile });

    expect(result.added).toEqual([]);
    const settings = readSettings(settingsFile);
    expect(settings.hooks!.PostToolUse).toHaveLength(1);
  });

  it('preserves unrelated hooks already in settings.json', () => {
    writeFileSync(
      settingsFile,
      JSON.stringify({
        hooks: {
          Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'echo stop' }] }],
        },
      }),
    );

    installHooks({ hooksDir, settingsFile });

    const settings = readSettings(settingsFile);
    expect(settings.hooks!.Stop[0].hooks[0].command).toBe('echo stop');
    expect(settings.hooks!.PostToolUse).toBeDefined();
  });

  it('does not duplicate when a different unrelated PostToolUse hook is already present', () => {
    writeFileSync(
      settingsFile,
      JSON.stringify({
        hooks: {
          PostToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'other-tool' }] }],
        },
      }),
    );

    const result = installHooks({ hooksDir, settingsFile });

    expect(result.added).toContain('PostToolUse');
    const settings = readSettings(settingsFile);
    expect(settings.hooks!.PostToolUse).toHaveLength(2);
  });

  it('throws when a hook script is missing in hooksDir', () => {
    rmSync(join(hooksDir, 'post-tool-use.js'));
    expect(() => installHooks({ hooksDir, settingsFile })).toThrowError(/missing hook script post-tool-use\.js/);
  });

  it('flags warnUnstablePath when hooksDir lives in the npx cache', () => {
    const npxLikeDir = join(tmpDir, '.npm', '_npx', 'abc123', 'node_modules', 'miyo-satori', 'dist', 'hooks', 'scripts');
    mkdirSync(npxLikeDir, { recursive: true });
    for (const file of [
      'post-tool-use.js',
      'pre-compact.js',
      'session-start.js',
      'user-prompt-submit.js',
      'pre-tool-use.js',
    ]) {
      writeFileSync(join(npxLikeDir, file), '// stub\n');
    }

    const result = installHooks({ hooksDir: npxLikeDir, settingsFile });
    expect(result.warnUnstablePath).toBe(true);
  });

  it('uses SATORI_HOOKS_SETTINGS env override when no settingsFile is passed', () => {
    const overrideFile = join(tmpDir, 'override.json');
    installHooks({ hooksDir, env: { SATORI_HOOKS_SETTINGS: overrideFile } });
    expect(existsSync(overrideFile)).toBe(true);
  });

  it('prefers project-level .claude/settings.json when it exists in cwd', () => {
    const projectClaude = join(tmpDir, '.claude');
    mkdirSync(projectClaude);
    const projectSettings = join(projectClaude, 'settings.json');
    writeFileSync(projectSettings, '{}');

    const result = installHooks({ hooksDir, cwd: tmpDir, env: {} });
    expect(result.settingsFile).toBe(projectSettings);
  });
});
