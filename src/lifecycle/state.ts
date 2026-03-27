export type ServerState = 'stopped' | 'starting' | 'running' | 'error' | 'blocked';

export interface ServerStateEntry {
  state: ServerState;
  lastError?: string;
}

export interface RuntimeInterface {
  start(config: unknown): Promise<void>;
  stop(): Promise<void>;
}
