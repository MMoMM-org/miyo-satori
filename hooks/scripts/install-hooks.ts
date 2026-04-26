import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

interface HookCommand {
  type: 'command';
  command: string;
}

interface HookEntry {
  matcher: string;
  hooks: HookCommand[];
}

interface SettingsFile {
  hooks?: Record<string, HookEntry[]>;
  [key: string]: unknown;
}

interface InstallResult {
  settingsFile: string;
  added: string[];
  warnUnstablePath: boolean;
  hooksDir: string;
}

const HOOK_FILES = [
  ['PostToolUse', 'post-tool-use.js'],
  ['PreCompact', 'pre-compact.js'],
  ['SessionStart', 'session-start.js'],
  ['UserPromptSubmit', 'user-prompt-submit.js'],
  ['PreToolUse', 'pre-tool-use.js'],
] as const;

export interface InstallOptions {
  settingsFile?: string;
  hooksDir?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

function resolveSettingsFile(opts: InstallOptions): string {
  if (opts.settingsFile) return resolve(opts.settingsFile);
  const env = opts.env ?? process.env;
  if (env.SATORI_HOOKS_SETTINGS) return resolve(env.SATORI_HOOKS_SETTINGS);
  const cwd = opts.cwd ?? process.cwd();
  const projectSettings = join(cwd, '.claude', 'settings.json');
  if (existsSync(projectSettings)) return projectSettings;
  return join(homedir(), '.claude', 'settings.json');
}

function loadSettings(file: string): SettingsFile {
  if (!existsSync(file)) return {};
  const raw = readFileSync(file, 'utf-8').trim();
  if (!raw) return {};
  return JSON.parse(raw) as SettingsFile;
}

function addHookIfAbsent(settings: SettingsFile, event: string, command: string): boolean {
  if (!settings.hooks) settings.hooks = {};
  const entries = settings.hooks[event] ?? [];
  for (const entry of entries) {
    for (const hook of entry.hooks ?? []) {
      if (hook.command === command) return false;
    }
  }
  entries.push({ matcher: '', hooks: [{ type: 'command', command }] });
  settings.hooks[event] = entries;
  return true;
}

export function installHooks(opts: InstallOptions = {}): InstallResult {
  const hooksDir = opts.hooksDir ?? dirname(fileURLToPath(import.meta.url));

  for (const [, file] of HOOK_FILES) {
    if (!existsSync(join(hooksDir, file))) {
      throw new Error(
        `[satori] install-hooks: missing hook script ${file} in ${hooksDir}. Run 'npm run build' first if developing locally.`,
      );
    }
  }

  const settingsFile = resolveSettingsFile(opts);
  mkdirSync(dirname(settingsFile), { recursive: true });

  const settings = loadSettings(settingsFile);
  const added: string[] = [];
  for (const [event, file] of HOOK_FILES) {
    const command = `node ${join(hooksDir, file)}`;
    if (addHookIfAbsent(settings, event, command)) added.push(event);
  }

  writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');

  return {
    settingsFile,
    added,
    warnUnstablePath: hooksDir.includes('/_npx/'),
    hooksDir,
  };
}

function parseArgs(argv: string[]): InstallOptions {
  const opts: InstallOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--settings') {
      const value = argv[i + 1];
      if (!value) throw new Error('--settings requires a path');
      opts.settingsFile = value;
      i++;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

function printHelp(): void {
  console.log('Usage: miyo-satori install-hooks [--settings <path>]');
  console.log('');
  console.log('Registers Satori hooks in your Claude Code settings.json.');
  console.log('Defaults to <cwd>/.claude/settings.json if it exists, else ~/.claude/settings.json.');
  console.log('Override the destination via --settings <path> or SATORI_HOOKS_SETTINGS env var.');
}

export function runInstallHooksCli(argv: string[]): void {
  let opts: InstallOptions;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(`[satori] install-hooks: ${(err as Error).message}`);
    printHelp();
    process.exit(1);
  }

  const result = installHooks(opts);
  if (result.added.length > 0) {
    console.log(`[satori] hooks registered: ${result.added.join(', ')}`);
    console.log(`[satori] settings: ${result.settingsFile}`);
  } else {
    console.log('[satori] hooks already registered (no changes)');
  }
  if (result.warnUnstablePath) {
    console.warn('');
    console.warn('[satori] WARNING: hook paths point into the npx cache, which is unstable.');
    console.warn('[satori] For stable paths across satori updates, install globally instead:');
    console.warn('[satori]   npm install -g miyo-satori');
    console.warn('[satori]   miyo-satori install-hooks');
  }
}
