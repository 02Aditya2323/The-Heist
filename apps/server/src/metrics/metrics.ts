/**
 * apps/server/src/metrics/metrics.ts
 *
 * Performance monitoring and diagnostics:
 * - 60-second circular ring buffer for tick durations (at 20 Hz, 1200 slots).
 * - Percentile calculations (avg, p50, p99, max).
 * - Rolling counters for messages and bandwidth.
 * - System resource metrics (RSS, heap, event loop lag).
 */

import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { totalmem, freemem } from "node:os";

export interface MetricsSummary {
  players: number;
  ghosts: number;
  tickDuration: {
    avgMs: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    maxMs: number;
    tickOverruns: number;
  };
  network: {
    totalMsgsIn: number;
    totalBytesIn: number;
    totalFramesOut: number;
    totalPacketsIn: number;
    totalPacketsOut: number;
    totalBytesOut: number;
    msgsInPerSec: number;
    bytesOutPerSec: number;
    avgBytesPerClientPerSec: number;
    outboxFlushesPerTick: number;
    backpressureEvents: number;
    rateLimitDrops: number;
    malformedMessages: number;
  };
  measurement: { tickSamplesMs: number[]; totalTicks: number; executionOverruns: number; tickBudgetMs: number };
  system: {
    memoryRssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
    externalMb: number;
    arrayBuffersMb: number;
    eventLoopP50Ms: number;
    eventLoopP95Ms: number;
    eventLoopLagMs: number;
    uptimeSec: number;
    /** 100% equals one fully busy CPU core; hashing workers can exceed 100%. */
    cpuCorePercent: number;
    eventLoopP99Ms: number;
    eventLoopUtilization: number;
    hostTotalMemoryMb: number;
    hostFreeMemoryMb: number;
  };
}

export class MetricsTracker {
  // Ring buffer for tick durations (in milliseconds)
  private readonly bufferSize: number;
  private tickDurations: Float64Array;
  private ringIndex = 0;
  private samplesCount = 0;

  // Counters
  public tickOverruns = 0;
  public backpressureEvents = 0;
  public rateLimitDrops = 0;
  public malformedMessages = 0;
  public totalMsgsIn = 0;
  public totalBytesOut = 0;
  public totalBytesIn = 0;
  public totalFramesOut = 0;
  public totalPacketsIn = 0;
  public totalPacketsOut = 0;
  private intervalTicks: number[] = [];
  private totalTicks = 0;
  private executionOverruns = 0;
  private tickBudgetMs: number;

  // Rolling 1-second network rate metrics
  private msgsInAccum = 0;
  private bytesOutAccum = 0;
  private flushesAccum = 0;
  private ticksInSecond = 0;

  public msgsInPerSec = 0;
  public bytesOutPerSec = 0;
  public outboxFlushesPerTick = 0;

  // Event loop lag measurement
  private eventLoopLagMs = 0;
  private lastLagCheck = Date.now();
  private lagInterval: NodeJS.Timeout | null = null;
  private delay = monitorEventLoopDelay({ resolution: 20 });
  private cpuStart = process.cpuUsage();
  private cpuTime = performance.now();
  private loopStart = performance.eventLoopUtilization();

  constructor(tickRate = 20, windowSec = 60) {
    this.tickBudgetMs = 1000 / tickRate;
    this.bufferSize = tickRate * windowSec;
    this.tickDurations = new Float64Array(this.bufferSize);
    this.delay.enable();

    // Event loop lag checker every 500ms
    this.lagInterval = setInterval(() => {
      const now = Date.now();
      const expected = 500;
      const actual = now - this.lastLagCheck;
      this.eventLoopLagMs = Math.max(0, actual - expected);
      this.lastLagCheck = now;
    }, 500);
    this.lagInterval.unref();
  }

  stop(): void {
    this.delay.disable();
    if (this.lagInterval) {
      clearInterval(this.lagInterval);
      this.lagInterval = null;
    }
  }

  recordTick(durationMs: number): void {
    this.totalTicks++;
    if (durationMs > this.tickBudgetMs) this.executionOverruns++;
    // Bounded if nobody polls. Benchmark polls once/second and collects exact ticks.
    if (this.intervalTicks.length < this.bufferSize) this.intervalTicks.push(durationMs);
    this.tickDurations[this.ringIndex] = durationMs;
    this.ringIndex = (this.ringIndex + 1) % this.bufferSize;
    if (this.samplesCount < this.bufferSize) {
      this.samplesCount++;
    }
    this.ticksInSecond++;
  }

  recordMsgIn(bytes = 0): void {
    this.totalBytesIn += bytes;
    this.msgsInAccum++;
    this.totalMsgsIn++;
  }

  recordBytesOut(bytes: number): void {
    this.bytesOutAccum += bytes;
    this.totalBytesOut += bytes;
  }

  recordDecodedMessages(count: number): void { this.totalPacketsIn += count; }

  recordFlush(packets = 0): void {
    this.totalPacketsOut += packets;
    this.totalFramesOut++;
    this.flushesAccum++;
  }

  /**
   * Called once per second (every ~20 ticks) to roll over per-second rates.
   */
  rollSecond(): void {
    this.msgsInPerSec = this.msgsInAccum;
    this.bytesOutPerSec = this.bytesOutAccum;
    this.outboxFlushesPerTick =
      this.ticksInSecond > 0
        ? +(this.flushesAccum / this.ticksInSecond).toFixed(2)
        : 0;

    this.msgsInAccum = 0;
    this.bytesOutAccum = 0;
    this.flushesAccum = 0;
    this.ticksInSecond = 0;
  }

  getSnapshot(connectedPlayers: number, ghosts: number): MetricsSummary {
    const memory = process.memoryUsage();
    const now = performance.now(),
      cpu = process.cpuUsage(this.cpuStart);
    const cpuCorePercent = +(
      (cpu.user + cpu.system) /
      Math.max(1, now - this.cpuTime) /
      10
    ).toFixed(2);
    this.cpuStart = process.cpuUsage();
    this.cpuTime = now;
    const loop = performance.eventLoopUtilization(this.loopStart);
    this.loopStart = performance.eventLoopUtilization();
    const loopP99 = this.delay.count
      ? +(this.delay.percentile(99) / 1e6).toFixed(3)
      : 0;
    const eventLoopP50Ms = this.delay.count ? this.delay.percentile(50) / 1e6 : 0;
    const eventLoopP95Ms = this.delay.count ? this.delay.percentile(95) / 1e6 : 0;
    this.delay.reset();
    const tickSamplesMs = this.intervalTicks; this.intervalTicks = [];

    let avg = 0;
    let p50 = 0;
    let p99 = 0;
    let p95 = 0;
    let max = 0;

    if (this.samplesCount > 0) {
      const slice = Array.from(
        this.tickDurations.subarray(0, this.samplesCount),
      );
      slice.sort((a, b) => a - b);

      let sum = 0;
      for (let i = 0; i < slice.length; i++) {
        sum += slice[i];
      }
      avg = +(sum / slice.length).toFixed(3);
      const p50Idx = Math.floor(slice.length * 0.5);
      const p99Idx = Math.floor(slice.length * 0.99);
      p95 = +slice[Math.floor(slice.length * .95)].toFixed(3);
      p50 = +slice[p50Idx].toFixed(3);
      p99 = +slice[p99Idx].toFixed(3);
      max = +slice[slice.length - 1].toFixed(3);
    }

    const avgBytesPerClient =
      connectedPlayers > 0
        ? +(this.bytesOutPerSec / connectedPlayers).toFixed(1)
        : 0;

    return {
      players: connectedPlayers,
      ghosts,
      tickDuration: {
        avgMs: avg,
        p50Ms: p50,
        p95Ms: p95,
        p99Ms: p99,
        maxMs: max,
        tickOverruns: this.tickOverruns,
      },
      measurement: { tickSamplesMs, totalTicks: this.totalTicks, executionOverruns: this.executionOverruns, tickBudgetMs: this.tickBudgetMs },
      network: {
        totalBytesIn: this.totalBytesIn, totalFramesOut: this.totalFramesOut,
        totalPacketsIn: this.totalPacketsIn, totalPacketsOut: this.totalPacketsOut,
        totalMsgsIn: this.totalMsgsIn,
        totalBytesOut: this.totalBytesOut,
        msgsInPerSec: this.msgsInPerSec,
        bytesOutPerSec: this.bytesOutPerSec,
        avgBytesPerClientPerSec: avgBytesPerClient,
        outboxFlushesPerTick: this.outboxFlushesPerTick,
        backpressureEvents: this.backpressureEvents,
        rateLimitDrops: this.rateLimitDrops,
        malformedMessages: this.malformedMessages,
      },
      system: {
        memoryRssMb: +(memory.rss / (1024 * 1024)).toFixed(1),
        heapUsedMb: +(memory.heapUsed / (1024 * 1024)).toFixed(1),
        heapTotalMb: +(memory.heapTotal / 1048576).toFixed(1),
        externalMb: +(memory.external / 1048576).toFixed(1),
        arrayBuffersMb: +(memory.arrayBuffers / 1048576).toFixed(1),
        eventLoopP50Ms, eventLoopP95Ms,
        eventLoopLagMs: +this.eventLoopLagMs.toFixed(1),
        uptimeSec: Math.floor(process.uptime()),
        cpuCorePercent,
        eventLoopP99Ms: loopP99,
        eventLoopUtilization: +loop.utilization.toFixed(4),
        hostTotalMemoryMb: Math.round(totalmem() / 1048576),
        hostFreeMemoryMb: Math.round(freemem() / 1048576),
      },
    };
  }
}
