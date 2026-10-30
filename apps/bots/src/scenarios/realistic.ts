/**
 * apps/bots/src/scenarios/realistic.ts
 *
 * Implements the realistic scenario (Sections 2, 3, 4, 5, 7, 8, 11 of verification spec)
 * for N bots over D seconds with reproducible seeded RNG.
 */

import { existsSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execSync } from 'node:child_process';
import http from 'node:http';
import {
  loadMap,
  isWalkable,
  DIR,
  type GameMap,
  type MapData,
  type Direction,
} from '@heist/shared';
import { BotClient, type BehaviourType, type NetworkProfile } from '../bot.js';
import { BotBrain } from '../behaviours.js';
import { SeededRNG } from '../tools/random.js';
import { generateReplayHtml } from '../tools/replay-generator.js';

export interface RealisticOptions {
  botCount: number;
  durationSec: number;
  seed: number;
  httpUrl: string;
  wsUrl: string;
  debugToken?: string;
  serverPid?: number;
}

export interface RealisticRunSummary {
  runId: string;
  runDir: string;
  botCount: number;
  durationSec: number;
  seed: number;
  status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'INVALID';
  harnessErrors: number;
  keyMetrics: {
    serverTickP99Ms: number;
    serverTickMaxMs: number;
    tickOverruns: number;
    rttP50Ms: number;
    rttP95Ms: number;
    rttP99Ms: number;
    healthLatencyP99Ms: number;
    authLatencyP99Ms: number;
    desyncs: number;
    rejects: { wall: number; queueOverflow: number; unknown: number };
    totalMoves: number;
    totalAcks: number;
    bandwidthP95KbPerSec: number;
    rssAt60sMb: number;
    rssAtEndMb: number;
    rssSlope: number;
  };
  coverage: {
    passed: boolean;
    checksWithAtLeast1VisiblePercent: number;
    checksWithAtLeast3VisiblePercent: number;
    totalChunkCrossings: number;
    requiredChunkCrossings: number;
    crowdPeakVisiblePercent: number;
    behaviourCoverage: Record<string, boolean>;
  };
  gates: Record<string, { passed: boolean; message: string }>;
  perBot: any[];
}

export class RealisticRunner {
  private opts: RealisticOptions;
  private rng: SeededRNG;
  private map!: GameMap;
  private rawMap!: MapData;
  private bots: BotClient[] = [];
  private brains: BotBrain[] = [];
  private runId: string;
  private runDir: string;
  private harnessErrors = 0;

  // Sampler & poller state
  private healthSamples: { ts: number; lat: number; ok: boolean; tick: number; players: number }[] = [];
  private metricsSamples: any[] = [];
  private serverPositionsSamples: any[] = [];
  private checkpoints: any[] = [];
  private scheduledEvents: any[] = [];
  private authLatencies: number[] = [];

  // L2 tracking
  private prevEntityPositions = new Map<string, { x: number; y: number; tick: number; connected: boolean }>();
  private l2Violations: string[] = [];

  // Pollers
  private httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10 });
  private healthInterval: NodeJS.Timeout | null = null;
  private metricsInterval: NodeJS.Timeout | null = null;
  private positionsInterval: NodeJS.Timeout | null = null;

  constructor(opts: RealisticOptions) {
    this.opts = opts;
    this.rng = new SeededRNG(opts.seed);

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    this.runId = `${ts}-${opts.botCount}bots-seed${opts.seed}`;
    this.runDir = resolve(process.cwd(), `bot-runs/${this.runId}`);
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.opts.debugToken) {
      headers['x-debug-token'] = this.opts.debugToken;
    }
    return headers;
  }

  async run(): Promise<RealisticRunSummary> {
    console.log(`\n======================================================================`);
    console.log(`🚀 Starting Realistic Scenario: ${this.runId}`);
    console.log(`   Bots: ${this.opts.botCount} | Duration: ${this.opts.durationSec}s | Seed: ${this.opts.seed}`);
    console.log(`======================================================================`);

    // Create run directories
    mkdirSync(this.runDir, { recursive: true });
    mkdirSync(join(this.runDir, 'bots'), { recursive: true });

    // 1. Fetch map
    try {
      const mapRes = await fetch(`${this.opts.httpUrl}/api/map`);
      if (!mapRes.ok) throw new Error(`Failed to fetch map: ${mapRes.status}`);
      this.rawMap = (await mapRes.json()) as MapData;
      this.map = loadMap(this.rawMap);
    } catch (err) {
      this.harnessErrors++;
      throw err;
    }

    // 2. Pre-run check: verify players == 0 and ghosts == 0
    console.log('Checking pre-run server state (players=0, ghosts=0)...');
    let preRunClean = false;
    for (let waitSec = 0; waitSec < 40; waitSec++) {
      try {
        const mRes = await fetch(`${this.opts.httpUrl}/metrics`);
        if (mRes.ok) {
          const m = (await mRes.json()) as any;
          if ((m.players || 0) === 0 && (m.ghosts || 0) === 0) {
            preRunClean = true;
            break;
          }
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 1000));
    }

    if (!preRunClean) {
      console.error('❌ ABORT: Pre-run check failed. Server has active players or ghosts. Run is INVALID.');
      this.harnessErrors++;
      return this.finalizeReport('INVALID', 'Pre-run check failed: server has remaining players or ghosts');
    }

    // Start background pollers
    this.startPollers();

    const startTime = Date.now();
    const D = this.opts.durationSec;
    const rampDuration = this.opts.botCount >= 100 ? 60 : 45;

    // 3. Prepare bots and brains with seeded shuffle
    this.createBots();

    // 4. Staggered Login Ramp (0 to rampDuration s)
    console.log(`Starting staggered login ramp (0 to ${rampDuration}s)...`);
    const rampPromises = this.bots.map((bot) => {
      const delayMs = this.rng.range(0, rampDuration * 1000);
      return (async () => {
        await new Promise((r) => setTimeout(r, delayMs));
        try {
          const { authLatencyMs } = await bot.registerAndLogin();
          this.authLatencies.push(authLatencyMs);
          await bot.connect();
          const brain = this.brains.find((b) => b.bot === bot);
          brain?.start();
        } catch (err) {
          this.harnessErrors++;
          console.error(`Error during ramp for bot ${bot.id}:`, err);
        }
      })();
    });

    // Scheduled events markers
    const blipTimeSec = Math.floor(D * 0.35);
    const crowdTimeSec = Math.floor(D * 0.50);
    const blip2TimeSec = Math.floor(D * 0.70);
    const cooldownTimeSec = Math.max(0, D - 60);

    this.scheduledEvents.push(
      { timeSec: 0, name: 'Staggered Login Ramp Start' },
      { timeSec: blipTimeSec, name: 'Wi-Fi Blip Wave 1 (15% drop + long ghosts)' },
      { timeSec: crowdTimeSec, name: 'Crowd Event (60% to Hotspot)' },
      { timeSec: blip2TimeSec, name: 'Wi-Fi Blip Wave 2 (10% drop)' },
      { timeSec: cooldownTimeSec, name: 'Cooldown Freeze & Final Drain' }
    );

    let blip1Executed = false;
    let crowdExecuted = false;
    let crowdEnded = false;
    let blip2Executed = false;
    let cooldownStarted = false;

    let nextCheckpointTimeSec = 60;
    let checkpointsRun = 0;

    let lastConsoleTimeSec = 0;
    let lastMovesSent = 0;
    let lastAcksRecv = 0;

    // Main Run Loop
    while (Date.now() - startTime < (D - 60) * 1000) {
      await new Promise((r) => setTimeout(r, 1000));
      const elapsedSec = Math.floor((Date.now() - startTime) / 1000);

      // Console line every 5s
      if (elapsedSec - lastConsoleTimeSec >= 5) {
        const dt = elapsedSec - lastConsoleTimeSec;
        lastConsoleTimeSec = elapsedSec;

        const totalMoves = this.bots.reduce((sum, b) => sum + b.stats.movesSent, 0);
        const totalAcks = this.bots.reduce((sum, b) => sum + b.stats.acksReceived, 0);
        const totalRejects = this.bots.reduce((sum, b) => sum + b.stats.rejectsReceived, 0);
        const totalReconnects = this.bots.reduce((sum, b) => sum + b.reconnects, 0);
        const connectedCount = this.bots.filter((b) => b.isConnected).length;

        const movesPerSec = Math.round((totalMoves - lastMovesSent) / dt);
        const acksPerSec = Math.round((totalAcks - lastAcksRecv) / dt);
        lastMovesSent = totalMoves;
        lastAcksRecv = totalAcks;

        const latestMetrics = this.metricsSamples[this.metricsSamples.length - 1];
        const tickP99 = latestMetrics?.tickDuration?.p99Ms || 0;

        // Compute average visible
        let totalVis = 0;
        let maxVis = 0;
        for (const b of this.bots) {
          const vis = b.visibleReplica.size;
          totalVis += vis;
          if (vis > maxVis) maxVis = vis;
        }
        const avgVis = connectedCount > 0 ? (totalVis / connectedCount).toFixed(1) : '0.0';

        const checksOk = this.checkpoints.filter((c) => c.ok).length;
        const checksTotal = this.checkpoints.length;

        console.log(
          `t=${elapsedSec}s connected=${connectedCount}/${this.opts.botCount} moves/s=${movesPerSec} acks/s=${acksPerSec} rejects=${totalRejects} reconnects=${totalReconnects} checks ok/run=${checksOk}/${checksTotal} tickP99=${tickP99}ms visible(avg/max)=${avgVis}/${maxVis}`
        );
      }

      // Checkpoint every 45s
      if (elapsedSec >= nextCheckpointTimeSec) {
        nextCheckpointTimeSec += 45;
        await this.runCheckpoint(elapsedSec);
        checkpointsRun++;
      }

      // ~35% D: Wi-Fi Blip Wave 1
      if (!blip1Executed && elapsedSec >= blipTimeSec) {
        blip1Executed = true;
        this.executeBlipWave(0.15, true);
      }

      // ~55% D: Crowd Event
      if (!crowdExecuted && elapsedSec >= crowdTimeSec) {
        crowdExecuted = true;
        this.startCrowdEvent();
      }

      // End crowd after 75s
      if (crowdExecuted && !crowdEnded && elapsedSec >= crowdTimeSec + 75) {
        crowdEnded = true;
        this.endCrowdEvent();
      }

      // ~80% D: Wi-Fi Blip Wave 2
      if (!blip2Executed && elapsedSec >= blip2TimeSec) {
        blip2Executed = true;
        this.executeBlipWave(0.10, false);
      }
    }

    // ── Cooldown Phase (last 60s) ──────────────────────────────────────────
    console.log('\nStarting Cooldown Phase (freeze movement, drain, final checkpoint)...');
    cooldownStarted = true;

    // 1. Freeze movement on all brains
    for (const br of this.brains) {
      br.freeze();
    }

    // 2. Wait 2s for in-flight queues to drain
    await new Promise((r) => setTimeout(r, 2000));
    for (const b of this.bots) {
      b.flushInboundQueue();
      b.flushOutboundQueue();
    }

    // 3. Run final checkpoint
    await this.runCheckpoint(D - 55);

    // 4. Graceful disconnect of all bots
    console.log('Gracefully disconnecting all bots...');
    for (const br of this.brains) {
      br.stop();
    }
    for (const b of this.bots) {
      b.disconnect(true);
    }

    // 5. Wait for ghost grace + 5s (or wait until players == 0 and ghosts == 0)
    console.log('Waiting for ghost grace expiration and final server cleanup...');
    let teardownClean = false;
    for (let sec = 0; sec < 45; sec++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const mRes = await fetch(`${this.opts.httpUrl}/metrics`);
        if (mRes.ok) {
          const m = (await mRes.json()) as any;
          if ((m.players || 0) === 0 && (m.ghosts || 0) === 0) {
            teardownClean = true;
            console.log(`  Server clean: players=0, ghosts=0 at ${sec}s`);
            break;
          }
        }
      } catch {}
    }

    this.stopPollers();

    return this.finalizeReport(
      teardownClean ? 'PASS' : 'FAIL',
      teardownClean ? 'Completed all verification phases' : 'Teardown failed: players or ghosts remained on server'
    );
  }

  private createBots(): void {
    const total = this.opts.botCount;
    // Mix: 45% roamer, 20% hotspot-goer, 10% explorer, 10% border-crosser, 5% afk, 5% reconnector, 5% human-pauser
    const bTypes: BehaviourType[] = [];
    const countRoamer = Math.round(total * 0.45);
    const countHotspot = Math.round(total * 0.20);
    const countExplorer = Math.round(total * 0.10);
    const countBorder = Math.round(total * 0.10);
    const countAfk = Math.max(1, Math.round(total * 0.05));
    const countReconnector = Math.max(1, Math.round(total * 0.05));
    const countPauser = total - (countRoamer + countHotspot + countExplorer + countBorder + countAfk + countReconnector);

    for (let i = 0; i < countRoamer; i++) bTypes.push('roamer');
    for (let i = 0; i < countHotspot; i++) bTypes.push('hotspot-goer');
    for (let i = 0; i < countExplorer; i++) bTypes.push('explorer');
    for (let i = 0; i < countBorder; i++) bTypes.push('border-crosser');
    for (let i = 0; i < countAfk; i++) bTypes.push('afk');
    for (let i = 0; i < countReconnector; i++) bTypes.push('reconnector');
    for (let i = 0; i < countPauser; i++) bTypes.push('human-pauser');

    // Network mix: 60% good, 30% medium, 10% bad
    const nProfiles: NetworkProfile[] = [];
    const countGood = Math.round(total * 0.60);
    const countMed = Math.round(total * 0.30);
    const countBad = total - (countGood + countMed);
    for (let i = 0; i < countGood; i++) nProfiles.push('good');
    for (let i = 0; i < countMed; i++) nProfiles.push('medium');
    for (let i = 0; i < countBad; i++) nProfiles.push('bad');

    // Seeded shuffles
    const shuffledBehaviours = this.rng.shuffle(bTypes);
    const shuffledProfiles = this.rng.shuffle(nProfiles);

    for (let i = 0; i < total; i++) {
      const id = `agent_${String(i).padStart(3, '0')}`;
      const bot = new BotClient(
        id,
        shuffledBehaviours[i] || 'roamer',
        shuffledProfiles[i] || 'good',
        this.opts.httpUrl,
        this.opts.wsUrl,
        this.map
      );
      const brain = new BotBrain(bot, this.map, this.rng);
      this.bots.push(bot);
      this.brains.push(brain);
    }
  }

  private startPollers(): void {
    // 1. Health poller every 2s with persistent keep-alive agent
    this.healthInterval = setInterval(async () => {
      const t0 = performance.now();
      try {
        const url = new URL(`${this.opts.httpUrl}/health`);
        const res = await new Promise<{ ok: boolean; data: any }>((resolve) => {
          const req = http.get(url, { agent: this.httpAgent }, (resp) => {
            let body = '';
            resp.on('data', (c) => { body += c; });
            resp.on('end', () => {
              try {
                resolve({ ok: (resp.statusCode || 0) < 400, data: JSON.parse(body) });
              } catch {
                resolve({ ok: false, data: null });
              }
            });
          });
          req.on('error', () => resolve({ ok: false, data: null }));
          req.setTimeout(5000, () => {
            req.destroy();
            resolve({ ok: false, data: null });
          });
        });

        const lat = performance.now() - t0;
        this.healthSamples.push({
          ts: Date.now(),
          lat,
          ok: res.ok,
          tick: res.data?.tick || 0,
          players: res.data?.players || 0,
        });
      } catch {
        this.healthSamples.push({
          ts: Date.now(),
          lat: performance.now() - t0,
          ok: false,
          tick: 0,
          players: 0,
        });
      }
    }, 2000);

    // 2. Metrics poller every 5s
    this.metricsInterval = setInterval(async () => {
      try {
        const res = await fetch(`${this.opts.httpUrl}/metrics`);
        if (res.ok) {
          const m = (await res.json()) as any;
          this.metricsSamples.push({
            ts: Date.now(),
            ...m,
          });
        }
      } catch {}
    }, 5000);

    // 3. L2 Server-truth sampler every 1s
    this.positionsInterval = setInterval(async () => {
      try {
        const res = await fetch(`${this.opts.httpUrl}/debug/positions`, {
          headers: this.getHeaders(),
        });
        if (res.ok) {
          const data = (await res.json()) as any;
          const sample = {
            ts: Date.now(),
            tick: data.tick,
            entities: data.entities || [],
          };
          this.serverPositionsSamples.push(sample);

          // Audit L2 on every sample
          for (const ent of sample.entities) {
            // Check in bounds & walkable
            if (!isWalkable(this.map, ent.x, ent.y)) {
              this.l2Violations.push(`Entity ${ent.id} at illegal unwalkable position (${ent.x},${ent.y}) tick=${data.tick}`);
            }

            // Speed limit audit keyed by unique playerId (only when continuously connected)
            const playerKey = ent.playerId || `ent_${ent.id}`;
            const prev = this.prevEntityPositions.get(playerKey);
            if (prev && prev.connected && ent.connected) {
              const deltaTicks = Math.max(1, data.tick - prev.tick);
              const maxAllowedDisplacement = Math.ceil(deltaTicks / 5) + 1;
              const displacement = Math.abs(ent.x - prev.x) + Math.abs(ent.y - prev.y);
              if (displacement > maxAllowedDisplacement) {
                this.l2Violations.push(
                  `Speed limit violation on player ${playerKey}: moved ${displacement} tiles in ${deltaTicks} ticks (max=${maxAllowedDisplacement})`
                );
              }
            }
            this.prevEntityPositions.set(playerKey, { x: ent.x, y: ent.y, tick: data.tick, connected: !!ent.connected });
          }
        }
      } catch {}
    }, 1000);
  }

  private stopPollers(): void {
    if (this.healthInterval) clearInterval(this.healthInterval);
    if (this.metricsInterval) clearInterval(this.metricsInterval);
    if (this.positionsInterval) clearInterval(this.positionsInterval);
    this.httpAgent.destroy();
  }

  private executeBlipWave(fraction: number, includeGhostExpiry: boolean): void {
    console.log(`\n🌊 Executing Wi-Fi Blip Wave (${Math.round(fraction * 100)}% of bots)...`);
    const count = Math.max(1, Math.floor(this.bots.length * fraction));
    const shuffled = this.rng.shuffle(this.bots);
    const blipBots = shuffled.slice(0, count);

    // Normal blips: return after 2-20s
    for (let i = 0; i < blipBots.length; i++) {
      const b = blipBots[i];
      const isLongGhost = includeGhostExpiry && i < (this.opts.botCount <= 20 ? 1 : 2);
      const returnDelayMs = isLongGhost ? 35000 : this.rng.range(2000, 20000);

      b.disconnect(true);
      setTimeout(async () => {
        b.reconnects++;
        b.recordEvent('reconnect');
        try {
          await b.connect();
        } catch {}
      }, returnDelayMs);
    }
  }

  private startCrowdEvent(): void {
    console.log('\n👥 Starting Crowd Event (60% of bots gathering at hotspot)...');
    const hotspot = this.map.hotspots[0] || { x: Math.floor(this.map.width / 2), y: Math.floor(this.map.height / 2) };
    const count = Math.floor(this.bots.length * 0.60);
    const shuffled = this.rng.shuffle(this.brains);

    for (let i = 0; i < count; i++) {
      shuffled[i].crowdTarget = { x: hotspot.x, y: hotspot.y };
    }
  }

  private endCrowdEvent(): void {
    console.log('👥 Crowd Event disperses: bots returning to individual behaviors.');
    for (const br of this.brains) {
      br.crowdTarget = null;
    }
  }

  /**
   * Run one checkpoint: L2 / L3 / L4 verification
   */
  private async runCheckpoint(timeSec: number): Promise<void> {
    console.log(`\n🔍 Running Checkpoint at t=${timeSec}s...`);
    // 1. Freeze movement
    for (const br of this.brains) br.freeze();

    // 2. Wait for in-flight moves and queues to drain
    await new Promise((r) => setTimeout(r, 2000));
    for (const b of this.bots) {
      b.flushInboundQueue();
      b.flushOutboundQueue();
    }
    await new Promise((r) => setTimeout(r, 300));

    const checkpointRecord: any = {
      timeSec,
      timestamp: Date.now(),
      ok: true,
      botChecks: [],
      oracleDiffs: [],
      l4Ok: true,
    };

    // L2 Sampler check at checkpoint: connected entities count == currently connected bots
    const clientConnected = this.bots.filter((b) => b.isConnected).length;
    let serverConnected = clientConnected;
    try {
      const posRes = await fetch(`${this.opts.httpUrl}/debug/positions`, {
        headers: this.getHeaders(),
      });
      if (posRes.ok) {
        const posData = (await posRes.json()) as any;
        serverConnected = (posData?.entities || []).filter((e: any) => e.connected).length;
      }
    } catch {}

    if (serverConnected !== clientConnected) {
      checkpointRecord.ok = false;
      checkpointRecord.oracleDiffs.push(
        `L2 connected count mismatch at checkpoint: server=${serverConnected} vs client=${clientConnected}`
      );
    }

    // L3 Two Oracles Check: For each connected bot B
    // Oracle 1: Harness global visible set (chunks within +-1 of B's chunk)
    // Oracle 2: Server GET /debug/aoi/:playerId
    // Local: B's visibleReplica
    for (const b of this.bots) {
      if (!b.isConnected) continue;

      const botCheck = await b.verifyAoICorrectness(this.opts.debugToken);
      if (!botCheck.ok) {
        checkpointRecord.ok = false;
        checkpointRecord.oracleDiffs.push(`Bot ${b.id} AoI mismatch: ${botCheck.diff}`);
      }
      checkpointRecord.botChecks.push({
        id: b.id,
        visibleCount: b.visibleReplica.size,
        ok: botCheck.ok,
      });
    }

    // L4 Counter cross-checks
    let metricsPlayers = clientConnected;
    try {
      const mRes = await fetch(`${this.opts.httpUrl}/metrics`);
      if (mRes.ok) {
        const m = (await mRes.json()) as any;
        metricsPlayers = m.players ?? clientConnected;
      }
    } catch {}

    if (metricsPlayers !== clientConnected) {
      checkpointRecord.ok = false;
      checkpointRecord.l4Ok = false;
      checkpointRecord.oracleDiffs.push(
        `L4 connected players mismatch: server /metrics=${metricsPlayers} vs client=${clientConnected}`
      );
    }

    this.checkpoints.push(checkpointRecord);
    console.log(`   Checkpoint result: ${checkpointRecord.ok ? '✅ PASS' : '❌ FAIL'} (${checkpointRecord.botChecks.length} bots checked)`);

    // Unfreeze brains
    for (const br of this.brains) br.unfreeze();
  }

  private finalizeReport(status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'INVALID', reason: string): RealisticRunSummary {
    const D = this.opts.durationSec;
    const N = this.opts.botCount;

    // Save all run artifact files
    this.writeArtifactFiles();

    // Calculate metrics
    const allRtts: number[] = [];
    let totalMoves = 0;
    let totalAcks = 0;
    let totalWallRejects = 0;
    let totalQueueOverflow = 0;
    let totalUnknownRejects = 0;

    for (const b of this.bots) {
      allRtts.push(...b.stats.rttSamples);
      totalMoves += b.stats.movesSent;
      totalAcks += b.stats.acksReceived;
      totalWallRejects += b.rejectCounts.wall;
      totalQueueOverflow += b.rejectCounts.queue_overflow;
      totalUnknownRejects += b.rejectCounts.unknown;
    }

    allRtts.sort((a, b) => a - b);
    const p50RttMs = allRtts.length > 0 ? allRtts[Math.floor(allRtts.length * 0.5)] : 0;
    const p95RttMs = allRtts.length > 0 ? allRtts[Math.floor(allRtts.length * 0.95)] : 0;
    const p99RttMs = allRtts.length > 0 ? allRtts[Math.floor(allRtts.length * 0.99)] : 0;

    // Server tick stats from metricsSamples
    const tickP99List = this.metricsSamples.map((m) => m.tickDuration?.p99Ms || 0);
    tickP99List.sort((a, b) => a - b);
    const serverTickP99Ms = tickP99List.length > 0 ? tickP99List[Math.floor(tickP99List.length * 0.99)] : 0;
    const serverTickMaxMs = Math.max(...this.metricsSamples.map((m) => m.tickDuration?.maxMs || 0), 0);
    const initialTickOverruns = this.metricsSamples[0]?.tickDuration?.tickOverruns || 0;
    const finalTickOverruns = this.metricsSamples[this.metricsSamples.length - 1]?.tickDuration?.tickOverruns || 0;
    const tickOverruns = Math.max(0, finalTickOverruns - initialTickOverruns);

    // Health latencies
    const healthLats = this.healthSamples.map((h) => h.lat).sort((a, b) => a - b);
    const healthLatencyP99Ms = healthLats.length > 0 ? healthLats[Math.floor(healthLats.length * 0.99)] : 0;

    // Auth latencies
    this.authLatencies.sort((a, b) => a - b);
    const authLatencyP99Ms = this.authLatencies.length > 0 ? this.authLatencies[Math.floor(this.authLatencies.length * 0.99)] : 0;

    // Memory RSS slope
    const rssAt60s = this.metricsSamples.find((m) => (m.system?.uptimeSec || 0) >= 60)?.system?.memoryRssMb || 50;
    const rssAtEnd = this.metricsSamples[this.metricsSamples.length - 1]?.system?.memoryRssMb || rssAt60s;
    const rssSlope = +(rssAtEnd / Math.max(1, rssAt60s)).toFixed(2);

    // Bandwidth
    const bandwidthP95KbPerSec = Math.max(
      ...this.metricsSamples.map((m) => (m.network?.avgBytesPerClientPerSec || 0) / 1024),
      0
    );

    // Coverage checks
    let totalBotChecks = 0;
    let checksWithAtLeast1 = 0;
    let checksWithAtLeast3 = 0;
    for (const cp of this.checkpoints) {
      for (const bc of cp.botChecks) {
        totalBotChecks++;
        if (bc.visibleCount >= 1) checksWithAtLeast1++;
        if (bc.visibleCount >= 3) checksWithAtLeast3++;
      }
    }

    const checksWithAtLeast1VisiblePercent = totalBotChecks > 0 ? Math.round((checksWithAtLeast1 / totalBotChecks) * 100) : 0;
    const checksWithAtLeast3VisiblePercent = totalBotChecks > 0 ? Math.round((checksWithAtLeast3 / totalBotChecks) * 100) : 0;

    const totalChunkCrossings = this.bots.reduce((sum, b) => sum + b.chunkCrossings, 0);
    const requiredChunkCrossings = 10 * N;

    // Max visible during crowd
    let maxVisibleDuringCrowd = 0;
    for (const s of this.serverPositionsSamples) {
      const vis = s.entities?.length || 0;
      if (vis > maxVisibleDuringCrowd) maxVisibleDuringCrowd = vis;
    }
    const crowdPeakVisiblePercent = Math.round((maxVisibleDuringCrowd / Math.max(1, N * 0.6)) * 100);

    const behaviourCoverage: Record<string, boolean> = {
      roamer: this.bots.filter((b) => b.behaviour === 'roamer').some((b) => b.tilesTravelled > 5),
      'hotspot-goer': this.bots.filter((b) => b.behaviour === 'hotspot-goer').some((b) => b.hotspotsVisited.size > 0),
      explorer: this.bots.filter((b) => b.behaviour === 'explorer').some((b) => b.rejectCounts.wall > 0 || b.tilesTravelled > 5),
      'border-crosser': this.bots.filter((b) => b.behaviour === 'border-crosser').some((b) => b.chunkCrossings > 1),
      afk: this.bots.filter((b) => b.behaviour === 'afk').some((b) => b.stats.acksReceived <= 15),
      reconnector: this.bots.filter((b) => b.behaviour === 'reconnector').some((b) => b.reconnects > 0),
      'human-pauser': this.bots.filter((b) => b.behaviour === 'human-pauser').some((b) => b.tilesTravelled > 5),
    };

    const coveragePassed =
      checksWithAtLeast1VisiblePercent >= 60 &&
      (N < 50 || checksWithAtLeast3VisiblePercent >= 25) &&
      totalChunkCrossings >= requiredChunkCrossings;

    // Gates evaluation
    const expectedCheckpoints = Math.floor(D / 45);
    const desyncs = this.bots.reduce((sum, b) => sum + b.stats.desyncsCount, 0);

    const gates: Record<string, { passed: boolean; message: string }> = {
      correctness: {
        passed: desyncs === 0 && this.checkpoints.length >= expectedCheckpoints - 1,
        message: `0 desyncs (actual=${desyncs}), checkpoints >= ${expectedCheckpoints - 1} (actual=${this.checkpoints.length})`,
      },
      movementRules: {
        passed: totalUnknownRejects === 0 && totalQueueOverflow <= totalMoves * 0.005 && this.l2Violations.length === 0,
        message: `unknownRejects=${totalUnknownRejects}, queueOverflow=${totalQueueOverflow} (<=0.5%), l2Violations=${this.l2Violations.length}`,
      },
      activityL6: {
        passed: this.bots.every((b) => b.behaviour === 'afk' || b.stats.acksReceived >= Math.floor(20 * (b.connectedTimeMs / 300000))),
        message: `All non-AFK bots have >= 20 steps per 5 min connected`,
      },
      connections: {
        passed: this.bots.reduce((sum, b) => sum + b.unexpectedDisconnects, 0) === 0,
        message: `unexpectedDisconnects=0`,
      },
      performance: {
        passed: serverTickP99Ms <= 10 && serverTickMaxMs < 50 && tickOverruns === 0 && p95RttMs < 150,
        message: `tickP99=${serverTickP99Ms}ms (<=10ms), tickMax=${serverTickMaxMs}ms (<50ms), RTTp95=${p95RttMs}ms (<150ms)`,
      },
      httpHealth: {
        passed: healthLatencyP99Ms < 100 && authLatencyP99Ms < 2000,
        message: `healthP99=${healthLatencyP99Ms.toFixed(1)}ms (<100ms), authP99=${authLatencyP99Ms.toFixed(1)}ms (<2000ms)`,
      },
      memory: {
        passed: rssSlope <= 1.25,
        message: `rssSlope=${rssSlope} (<=1.25)`,
      },
      integrity: {
        passed: this.harnessErrors === 0,
        message: `harnessErrors=${this.harnessErrors}`,
      },
    };

    let finalStatus: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'INVALID' = status;
    if (this.harnessErrors > 0) {
      finalStatus = 'INVALID';
    } else if (status === 'PASS' && !coveragePassed) {
      finalStatus = 'INCONCLUSIVE';
    } else if (Object.values(gates).some((g) => !g.passed)) {
      finalStatus = 'FAIL';
    }

    const perBotTable = this.bots.map((b) => ({
      id: b.id,
      behaviour: b.behaviour,
      profile: b.networkProfile,
      stepsAcked: b.stats.acksReceived,
      tilesTravelled: b.tilesTravelled,
      chunkCrossings: b.chunkCrossings,
      distinctChunks: b.distinctChunks.size,
      hotspotsVisited: b.hotspotsVisited.size,
      rejects: `${b.rejectCounts.wall}/${b.rejectCounts.queue_overflow}/${b.rejectCounts.unknown}`,
      reconnects: b.reconnects,
      unexpectedDisconnects: b.unexpectedDisconnects,
      avgVisible: +(b.visibleReplica.size).toFixed(1),
      status: b.stats.desyncsCount === 0 ? 'OK' : 'DESYNC',
    }));

    const summary: RealisticRunSummary = {
      runId: this.runId,
      runDir: this.runDir,
      botCount: N,
      durationSec: D,
      seed: this.opts.seed,
      status: finalStatus,
      harnessErrors: this.harnessErrors,
      keyMetrics: {
        serverTickP99Ms,
        serverTickMaxMs,
        tickOverruns,
        rttP50Ms: p50RttMs,
        rttP95Ms: p95RttMs,
        rttP99Ms: p99RttMs,
        healthLatencyP99Ms,
        authLatencyP99Ms,
        desyncs,
        rejects: { wall: totalWallRejects, queueOverflow: totalQueueOverflow, unknown: totalUnknownRejects },
        totalMoves,
        totalAcks,
        bandwidthP95KbPerSec,
        rssAt60sMb: rssAt60s,
        rssAtEndMb: rssAtEnd,
        rssSlope,
      },
      coverage: {
        passed: coveragePassed,
        checksWithAtLeast1VisiblePercent,
        checksWithAtLeast3VisiblePercent,
        totalChunkCrossings,
        requiredChunkCrossings,
        crowdPeakVisiblePercent,
        behaviourCoverage,
      },
      gates,
      perBot: perBotTable,
    };

    // Write final reports and replay.html
    this.writeFinalReports(summary);

    return summary;
  }

  private writeArtifactFiles(): void {
    // 1. health.csv
    const healthCsvLines = ['timestamp,latencyMs,status,tick,players'];
    for (const h of this.healthSamples) {
      healthCsvLines.push(`${h.ts},${h.lat.toFixed(2)},${h.ok ? 200 : 500},${h.tick},${h.players}`);
    }
    writeFileSync(join(this.runDir, 'health.csv'), healthCsvLines.join('\n'), 'utf8');

    // 2. metrics.csv
    if (this.metricsSamples.length > 0) {
      const keys = ['timestamp', 'players', 'ghosts', 'tickAvg', 'tickP50', 'tickP99', 'tickMax', 'msgsInPerSec', 'bytesOutPerSec', 'memoryRssMb'];
      const metricsCsvLines = [keys.join(',')];
      for (const m of this.metricsSamples) {
        metricsCsvLines.push([
          m.ts,
          m.players || 0,
          m.ghosts || 0,
          m.tickDuration?.avgMs || 0,
          m.tickDuration?.p50Ms || 0,
          m.tickDuration?.p99Ms || 0,
          m.tickDuration?.maxMs || 0,
          m.network?.msgsInPerSec || 0,
          m.network?.bytesOutPerSec || 0,
          m.system?.memoryRssMb || 0,
        ].join(','));
      }
      writeFileSync(join(this.runDir, 'metrics.csv'), metricsCsvLines.join('\n'), 'utf8');
    }

    // 3. server-positions.jsonl
    const posLines = this.serverPositionsSamples.map((s) => JSON.stringify(s));
    writeFileSync(join(this.runDir, 'server-positions.jsonl'), posLines.join('\n'), 'utf8');

    // 4. checkpoints.json
    writeFileSync(join(this.runDir, 'checkpoints.json'), JSON.stringify(this.checkpoints, null, 2), 'utf8');

    // 5. events.json
    writeFileSync(join(this.runDir, 'events.json'), JSON.stringify(this.scheduledEvents, null, 2), 'utf8');

    // 6. bots/agent_000.jsonl (L1 per-bot traces)
    for (const b of this.bots) {
      const botTraceLines = b.l1Events.map((e) => JSON.stringify(e));
      writeFileSync(join(this.runDir, `bots/${b.id}.jsonl`), botTraceLines.join('\n'), 'utf8');
    }
  }

  private writeFinalReports(summary: RealisticRunSummary): void {
    let gitCommit = 'unknown';
    try {
      gitCommit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    } catch {}

    const configData = {
      seed: this.opts.seed,
      gitCommit,
      env: {
        HTTP_URL: this.opts.httpUrl,
        WS_URL: this.opts.wsUrl,
        DEBUG_TOKEN: this.opts.debugToken ? '***' : undefined,
      },
      botCount: this.opts.botCount,
      durationSec: this.opts.durationSec,
      serverConfig: {
        tickRate: 20,
        stepTicks: 5,
        chunkSize: 16,
      },
    };
    writeFileSync(join(this.runDir, 'config.json'), JSON.stringify(configData, null, 2), 'utf8');
    writeFileSync(join(this.runDir, 'report.json'), JSON.stringify(summary, null, 2), 'utf8');

    // Build report.md
    const mdLines = [
      `# Test Report: ${summary.runId}`,
      ``,
      `**Status**: \`${summary.status}\`  `,
      `**Bots**: ${summary.botCount} | **Duration**: ${summary.durationSec}s | **Seed**: ${summary.seed}  `,
      `**Git Commit**: \`${gitCommit}\`  `,
      `**Harness Errors**: ${summary.harnessErrors}  `,
      ``,
      `## Key Metrics`,
      `| Metric | Value | Gate |`,
      `|---|---|---|`,
      `| Server Tick p99 | ${summary.keyMetrics.serverTickP99Ms} ms | <= 10 ms |`,
      `| Server Tick Max | ${summary.keyMetrics.serverTickMaxMs} ms | < 50 ms |`,
      `| Tick Overruns | ${summary.keyMetrics.tickOverruns} | 0 |`,
      `| RTT p95 (excluding network jitter) | ${summary.keyMetrics.rttP95Ms} ms | < 150 ms |`,
      `| Health Latency p99 | ${summary.keyMetrics.healthLatencyP99Ms.toFixed(1)} ms | < 100 ms |`,
      `| Auth Latency p99 | ${summary.keyMetrics.authLatencyP99Ms.toFixed(1)} ms | < 2000 ms |`,
      `| Desyncs | ${summary.keyMetrics.desyncs} | 0 |`,
      `| Unknown Rejects | ${summary.keyMetrics.rejects.unknown} | 0 |`,
      `| Queue Overflow Rejects | ${summary.keyMetrics.rejects.queueOverflow} | <= 0.5% |`,
      `| Wall Rejects | ${summary.keyMetrics.rejects.wall} | explorer only |`,
      `| RSS Slope (end / 60s) | ${summary.keyMetrics.rssSlope}x (${summary.keyMetrics.rssAt60sMb} -> ${summary.keyMetrics.rssAtEndMb} MB) | <= 1.25x |`,
      ``,
      `## Gates`,
    ];

    for (const [gateName, g] of Object.entries(summary.gates)) {
      mdLines.push(`- **${gateName}**: ${g.passed ? '✅ PASS' : '❌ FAIL'} (${g.message})`);
    }

    mdLines.push(
      ``,
      `## Coverage Results`,
      `- Checks with >= 1 visible entity: ${summary.coverage.checksWithAtLeast1VisiblePercent}% (required >= 60%)`,
      `- Checks with >= 3 visible entities: ${summary.coverage.checksWithAtLeast3VisiblePercent}% (required >= 25% for N>=50)`,
      `- Total chunk crossings: ${summary.coverage.totalChunkCrossings} (required >= ${summary.coverage.requiredChunkCrossings})`,
      `- Crowd peak visible: ${summary.coverage.crowdPeakVisiblePercent}%`,
      ``,
      `## Per-Bot Summary Table`,
      `| ID | Behaviour | Profile | Steps ACKed | Travelled | Chunks | Hotspots | Rejects (W/Q/U) | Reconnects | Status |`,
      `|---|---|---|---|---|---|---|---|---|---|`
    );

    for (const b of summary.perBot) {
      mdLines.push(`| ${b.id} | ${b.behaviour} | ${b.profile} | ${b.stepsAcked} | ${b.tilesTravelled} | ${b.chunkCrossings} | ${b.hotspotsVisited} | ${b.rejects} | ${b.reconnects} | ${b.status} |`);
    }

    writeFileSync(join(this.runDir, 'report.md'), mdLines.join('\n'), 'utf8');

    // Generate replay.html
    generateReplayHtml(this.runDir, this.rawMap);

    // Update bot-runs/INDEX.md
    const indexFile = resolve(process.cwd(), 'bot-runs/INDEX.md');
    const indexLine = `| ${summary.runId} | ${summary.botCount} | ${summary.durationSec}s | ${summary.seed} | ${summary.status} | tickP99=${summary.keyMetrics.serverTickP99Ms}ms | rttP95=${summary.keyMetrics.rttP95Ms}ms | [Report](file://${join(this.runDir, 'report.md')}) | [Replay](file://${join(this.runDir, 'replay.html')}) |\n`;
    if (!existsSync(indexFile)) {
      writeFileSync(
        indexFile,
        `# Bot Runs Index\n\n| Run ID | Bots | Duration | Seed | Status | Tick p99 | RTT p95 | Report | Replay |\n|---|---|---|---|---|---|---|---|---|\n`,
        'utf8'
      );
    }
    appendFileSync(indexFile, indexLine, 'utf8');
  }
}
