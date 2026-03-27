import type { ServerState, ServerStateEntry, RuntimeInterface } from './state.js';

export class LifecycleManager {
  private states = new Map<string, ServerStateEntry>();
  private runtimes = new Map<string, RuntimeInterface>();

  getState(name: string): ServerState {
    return this.states.get(name)?.state ?? 'stopped';
  }

  getEntry(name: string): ServerStateEntry {
    return this.states.get(name) ?? { state: 'stopped' };
  }

  registerRuntime(runtimeType: string, runtime: RuntimeInterface): void {
    this.runtimes.set(runtimeType, runtime);
  }

  setStarting(name: string): void {
    this.states.set(name, { state: 'starting' });
  }

  setRunning(name: string): void {
    this.states.set(name, { state: 'running' });
  }

  setError(name: string, reason: string): void {
    this.states.set(name, { state: 'error', lastError: reason });
  }

  setStopped(name: string): void {
    this.states.set(name, { state: 'stopped' });
  }

  setBlocked(name: string, reason: string): void {
    this.states.set(name, { state: 'blocked', lastError: reason });
  }

  async start(
    name: string,
    runtimeType: string,
    config: unknown,
  ): Promise<{ success: boolean; error?: string }> {
    const current = this.getState(name);

    if (current === 'blocked') {
      const entry = this.getEntry(name);
      return { success: false, error: `Server is blocked: ${entry.lastError ?? 'reason unknown'}` };
    }

    if (current === 'running') {
      return { success: true };
    }

    const runtime = this.runtimes.get(runtimeType);
    if (!runtime) {
      return { success: false, error: `No runtime registered for type: ${runtimeType}` };
    }

    this.setStarting(name);
    try {
      await runtime.start(config);
      this.setRunning(name);
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setError(name, message);
      return { success: false, error: message };
    }
  }

  async stop(name: string): Promise<void> {
    const current = this.getState(name);
    if (current !== 'running') {
      return;
    }

    const entry = this.getEntry(name);
    const runtimeType = (entry as ServerStateEntry & { runtimeType?: string }).runtimeType;
    if (runtimeType) {
      const runtime = this.runtimes.get(runtimeType);
      await runtime?.stop();
    }

    this.setStopped(name);
  }
}
