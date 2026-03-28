// port: context-mode/src/executor.ts

/**
 * executor — PolyglotExecutor: spawn code in any supported language with
 * safety env stripping, timeout, hard output cap, and background mode.
 *
 * Ported from context-mode/src/executor.ts with the following adaptations:
 * - Uses satori's async detectRuntimes() / buildCommand(language, filePath) API
 *   (context-mode takes a RuntimeMap; satori probes internally).
 * - #buildSafeEnv receives no tmpDir argument — cwd is handled by the caller.
 * - executeFile() prepends code as variable assignments (not file-content wrap).
 * - intent field on ExecuteOpts is passed through for Phase 3 BuiltinServer use.
 */

import { spawn, execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { buildCommand } from './runtime.js';
import type { Language } from './runtime.js';
import { smartTruncate } from './truncate.js';

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

export type { Language };

export interface ExecuteOpts {
  language: Language;
  code: string;
  timeout?: number;       // ms, default 30_000
  background?: boolean;   // default false
  intent?: string;        // passed through — used by BuiltinServer in Phase 3
  env?: Record<string, string>; // merged into safe env
}

export interface ExecuteFileOpts {
  path: string;
  language: Language;
  code?: string;          // injected as variable assignments prepended to file content
  timeout?: number;
}

export interface ExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  truncated?: boolean;
  timedOut?: boolean;
  backgrounded?: boolean;
  capExceeded?: boolean;  // true if 100MB hard cap was hit
}

// ─────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────

const isWin = process.platform === 'win32';

/** Kill process tree — on Windows uses taskkill /T; on Unix kills the process group. */
function killTree(proc: ReturnType<typeof spawn>): void {
  if (isWin && proc.pid) {
    try {
      execSync(`taskkill /F /T /PID ${proc.pid}`, { stdio: 'pipe' });
    } catch { /* already dead */ }
  } else if (proc.pid) {
    try {
      // Kill entire process group (negative PID) to prevent orphaned children
      process.kill(-proc.pid, 'SIGTERM');
    } catch {
      // Fall back to direct kill if process group kill fails
      try { proc.kill('SIGTERM'); } catch { /* already dead */ }
    }
  }
}

// ─────────────────────────────────────────────────────────
// PolyglotExecutor
// ─────────────────────────────────────────────────────────

export class PolyglotExecutor {
  #maxOutputBytes: number;
  #hardCapBytes: number;
  #projectRoot: string;

  /** PIDs of backgrounded processes — killed on cleanup to prevent zombies. */
  #backgroundedPids = new Set<number>();

  constructor(opts?: {
    maxOutputBytes?: number;
    hardCapBytes?: number;
    projectRoot?: string;
  }) {
    this.#maxOutputBytes = opts?.maxOutputBytes ?? 512_000; // 512KB display cap
    this.#hardCapBytes = opts?.hardCapBytes ?? 100 * 1024 * 1024; // 100MB hard cap
    this.#projectRoot = opts?.projectRoot ?? process.cwd();
  }

  /** Kill all backgrounded processes to prevent zombie/port-conflict issues. */
  cleanupBackgrounded(): void {
    for (const pid of this.#backgroundedPids) {
      try {
        // Kill process group on Unix to catch all children
        process.kill(isWin ? pid : -pid, 'SIGTERM');
      } catch { /* already dead */ }
    }
    this.#backgroundedPids.clear();
  }

  async execute(opts: ExecuteOpts): Promise<ExecuteResult> {
    const { language, code, timeout = 30_000, background = false, env } = opts;
    const tmpDir = mkdtempSync(join(tmpdir(), 'satori-'));

    try {
      const filePath = this.#writeScript(tmpDir, code, language);
      const cmd = buildCommand(language, filePath);

      // Rust: compile then run
      if (cmd[0] === '__rust_compile_run__') {
        return await this.#compileAndRun(filePath, tmpDir, timeout);
      }

      // Shell commands run in the project directory so git, relative paths,
      // and other project-aware tools work naturally. Non-shell languages
      // run in the temp directory where their script file is written.
      const cwd = language === 'shell' ? this.#projectRoot : tmpDir;
      const result = await this.#spawn(cmd, cwd, timeout, background, env);

      // Skip tmpDir cleanup if process was backgrounded — it may still need files
      if (!result.backgrounded) {
        try {
          rmSync(tmpDir, { recursive: true, force: true });
        } catch { /* ignore */ }
      }

      return result;
    } catch (err) {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch { /* ignore */ }
      throw err;
    }
  }

  async executeFile(opts: ExecuteFileOpts): Promise<ExecuteResult> {
    const { path: filePath, language, code, timeout = 30_000 } = opts;
    const absolutePath = resolve(this.#projectRoot, filePath);
    const fileContent = readFileSync(absolutePath, 'utf-8');
    // If code is provided, prepend it as variable assignments to the file content
    const combined = code ? `${code}\n${fileContent}` : fileContent;
    return this.execute({ language, code: combined, timeout });
  }

  // ─────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────

  #writeScript(tmpDir: string, code: string, language: Language): string {
    const extMap: Record<Language, string> = {
      javascript: 'js',
      typescript: 'ts',
      python: 'py',
      shell: 'sh',
      ruby: 'rb',
      go: 'go',
      rust: 'rs',
      php: 'php',
      perl: 'pl',
      r: 'R',
      elixir: 'exs',
    };

    // Go needs a main package wrapper if not present
    if (language === 'go' && !code.includes('package ')) {
      code = `package main\n\nimport "fmt"\n\nfunc main() {\n${code}\n}\n`;
    }

    // PHP needs opening tag if not present
    if (language === 'php' && !code.trimStart().startsWith('<?')) {
      code = `<?php\n${code}`;
    }

    // Elixir: prepend compiled BEAM paths when inside a Mix project
    if (language === 'elixir' && existsSync(join(this.#projectRoot, 'mix.exs'))) {
      const escaped = JSON.stringify(join(this.#projectRoot, '_build/dev/lib'));
      code = `Path.wildcard(Path.join(${escaped}, "*/ebin"))\n|> Enum.each(&Code.prepend_path/1)\n\n${code}`;
    }

    const fp = join(tmpDir, `script.${extMap[language]}`);
    if (language === 'shell') {
      writeFileSync(fp, code, { encoding: 'utf-8', mode: 0o700 });
    } else {
      writeFileSync(fp, code, 'utf-8');
    }
    return fp;
  }

  async #compileAndRun(
    srcPath: string,
    cwd: string,
    timeout: number,
  ): Promise<ExecuteResult> {
    const binSuffix = isWin ? '.exe' : '';
    const binPath = srcPath.replace(/\.rs$/, '') + binSuffix;

    // Compile
    try {
      execSync(`rustc ${srcPath} -o ${binPath}`, {
        cwd,
        timeout: Math.min(timeout, 60_000),
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err: unknown) {
      const message = err instanceof Error
        ? (err as NodeJS.ErrnoException & { stderr?: string }).stderr ?? err.message
        : String(err);
      return {
        stdout: '',
        stderr: `Compilation failed:\n${message}`,
        exitCode: 1,
        timedOut: false,
      };
    }

    // Run
    return this.#spawn([binPath], cwd, timeout);
  }

  async #spawn(
    cmd: string[],
    cwd: string,
    timeout: number,
    background = false,
    extraEnv?: Record<string, string>,
  ): Promise<ExecuteResult> {
    return new Promise((res) => {
      // Only .cmd/.bat shims need shell on Windows; real executables don't.
      const needsShell = isWin && ['tsx', 'ts-node', 'elixir'].includes(cmd[0]);

      let spawnCmd = cmd[0];
      let spawnArgs: string[];
      if (isWin && cmd.length === 2 && cmd[1]) {
        const posixPath = cmd[1].replace(/\\/g, '/');
        spawnArgs = [posixPath];
      } else {
        spawnArgs = isWin
          ? cmd.slice(1).map(a => a.replace(/\\/g, '/'))
          : cmd.slice(1);
      }

      const proc = spawn(spawnCmd, spawnArgs, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: this.#buildSafeEnv(extraEnv),
        shell: needsShell,
        // On Unix, create a new process group so killTree can kill all children
        detached: !isWin,
      });

      let timedOut = false;
      let resolved = false;
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let totalBytes = 0;
      let capExceeded = false;

      const timer = setTimeout(() => {
        timedOut = true;
        if (background) {
          // Background mode: detach process, return partial output, keep running
          resolved = true;
          if (proc.pid) this.#backgroundedPids.add(proc.pid);
          proc.unref();
          proc.stdout!.destroy();
          proc.stderr!.destroy();
          const rawStdout = Buffer.concat(stdoutChunks).toString('utf-8');
          const rawStderr = Buffer.concat(stderrChunks).toString('utf-8');
          const { stdout, stderr, truncated } = this.#applyTruncation(rawStdout, rawStderr);
          res({
            stdout,
            stderr,
            exitCode: 0,
            timedOut: true,
            backgrounded: true,
            ...(truncated ? { truncated: true } : {}),
          });
        } else {
          killTree(proc);
        }
      }, timeout);

      // Stream-level byte cap: kill the process once combined stdout+stderr
      // exceeds hardCapBytes. Without this, a command like `yes` or
      // `cat /dev/urandom | base64` can accumulate gigabytes in memory
      // before the timeout fires.
      proc.stdout!.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes <= this.#hardCapBytes) {
          stdoutChunks.push(chunk);
        } else if (!capExceeded) {
          capExceeded = true;
          killTree(proc);
        }
      });

      proc.stderr!.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes <= this.#hardCapBytes) {
          stderrChunks.push(chunk);
        } else if (!capExceeded) {
          capExceeded = true;
          killTree(proc);
        }
      });

      proc.on('close', (exitCode) => {
        clearTimeout(timer);
        if (resolved) return; // Already resolved by background timeout

        const rawStdout = Buffer.concat(stdoutChunks).toString('utf-8');
        let rawStderr = Buffer.concat(stderrChunks).toString('utf-8');

        if (capExceeded) {
          rawStderr += `\n[output capped at ${(this.#hardCapBytes / 1024 / 1024).toFixed(0)}MB — process killed]`;
        }

        const { stdout, stderr, truncated } = this.#applyTruncation(rawStdout, rawStderr);

        res({
          stdout,
          stderr,
          exitCode: timedOut ? 1 : (exitCode ?? 1),
          timedOut: timedOut || undefined,
          ...(truncated ? { truncated: true } : {}),
          ...(capExceeded ? { capExceeded: true } : {}),
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        if (resolved) return;
        res({
          stdout: '',
          stderr: err.message,
          exitCode: 1,
        });
      });

      // If background mode without timeout-based detach, spawn and return immediately
      if (background) {
        // Override timer: immediately detach and return backgrounded: true
        // The timer above handles the case where we want partial output first;
        // for immediate background, we just unref and resolve now.
        // Note: timeout still fires above if process lingers, but we resolve now.
        resolved = true;
        clearTimeout(timer);
        if (proc.pid) this.#backgroundedPids.add(proc.pid);
        proc.unref();
        res({
          stdout: '',
          stderr: '',
          exitCode: null,
          backgrounded: true,
        });
      }
    });
  }

  /** Apply smartTruncate to stdout and stderr; return whether truncation occurred. */
  #applyTruncation(rawStdout: string, rawStderr: string): {
    stdout: string;
    stderr: string;
    truncated: boolean;
  } {
    const max = this.#maxOutputBytes;
    const stdout = smartTruncate(rawStdout, max);
    const stderr = smartTruncate(rawStderr, max);
    const truncated = stdout !== rawStdout || stderr !== rawStderr;
    return { stdout, stderr, truncated };
  }

  /**
   * Build a sanitised environment for spawned processes.
   *
   * Starts from process.env, removes all variables on the DENIED list
   * (shell injection, loader hijacking, runtime startup hooks, etc.),
   * then merges in any caller-supplied extras.
   *
   * DENIED list matches context-mode exactly; additional entries added for
   * Elixir/Erlang, Go, Rust, PHP, R, and git-based injection vectors.
   */
  #buildSafeEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
    // Denylist: env vars that corrupt sandbox stdout, inject code, or break
    // language runtimes. Each entry is backed by CVE, MITRE, or live testing.
    // See: https://www.elttam.com/blog/env/, MITRE T1574.006
    const DENIED = new Set([
      // Shell — auto-execute scripts, override builtins
      'BASH_ENV',             // sourced by non-interactive bash
      'ENV',                  // sourced by sh/dash
      'PROMPT_COMMAND',       // runs before each prompt
      'PS4',                  // $(cmd) expansion in xtrace
      'SHELLOPTS',            // enables xtrace/verbose, dumps to stdout
      'BASHOPTS',             // bash-specific shell options
      'CDPATH',               // makes cd print to stdout
      'INPUTRC',              // readline key rebinding
      'BASH_XTRACEFD',        // redirects debug output to stdout
      // Node.js — require injection, inspector
      'NODE_OPTIONS',         // --require, --loader, --inspect
      'NODE_PATH',            // module search path injection
      // Python — stdlib override, startup injection
      'PYTHONSTARTUP',        // auto-executes in interactive mode
      'PYTHONHOME',           // overrides stdlib location (breaks Python)
      'PYTHONWARNINGS',       // triggers module import chain → RCE
      'PYTHONBREAKPOINT',     // arbitrary callable
      'PYTHONINSPECT',        // enters interactive mode after script
      // Ruby — option/module injection
      'RUBYOPT',              // injects CLI options (-r loads files)
      'RUBYLIB',              // module search path injection
      // Perl — option/module injection
      'PERL5OPT',             // injects CLI options (-M runs code)
      'PERL5LIB',             // module search path injection
      'PERLLIB',              // legacy module search path
      'PERL5DB',              // debugger command injection
      // Elixir/Erlang — eval injection
      'ERL_AFLAGS',           // prepends erl flags (-eval runs code)
      'ERL_FLAGS',            // appends erl flags
      'ELIXIR_ERL_OPTIONS',   // Elixir-specific erl flags
      'ERL_LIBS',             // beam file loading
      // Go — compiler/linker injection
      'GOFLAGS',              // injects go command flags
      'CGO_CFLAGS',           // C compiler flag injection
      'CGO_LDFLAGS',          // linker flag injection
      // Rust — compiler substitution
      'RUSTC',                // arbitrary compiler binary
      'RUSTC_WRAPPER',        // compiler wrapper injection
      'RUSTC_WORKSPACE_WRAPPER',
      'CARGO_BUILD_RUSTC',
      'CARGO_BUILD_RUSTC_WRAPPER',
      'RUSTFLAGS',            // compiler flag injection
      // PHP — config injection
      'PHPRC',                // auto_prepend_file → RCE
      'PHP_INI_SCAN_DIR',     // additional .ini loading
      // R — startup script injection
      'R_PROFILE',            // site-wide R profile
      'R_PROFILE_USER',       // user R profile
      'R_HOME',               // R installation override
      // Dynamic linker — shared library injection
      'LD_PRELOAD',           // loads .so before all others (Linux)
      'LD_LIBRARY_PATH',      // library search path (Linux)
      'DYLD_INSERT_LIBRARIES', // macOS equivalent of LD_PRELOAD
      'DYLD_LIBRARY_PATH',    // macOS library search path
      // OpenSSL — engine loading
      'OPENSSL_CONF',         // loads engine modules → .so exec
      'OPENSSL_ENGINES',      // engine directory override
      // Compiler — binary substitution
      'CC',                   // C compiler override
      'CXX',                  // C++ compiler override
      'AR',                   // archiver override
      // Git — command injection via hooks/config
      'GIT_TEMPLATE_DIR',     // hook injection on git init
      'GIT_CONFIG_GLOBAL',    // core.pager/editor runs commands
      'GIT_CONFIG_SYSTEM',    // system-level config injection
      'GIT_EXEC_PATH',        // substitute git subcommands
      'GIT_SSH',              // arbitrary command instead of ssh
      'GIT_SSH_COMMAND',      // arbitrary ssh command
      'GIT_ASKPASS',          // arbitrary credential command
    ]);

    // Start with parent env, then strip dangerous vars
    const env: NodeJS.ProcessEnv = {};
    for (const [key, val] of Object.entries(process.env)) {
      if (val !== undefined && !DENIED.has(key) && !key.startsWith('BASH_FUNC_')) {
        env[key] = val;
      }
    }

    // Merge in caller-supplied extras (after stripping, so extras are not filtered)
    if (extra) {
      for (const [key, val] of Object.entries(extra)) {
        env[key] = val;
      }
    }

    // Sandbox overrides — forced values for correct sandbox behavior
    env['LANG'] = 'en_US.UTF-8';
    env['PYTHONDONTWRITEBYTECODE'] = '1';
    env['PYTHONUNBUFFERED'] = '1';
    env['PYTHONUTF8'] = '1';
    env['NO_COLOR'] = '1';

    // Windows: normalize Path → PATH
    if (isWin && !env['PATH'] && env['Path']) {
      env['PATH'] = env['Path'];
      delete env['Path'];
    }
    if (!env['PATH']) {
      env['PATH'] = isWin ? '' : '/usr/local/bin:/usr/bin:/bin';
    }

    if (isWin) {
      env['MSYS_NO_PATHCONV'] = '1';
      env['MSYS2_ARG_CONV_EXCL'] = '*';
      const gitUsrBin = 'C:\\Program Files\\Git\\usr\\bin';
      const gitBin = 'C:\\Program Files\\Git\\bin';
      if (!env['PATH']!.includes(gitUsrBin)) {
        env['PATH'] = `${gitUsrBin};${gitBin};${env['PATH']}`;
      }
    }

    // Ensure SSL_CERT_FILE is set so Python/Ruby HTTPS works in sandbox.
    if (!env['SSL_CERT_FILE']) {
      const certPaths = isWin ? [] : [
        '/etc/ssl/cert.pem',                                    // macOS, some Linux
        '/etc/ssl/certs/ca-certificates.crt',                   // Debian/Ubuntu/Alpine
        '/etc/pki/tls/certs/ca-bundle.crt',                     // RHEL/CentOS/Fedora
        '/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem',    // Fedora alt
      ];
      for (const p of certPaths) {
        if (existsSync(p)) {
          env['SSL_CERT_FILE'] = p;
          break;
        }
      }
    }

    return env;
  }
}
