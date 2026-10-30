/**
 * Typed Event Bus for S2C.JSON messages and custom client events.
 */

export type JsonEventHandler<T = unknown> = (payload: T) => void;

export class TypedEventBus {
  private handlers = new Map<string, Set<JsonEventHandler>>();
  private allHandlers = new Set<JsonEventHandler>();

  on<T = unknown>(event: string, handler: JsonEventHandler<T>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    const set = this.handlers.get(event)!;
    set.add(handler as JsonEventHandler);
    return () => set.delete(handler as JsonEventHandler);
  }

  onAny(handler: JsonEventHandler): () => void {
    this.allHandlers.add(handler);
    return () => this.allHandlers.delete(handler);
  }

  emit(payload: unknown): void {
    for (const h of this.allHandlers) {
      try {
        h(payload);
      } catch (err) {
        console.error('[EventBus] Error in onAny handler:', err);
      }
    }

    if (typeof payload === 'object' && payload !== null && 'type' in payload) {
      const type = String((payload as { type: string }).type);
      const set = this.handlers.get(type);
      if (set) {
        for (const h of set) {
          try {
            h(payload);
          } catch (err) {
            console.error(`[EventBus] Error in handler for event "${type}":`, err);
          }
        }
      }
    }
  }
}
