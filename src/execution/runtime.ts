// port: context-mode/src/runtime.ts

/**
 * runtime — Language detection and command-building utilities.
 *
 * Ported from context-mode with the following adaptations:
 * - `detectRuntimes()` returns `Promise<Language[]>` (async, array form)
 *   rather than the synchronous `RuntimeMap` object in the original.
 * - `buildCommand(language, filePath)` probes runtimes internally so callers
 *   do not need to pass a RuntimeMap.
 * - Windows-specific `resolveWindowsBash` logic retained but unused on macOS.
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

export type Language =
  | 'javascript'
  | 'typescript'
  | 'python'
  | 'shell'
  | 'ruby'
  | 'go'
  | 'rust'
  | 'php'
  | 'perl'
  | 'r'
  | 'elixir';

// ─────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────

const isWindows = process.platform === 'win32';

function commandExists(cmd: string): boolean {
  try {
    const check = isWindows ? `where ${cmd}` : `command -v ${cmd}`;
    execSync(check, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * On Windows, resolve the first non-WSL bash in PATH.
 * WSL bash (C:\Windows\System32\bash.exe) cannot handle Windows paths,
 * so we skip it and prefer Git Bash or MSYS2 bash instead.
 */
function resolveWindowsBash(): string | null {
  const knownPaths = [
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe',
  ];
  for (const p of knownPaths) {
    if (existsSync(p)) return p;
  }
  try {
    const result = execSync('where bash', { encoding: 'utf-8', stdio: 'pipe' });
    const candidates = result.trim().split(/\r?\n/).map(p => p.trim()).filter(Boolean);
    for (const p of candidates) {
      const lower = p.toLowerCase();
      if (lower.includes('system32') || lower.includes('windowsapps')) continue;
      return p;
    }
    return null;
  } catch {
    return null;
  }
}

function resolveShell(): string {
  if (isWindows) {
    const winBash = resolveWindowsBash();
    if (winBash) return winBash;
    if (commandExists('sh')) return 'sh';
    if (commandExists('powershell')) return 'powershell';
    return 'cmd.exe';
  }
  return commandExists('bash') ? 'bash' : 'sh';
}

// ─────────────────────────────────────────────────────────
// detectRuntimes
// ─────────────────────────────────────────────────────────

/**
 * Probe which language runtimes are available on this machine.
 * `shell` is always included. Returns the array of available Language values.
 */
export async function detectRuntimes(): Promise<Language[]> {
  const langs: Language[] = ['shell'];

  // JavaScript — node is assumed available in any npm project; bun is a bonus
  langs.push('javascript');

  // TypeScript
  const hasBun = commandExists('bun');
  const hasTsx = commandExists('tsx');
  const hasTsNode = commandExists('ts-node');
  if (hasBun || hasTsx || hasTsNode) langs.push('typescript');

  // Python
  if (commandExists('python3') || commandExists('python')) langs.push('python');

  // Optional runtimes
  if (commandExists('ruby')) langs.push('ruby');
  if (commandExists('go')) langs.push('go');
  if (commandExists('rustc')) langs.push('rust');
  if (commandExists('php')) langs.push('php');
  if (commandExists('perl')) langs.push('perl');
  if (commandExists('Rscript') || commandExists('r')) langs.push('r');
  if (commandExists('elixir')) langs.push('elixir');

  return langs;
}

// ─────────────────────────────────────────────────────────
// buildCommand
// ─────────────────────────────────────────────────────────

/**
 * Return the spawn args array for executing `filePath` in the given language.
 * Probes available runtimes internally.
 *
 * For `rust`: returns `['__rust_compile_run__', filePath]` — the executor must
 * handle this sentinel and perform a compile-then-run sequence.
 *
 * @throws {Error} if the required runtime is not installed.
 */
export function buildCommand(language: Language, filePath: string): string[] {
  switch (language) {
    case 'javascript': {
      const useBun = commandExists('bun');
      return useBun ? ['bun', 'run', filePath] : ['node', filePath];
    }

    case 'typescript': {
      if (commandExists('bun')) return ['bun', 'run', filePath];
      if (commandExists('tsx')) return ['tsx', filePath];
      if (commandExists('ts-node')) return ['ts-node', filePath];
      throw new Error(
        'No TypeScript runtime available. Install one of: bun (recommended), tsx (npm i -g tsx), or ts-node.',
      );
    }

    case 'python': {
      const py = commandExists('python3') ? 'python3' : commandExists('python') ? 'python' : null;
      if (!py) throw new Error('No Python runtime available. Install python3 or python.');
      return [py, filePath];
    }

    case 'shell':
      return [resolveShell(), filePath];

    case 'ruby':
      if (!commandExists('ruby')) throw new Error('Ruby not available. Install ruby.');
      return ['ruby', filePath];

    case 'go':
      if (!commandExists('go')) throw new Error('Go not available. Install go.');
      return ['go', 'run', filePath];

    case 'rust':
      if (!commandExists('rustc')) throw new Error('Rust not available. Install rustc via https://rustup.rs');
      // Compile-then-run — executor handles the sentinel
      return ['__rust_compile_run__', filePath];

    case 'php':
      if (!commandExists('php')) throw new Error('PHP not available. Install php.');
      return ['php', filePath];

    case 'perl':
      if (!commandExists('perl')) throw new Error('Perl not available. Install perl.');
      return ['perl', filePath];

    case 'r': {
      const r = commandExists('Rscript') ? 'Rscript' : commandExists('r') ? 'r' : null;
      if (!r) throw new Error('R not available. Install R / Rscript.');
      return [r, filePath];
    }

    case 'elixir':
      if (!commandExists('elixir')) throw new Error('Elixir not available. Install elixir.');
      return ['elixir', filePath];
  }
}
