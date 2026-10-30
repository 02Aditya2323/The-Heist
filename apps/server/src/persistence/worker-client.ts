import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';

/** Bounded asynchronous RPC. SQL, filesystem work and game-event SQL live off-thread. */
export class DatabaseWorker {
  private worker: Worker;
  private sequence = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; started: number }>();
  private failure?: Error;
  private closing?: Promise<void>;
  private completed = 0;
  private rejected = 0;
  private maxPending = 0;
  private maxLatencyMs = 0;
  private totalLatencyMs = 0;
  onFailure?: (error: Error) => void;

  constructor(path: string) {
    const source = import.meta.url.endsWith('.ts');
    const entry = new URL(source ? './sqlite-worker-bootstrap.mjs' : './sqlite-worker.js', import.meta.url);
    // A real ESM bootstrap avoids CJS loader resolution differences on Node 22.
    this.worker = new Worker(entry, { workerData: { path } });
    this.worker.on('message', ({ id, value, error }) => {
      const request = this.pending.get(id);
      if (!request) return;
      this.pending.delete(id);
      const latency = performance.now() - request.started;
      this.completed++;
      this.totalLatencyMs += latency;
      this.maxLatencyMs = Math.max(this.maxLatencyMs, latency);
      if (error) { this.rejected++; request.reject(Object.assign(new Error(error.message), { code: error.code })); }
      else request.resolve(value);
    });
    this.worker.on('error', error => this.fail(error instanceof Error ? error : new Error(String(error))));
    this.worker.on('exit', code => {
      if (!this.closing || this.pending.size) this.fail(new Error(`Database worker exited (${code})`));
    });
  }
  private fail(error: Error) {
    if (this.failure) return;
    this.failure = error;
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
    this.onFailure?.(error);
  }
  request<T>(operation: string, args: unknown[] = []): Promise<T> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.closing) return Promise.reject(new Error('Database is closing'));
    if (operation !== 'close' && this.pending.size >= 1024) { this.rejected++; return Promise.reject(new Error('Database queue is full; retry later')); }
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, started: performance.now() });
      this.maxPending = Math.max(this.maxPending, this.pending.size);
      try { this.worker.postMessage({ id, operation, args }); }
      catch (error) { this.pending.delete(id); reject(error); }
    });
  }
  metrics() {
    return { backend: 'sqlite-worker', healthy: !this.failure, pending: this.pending.size,
      completed: this.completed, rejected: this.rejected, maxPending: this.maxPending,
      maxLatencyMs: this.maxLatencyMs, meanLatencyMs: this.completed ? this.totalLatencyMs / this.completed : 0 };
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    const drain = this.request<void>('close');
    this.closing = (async () => {
      try { await drain; } finally { await this.worker.terminate(); }
    })();
    return this.closing;
  }
}
