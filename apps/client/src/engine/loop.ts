/**
 * Game loop interface and stub.
 */

export type LoopUpdateCallback = (dt: number, now: number) => void;
export type LoopRenderCallback = (interpolation: number, now: number) => void;

export class GameLoop {
  private running = false;
  private animFrameId: number | null = null;
  private lastTime = 0;

  constructor(
    private updateFn?: LoopUpdateCallback,
    private renderFn?: LoopRenderCallback
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.tick(this.lastTime);
  }

  stop(): void {
    this.running = false;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  private tick(now: number): void {
    if (!this.running) return;
    const dt = Math.min(100, now - this.lastTime);
    this.lastTime = now;

    this.updateFn?.(dt, now);
    this.renderFn?.(1.0, now);

    this.animFrameId = requestAnimationFrame((timestamp) => this.tick(timestamp));
  }
}
