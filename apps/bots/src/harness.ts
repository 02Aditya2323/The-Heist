/**
 * apps/bots/src/harness.ts
 *
 * Test harness orchestrating bot armies, running test scenarios,
 * asserting correctness criteria, and printing pass/fail reports.
 */

import { loadMap, DIR, type GameMap, type MapData } from '@heist/shared';
import { BotClient, type BehaviourType, type NetworkProfile } from './bot.js';
import { BotBrain } from './behaviours.js';

export interface HarnessConfig {
  httpUrl: string;
  wsUrl: string;
}

export interface ScenarioResult {
  scenarioName: string;
  passed: boolean;
  durationSec: number;
  botCount: number;
  desyncs: number;
  rejects: number;
  checksAttempted: number;
  checksRun: number;
  p50RttMs: number;
  p95RttMs: number;
  p99RttMs: number;
  serverTickAvgMs: number;
  serverTickP99Ms: number;
  tickOverruns: number;
  avgBandwidthKbPerSec: number;
  p95BandwidthKbPerSec: number;
  details: string[];
}

/**
 * Assigns behavior models according to Section 14 spec:
 * 45% Roamer, 20% Hotspot-goer, 10% Explorer, 10% Border-crosser, 5% AFK, 5% Reconnector, 5% Human-pauser
 */
export function getSpecBehaviour(index: number, total: number): BehaviourType {
  const p = (index + 0.5) / total;
  if (p < 0.45) return 'roamer';
  if (p < 0.65) return 'hotspot-goer';
  if (p < 0.75) return 'explorer';
  if (p < 0.85) return 'border-crosser';
  if (p < 0.90) return 'afk';
  if (p < 0.95) return 'reconnector';
  return 'human-pauser';
}

/**
 * Assigns network profile according to Section 14 spec:
 * 60% good (5-30ms), 30% medium (50-120ms), 10% bad (150-400ms)
 */
export function getSpecNetworkProfile(index: number, total: number): NetworkProfile {
  const p = (index + 0.5) / total;
  if (p < 0.60) return 'good';
  if (p < 0.90) return 'medium';
  return 'bad';
}

export class TestHarness {
  private httpUrl: string;
  private wsUrl: string;
  private map!: GameMap;
  private bots: BotClient[] = [];
  private brains: BotBrain[] = [];

  constructor(config: HarnessConfig) {
    this.httpUrl = config.httpUrl;
    this.wsUrl = config.wsUrl;
  }

  async init(): Promise<void> {
    const res = await fetch(`${this.httpUrl}/api/map`);
    if (!res.ok) throw new Error('Failed to fetch map from server');
    const data = (await res.json()) as MapData;
    this.map = loadMap(data);
  }

  createBot(
    index: number,
    behaviour: BehaviourType,
    profile: NetworkProfile
  ): BotClient {
    const id = `agent_${String(index).padStart(3, '0')}`;
    const bot = new BotClient(
      id,
      behaviour,
      profile,
      this.httpUrl,
      this.wsUrl,
      this.map
    );
    const brain = new BotBrain(bot, this.map);
    this.bots.push(bot);
    this.brains.push(brain);
    return bot;
  }

  stopAll(): void {
    for (const brain of this.brains) brain.stop();
    for (const bot of this.bots) bot.disconnect();
    this.bots = [];
    this.brains = [];
  }

  /**
   * Scenario: Login Storm
   * Registers/logins bots within a short window to stress async hashing + WS accept.
   */
  async runLoginStorm(count = 90, durationMs = 10000): Promise<ScenarioResult> {
    console.log(`\n▶ Starting Scenario: LOGIN STORM (${count} bots in ${durationMs / 1000}s)`);
    this.stopAll();

    const startTime = performance.now();
    const intervalMs = durationMs / Math.max(1, count);

    let successfulConnects = 0;
    const connectPromises: Promise<void>[] = [];

    for (let i = 0; i < count; i++) {
      const bot = this.createBot(i, 'roamer', 'good');
      const p = (async () => {
        await new Promise((r) => setTimeout(r, i * intervalMs));
        await bot.registerAndLogin();
        await bot.connect();
        successfulConnects++;
      })();
      connectPromises.push(p);
    }

    await Promise.allSettled(connectPromises);

    const elapsedSec = +((performance.now() - startTime) / 1000).toFixed(1);
    const passed = successfulConnects === count;

    return {
      scenarioName: 'Login Storm',
      passed,
      durationSec: elapsedSec,
      botCount: count,
      desyncs: 0,
      rejects: 0,
      checksAttempted: count,
      checksRun: successfulConnects,
      p50RttMs: 0,
      p95RttMs: 0,
      p99RttMs: 0,
      serverTickAvgMs: 0,
      serverTickP99Ms: 0,
      tickOverruns: 0,
      avgBandwidthKbPerSec: 0,
      p95BandwidthKbPerSec: 0,
      details: [`Connected ${successfulConnects}/${count} bots in ${elapsedSec}s`],
    };
  }

  /**
   * Scenario: Multi-Behavior Traffic & AoI Correctness Validation
   * Enforces periodic consistency checks every ~10s, fail-closed >90% check run gate,
   * in-order latency, position & id replica equality, and spec metric gates.
   */
  async runTrafficValidation(
    count = 30,
    durationSec = 20
  ): Promise<ScenarioResult> {
    console.log(
      `\n▶ Starting Scenario: TRAFFIC VALIDATION (${count} bots, ${durationSec}s soak)`
    );
    this.stopAll();

    // 1. Initialize bots according to spec behaviour and network mix
    for (let i = 0; i < count; i++) {
      const b = getSpecBehaviour(i, count);
      const p = getSpecNetworkProfile(i, count);
      this.createBot(i, b, p);
    }

    for (const bot of this.bots) {
      await bot.registerAndLogin();
      await bot.connect();
    }

    // 2. Sample baseline metrics right when traffic soak begins
    let initialTickOverruns = 0;
    try {
      const initialMetricsRes = await fetch(`${this.httpUrl}/metrics`);
      if (initialMetricsRes.ok) {
        const initialMetrics = (await initialMetricsRes.json()) as any;
        initialTickOverruns = initialMetrics?.tickDuration?.tickOverruns || 0;
      }
    } catch {}

    // Start bot brains
    for (const brain of this.brains) {
      brain.start();
    }

    // 3. Periodic AoI consistency check every ~10s during the soak
    let totalDesyncs = 0;
    let checksAttempted = 0;
    let checksRun = 0;

    const checkIntervalMs = 10000;
    const soakStartTime = performance.now();
    const totalDurationMs = durationSec * 1000;
    let nextCheckTime = soakStartTime + checkIntervalMs;

    while (performance.now() - soakStartTime < totalDurationMs) {
      const remainingMs = totalDurationMs - (performance.now() - soakStartTime);
      const sleepTime = Math.min(500, remainingMs);
      if (sleepTime <= 0) break;
      await new Promise((r) => setTimeout(r, sleepTime));

      if (performance.now() >= nextCheckTime && performance.now() - soakStartTime < totalDurationMs - 1000) {
        nextCheckTime += checkIntervalMs;
        // Mid-soak periodic consistency check:
        // Pause brains, flush outbound queues, wait 500ms, and flush inbound to allow in-flight events to settle
        for (const brain of this.brains) brain.stop();
        for (const bot of this.bots) bot.flushOutboundQueue();
        await new Promise((r) => setTimeout(r, 500));
        for (const bot of this.bots) bot.flushInboundQueue();

        for (const bot of this.bots) {
          checksAttempted++;
          const checkRes = await bot.verifyAoICorrectness();
          if (checkRes.ran) {
            checksRun++;
            if (!checkRes.ok) {
              totalDesyncs++;
              console.log(`[soak desync] bot=${bot.id} diff=${checkRes.diff}`);
            }
          } else {
            console.log(`[soak check not run] bot=${bot.id} isConnected=${bot.isConnected} error=${checkRes.error}`);
          }
        }

        // Resume bot brains to continue soak
        for (const brain of this.brains) brain.start();
      }
    }

    // Stop bot movements and allow in-flight network packets to drain
    for (const brain of this.brains) brain.stop();
    for (const bot of this.bots) bot.flushOutboundQueue();
    await new Promise((r) => setTimeout(r, 800));

    // If any bot was disconnected (e.g. reconnector mid-pause), reconnect before final check
    for (const bot of this.bots) {
      if (!bot.isConnected) {
        try {
          await bot.connect();
        } catch {}
      }
    }

    // Flush inbound queues on all bots so all delivered frames are processed into replicas
    for (const bot of this.bots) bot.flushInboundQueue();

    // Final drain correctness check across all bots
    for (const bot of this.bots) {
      checksAttempted++;
      const checkRes = await bot.verifyAoICorrectness();
      if (checkRes.ran) {
        checksRun++;
        if (!checkRes.ok) {
          totalDesyncs++;
          console.log(`[final desync] bot=${bot.id} diff=${checkRes.diff}`);
        }
      } else {
        console.log(`[final check not run] bot=${bot.id} isConnected=${bot.isConnected} error=${checkRes.error}`);
      }
    }

    // 4. Fetch server metrics
    const metricsRes = await fetch(`${this.httpUrl}/metrics`);
    const metrics = (await metricsRes.json()) as any;

    // 5. Aggregate bot stats
    let allRtts: number[] = [];
    let totalRejects = 0;
    let totalBytesIn = 0;
    let clientKbps: number[] = [];

    for (const bot of this.bots) {
      allRtts.push(...bot.stats.rttSamples);
      totalRejects += bot.stats.rejectsReceived;
      totalBytesIn += bot.stats.bytesReceived;
      const kbps = bot.stats.bytesReceived / Math.max(1, durationSec) / 1024;
      clientKbps.push(kbps);
    }

    allRtts.sort((a, b) => a - b);
    const p50Rtt = allRtts.length > 0 ? +allRtts[Math.floor(allRtts.length * 0.5)].toFixed(1) : 0;
    const p95Rtt = allRtts.length > 0 ? +allRtts[Math.floor(allRtts.length * 0.95)].toFixed(1) : 0;
    const p99Rtt = allRtts.length > 0 ? +allRtts[Math.floor(allRtts.length * 0.99)].toFixed(1) : 0;

    clientKbps.sort((a, b) => a - b);
    const avgKbPerSec = +(totalBytesIn / count / Math.max(1, durationSec) / 1024).toFixed(2);
    const p95KbPerSec = clientKbps.length > 0 ? +clientKbps[Math.floor(clientKbps.length * 0.95)].toFixed(2) : 0;

    const p99Tick = metrics.tickDuration.p99Ms;
    const tickOverruns = Math.max(0, (metrics.tickDuration.tickOverruns || 0) - initialTickOverruns);
    const checksRunPct = checksAttempted > 0 ? (checksRun / checksAttempted) * 100 : 0;

    // Spec criteria:
    // 1. desyncs == 0
    // 2. tick p99 <= 10ms
    // 3. RTT p95 < 150ms
    // 4. bandwidth p95 < 5 KB/s
    // 5. tickOverruns == 0
    // 6. checksRun >= 90% (fail closed gate)
    const passed =
      checksRunPct >= 90.0 &&
      totalDesyncs === 0 &&
      p99Tick <= 10 &&
      p95Rtt < 150 &&
      p95KbPerSec < 5.0 &&
      tickOverruns === 0;

    return {
      scenarioName: 'Traffic & AoI Validation',
      passed,
      durationSec,
      botCount: count,
      desyncs: totalDesyncs,
      rejects: totalRejects,
      checksAttempted,
      checksRun,
      p50RttMs: p50Rtt,
      p95RttMs: p95Rtt,
      p99RttMs: p99Rtt,
      serverTickAvgMs: metrics.tickDuration.avgMs,
      serverTickP99Ms: p99Tick,
      tickOverruns,
      avgBandwidthKbPerSec: avgKbPerSec,
      p95BandwidthKbPerSec: p95KbPerSec,
      details: [
        `Checks run: ${checksRun}/${checksAttempted} (${checksRunPct.toFixed(1)}%) - gate >=90%`,
        `Desyncs: ${totalDesyncs} - gate 0`,
        `Server Tick P99: ${p99Tick}ms - gate <=10ms`,
        `Client RTT P95: ${p95Rtt}ms - gate <150ms`,
        `Bandwidth P95: ${p95KbPerSec} KB/s, Avg: ${avgKbPerSec} KB/s - gate <5 KB/s`,
        `Tick overruns: ${tickOverruns} - gate 0`,
      ],
    };
  }

  /**
   * Scenario: Reconnect Storm
   * Drops all bot connections simultaneously and verifies 100% resume at correct positions.
   * Compares position from new WELCOME with previous position and confirms via /debug/aoi.
   */
  async runReconnectStorm(count = 30): Promise<ScenarioResult> {
    console.log(`\n▶ Starting Scenario: RECONNECT STORM (${count} bots)`);
    this.stopAll();

    for (let i = 0; i < count; i++) {
      this.createBot(i, 'roamer', 'good');
    }

    for (const bot of this.bots) {
      await bot.registerAndLogin();
      await bot.connect();
    }

    // Record last positions prior to disconnect
    const positions = new Map<string, { x: number; y: number }>();
    for (const bot of this.bots) {
      positions.set(bot.id, { x: bot.x, y: bot.y });
      bot.disconnect();
    }

    // Wait 2 seconds (within ghost grace period)
    await new Promise((r) => setTimeout(r, 2000));

    // Reconnect all bots and verify resume position & /debug/aoi
    let resumedCount = 0;
    let matchingPosCount = 0;
    let aoiConfirmedCount = 0;
    let checksAttempted = 0;
    let checksRun = 0;

    for (const bot of this.bots) {
      try {
        await bot.connect();
        resumedCount++;

        const prev = positions.get(bot.id);
        if (prev && bot.x === prev.x && bot.y === prev.y) {
          matchingPosCount++;
        }
      } catch {}
    }

    // Allow in-flight reconnect ENTER frames to settle across all bots
    await new Promise((r) => setTimeout(r, 400));
    for (const bot of this.bots) bot.flushInboundQueue();

    // Confirm all reconnected bots via /debug/aoi
    for (const bot of this.bots) {
      if (bot.isConnected) {
        checksAttempted++;
        const aoiRes = await bot.verifyAoICorrectness();
        if (aoiRes.ran) {
          checksRun++;
          if (aoiRes.ok) {
            aoiConfirmedCount++;
          }
        }
      }
    }

    const passed =
      resumedCount === count &&
      matchingPosCount === count &&
      aoiConfirmedCount === count;

    return {
      scenarioName: 'Reconnect Storm',
      passed,
      durationSec: 5,
      botCount: count,
      desyncs: count - matchingPosCount,
      rejects: 0,
      checksAttempted,
      checksRun,
      p50RttMs: 0,
      p95RttMs: 0,
      p99RttMs: 0,
      serverTickAvgMs: 0,
      serverTickP99Ms: 0,
      tickOverruns: 0,
      avgBandwidthKbPerSec: 0,
      p95BandwidthKbPerSec: 0,
      details: [
        `Resumed: ${resumedCount}/${count}`,
        `Exact position match: ${matchingPosCount}/${count}`,
        `AoI confirmed: ${aoiConfirmedCount}/${count}`,
        `Checks run: ${checksRun}/${checksAttempted}`,
      ],
    };
  }

  // ── Canary Fault Injection Scenarios ───────────────────────────────────

  /**
   * Canary 1: Drop LEAVE packet / ghost entity in replica. Must produce desync and FAIL.
   */
  async runCanaryDropLeave(): Promise<ScenarioResult> {
    console.log(`\n▶ Starting Canary: DROP LEAVE (Fault Injection)`);
    this.stopAll();

    const bot0 = this.createBot(0, 'afk', 'good');
    await bot0.registerAndLogin();
    await bot0.connect();
    await new Promise((r) => setTimeout(r, 300));

    // bot0 drops LEAVE / retains a ghost entity in its local replica
    bot0.dropLeaveCanary = true;
    bot0.visibleReplica.set(99999, { x: bot0.x + 1, y: bot0.y + 1 });

    // verifyAoICorrectness on bot0: local replica has phantom ghost entity not on server
    const check = await bot0.verifyAoICorrectness();
    const passed = check.ran && check.ok;

    return {
      scenarioName: 'Canary: Drop LEAVE',
      passed,
      durationSec: 1,
      botCount: 1,
      desyncs: passed ? 0 : 1,
      rejects: 0,
      checksAttempted: 1,
      checksRun: check.ran ? 1 : 0,
      p50RttMs: 0,
      p95RttMs: 0,
      p99RttMs: 0,
      serverTickAvgMs: 0,
      serverTickP99Ms: 0,
      tickOverruns: 0,
      avgBandwidthKbPerSec: 0,
      p95BandwidthKbPerSec: 0,
      details: [
        `Result: ${passed ? 'Unexpected PASS' : 'Expected FAIL (Ghost entity in replica)'}`,
        `Diff: ${check.diff || 'none'}`,
      ],
    };
  }

  /**
   * Canary 2: Drop MOVE packet. Must produce desync and FAIL.
   */
  async runCanaryDropMove(): Promise<ScenarioResult> {
    console.log(`\n▶ Starting Canary: DROP MOVE (Fault Injection)`);
    this.stopAll();

    const bot0 = this.createBot(0, 'afk', 'good');
    const bot1 = this.createBot(1, 'afk', 'good');

    await bot0.registerAndLogin();
    await bot0.connect();
    await bot1.registerAndLogin();
    await bot1.connect();

    await new Promise((r) => setTimeout(r, 400));

    // bot0 will drop MOVE events
    bot0.dropMoveCanary = true;

    // bot1 moves a step
    bot1.sendMove(DIR.RIGHT);
    await new Promise((r) => setTimeout(r, 600));

    // bot0 checks replica: bot1 x/y should be stale
    const check = await bot0.verifyAoICorrectness();
    const passed = check.ran && check.ok;

    return {
      scenarioName: 'Canary: Drop MOVE',
      passed,
      durationSec: 1,
      botCount: 2,
      desyncs: passed ? 0 : 1,
      rejects: 0,
      checksAttempted: 1,
      checksRun: check.ran ? 1 : 0,
      p50RttMs: 0,
      p95RttMs: 0,
      p99RttMs: 0,
      serverTickAvgMs: 0,
      serverTickP99Ms: 0,
      tickOverruns: 0,
      avgBandwidthKbPerSec: 0,
      p95BandwidthKbPerSec: 0,
      details: [
        `Result: ${passed ? 'Unexpected PASS' : 'Expected FAIL'}`,
        `Diff: ${check.diff || 'none'}`,
      ],
    };
  }

  /**
   * Canary 3: Send wrong coordinates / corrupted position. Must produce desync and FAIL.
   */
  async runCanaryWrongCoords(): Promise<ScenarioResult> {
    console.log(`\n▶ Starting Canary: WRONG COORDINATES (Fault Injection)`);
    this.stopAll();

    const bot0 = this.createBot(0, 'afk', 'good');
    await bot0.registerAndLogin();
    await bot0.connect();
    await new Promise((r) => setTimeout(r, 300));

    // Corrupt position
    bot0.corruptPositionCanary = true;

    const check = await bot0.verifyAoICorrectness();
    const passed = check.ran && check.ok;

    return {
      scenarioName: 'Canary: Wrong Coordinates',
      passed,
      durationSec: 1,
      botCount: 1,
      desyncs: passed ? 0 : 1,
      rejects: 0,
      checksAttempted: 1,
      checksRun: check.ran ? 1 : 0,
      p50RttMs: 0,
      p95RttMs: 0,
      p99RttMs: 0,
      serverTickAvgMs: 0,
      serverTickP99Ms: 0,
      tickOverruns: 0,
      avgBandwidthKbPerSec: 0,
      p95BandwidthKbPerSec: 0,
      details: [
        `Result: ${passed ? 'Unexpected PASS' : 'Expected FAIL'}`,
        `Diff: ${check.diff || 'none'}`,
      ],
    };
  }

  /**
   * Canary 4: Break reconnect. Must reject and produce FAIL.
   */
  async runCanaryBreakReconnect(): Promise<ScenarioResult> {
    console.log(`\n▶ Starting Canary: BREAK RECONNECT (Fault Injection)`);
    this.stopAll();

    const bot0 = this.createBot(0, 'afk', 'good');
    await bot0.registerAndLogin();
    await bot0.connect();
    await new Promise((r) => setTimeout(r, 300));

    bot0.disconnect();
    await new Promise((r) => setTimeout(r, 1000));

    // Inject break reconnect
    bot0.breakReconnectCanary = true;
    let connectSucceeded = false;
    try {
      await bot0.connect();
      connectSucceeded = true;
    } catch {
      connectSucceeded = false;
    }

    const passed = connectSucceeded;

    return {
      scenarioName: 'Canary: Break Reconnect',
      passed,
      durationSec: 1,
      botCount: 1,
      desyncs: passed ? 0 : 1,
      rejects: 0,
      checksAttempted: 1,
      checksRun: 0, // Connection failed, check could not run
      p50RttMs: 0,
      p95RttMs: 0,
      p99RttMs: 0,
      serverTickAvgMs: 0,
      serverTickP99Ms: 0,
      tickOverruns: 0,
      avgBandwidthKbPerSec: 0,
      p95BandwidthKbPerSec: 0,
      details: [
        `Result: ${passed ? 'Unexpected PASS' : 'Expected FAIL (WebSocket Rejected)'}`,
      ],
    };
  }

  printReport(results: ScenarioResult[]): void {
    console.log('\n══════════════════════════════════════════════════════════════════');
    console.log('              THE HEIST: BOT HARNESS REPORT                       ');
    console.log('══════════════════════════════════════════════════════════════════');

    for (const res of results) {
      const status = res.passed ? '✅ PASS' : '❌ FAIL';
      console.log(`\n[${status}] ${res.scenarioName}`);
      console.log(`  Duration:             ${res.durationSec}s`);
      console.log(`  Bot Count:            ${res.botCount}`);
      console.log(`  Checks Run:           ${res.checksRun}/${res.checksAttempted}`);
      console.log(`  Desyncs:              ${res.desyncs}`);
      console.log(`  MOVE-to-ACK RTT (p95): ${res.p95RttMs} ms`);
      console.log(`  Server Tick (p99):    ${res.serverTickP99Ms} ms`);
      console.log(`  Bandwidth (p95):      ${res.p95BandwidthKbPerSec} KB/s`);
      console.log(`  Tick Overruns:        ${res.tickOverruns}`);
      for (const d of res.details) {
        console.log(`  * ${d}`);
      }
    }
    console.log('\n══════════════════════════════════════════════════════════════════\n');
  }
}
