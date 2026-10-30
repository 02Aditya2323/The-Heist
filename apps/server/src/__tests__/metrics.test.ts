import { describe, it, expect } from "vitest";
import { MetricsTracker } from "../metrics/metrics.js";

describe("hosting observability", () => {
  it("publishes finite resource intervals without disturbing tick/network counters", async () => {
    const metrics = new MetricsTracker();
    try {
      metrics.recordTick(1);
      metrics.recordTick(3);
      metrics.recordMsgIn();
      metrics.recordBytesOut(2048);
      metrics.recordFlush();
      metrics.rollSecond();
      await new Promise((r) => setTimeout(r, 70));
      const result = metrics.getSnapshot(40, 2);
      expect(result.players).toBe(40);
      expect(result.ghosts).toBe(2);
      expect(result.tickDuration.avgMs).toBe(2);
      expect(result.tickDuration.p99Ms).toBe(3);
      expect(result.network.totalMsgsIn).toBe(1);
      expect(result.network.totalBytesOut).toBe(2048);
      for (const key of [
        "cpuCorePercent",
        "eventLoopP99Ms",
        "eventLoopUtilization",
        "hostTotalMemoryMb",
        "hostFreeMemoryMb",
      ] as const) {
        expect(Number.isFinite(result.system[key])).toBe(true);
        expect(result.system[key]).toBeGreaterThanOrEqual(0);
      }
      expect(result.system.hostTotalMemoryMb).toBeGreaterThan(0);
      expect(result.system.hostFreeMemoryMb).toBeLessThanOrEqual(
        result.system.hostTotalMemoryMb,
      );
      const next = metrics.getSnapshot(40, 2);
      expect(next.network.totalMsgsIn).toBe(1);
      expect(next.system.cpuCorePercent).toBeGreaterThanOrEqual(0);
    } finally {
      metrics.stop();
      metrics.stop();
    }
  });
});

it('separates logical packets from frames and execution overruns from scheduler skips', () => {
  const m=new MetricsTracker(20);
  try {
    m.recordMsgIn(13);m.recordDecodedMessages(3);m.recordBytesOut(44);m.recordFlush(4);
    m.recordTick(2);m.recordTick(50);m.recordTick(50.1);
    const first=m.getSnapshot(2,0),second=m.getSnapshot(2,0);
    expect(first.measurement.tickSamplesMs).toEqual([2,50,50.1]);
    expect(second.measurement.tickSamplesMs).toEqual([]);
    expect(second.measurement.totalTicks).toBe(3);
    expect(first.measurement.executionOverruns).toBe(1);
    expect(first.measurement.tickBudgetMs).toBe(50);
    expect(first.network.totalMsgsIn).toBe(1);
    expect(first.network.totalPacketsIn).toBe(3);
    expect(first.network.totalPacketsOut).toBe(4);
    expect(first.network.totalFramesOut).toBe(1);
    expect(first.network.totalBytesIn).toBe(13);
    expect(second.network.totalPacketsOut).toBe(4);
  } finally { m.stop(); }
});
