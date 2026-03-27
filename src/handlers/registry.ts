import type { SatoriHandler } from './interface.js';
import { PassthroughHandler } from './passthrough.js';

export class HandlerRegistry {
  private handlers = new Map<string, SatoriHandler>();
  private passthrough = new PassthroughHandler();

  constructor() {
    this.handlers.set('passthrough', this.passthrough);
  }

  register(handler: SatoriHandler): void {
    this.handlers.set(handler.name, handler);
  }

  lookup(name: string): SatoriHandler {
    return this.handlers.get(name) ?? this.passthrough;
  }

  list(): SatoriHandler[] {
    return Array.from(this.handlers.values());
  }
}
