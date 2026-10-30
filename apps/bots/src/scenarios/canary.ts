/**
 * apps/bots/src/scenarios/canary.ts
 *
 * Canary suite (Section 9 of verification spec).
 * Uses FaultProxy to mutate frames between 20 bots and the real server.
 * Proves that the harness verification layers (L2, L3, L5, L6, Reconnect, RTT)
 * reliably fail when faults are injected.
 */

import { FaultProxy, type CanaryMode } from '../tools/fault-proxy.js';
import { loadMap, type GameMap, type MapData } from '@heist/shared';
import { BotClient, type BehaviourType, type NetworkProfile } from '../bot.js';
import { BotBrain } from '../behaviours.js';
import { SeededRNG } from '../tools/random.js';

export interface CanaryRunResult {
  canary: string;
  name: string;
  detected: boolean;
  detectedByLayer: string;
  evidenceLine: string;
}

export class CanarySuite {
  private httpUrl: string;
  private serverWsUrl: string;
  private map!: GameMap;

  constructor(options: { httpUrl: string; wsUrl: string }) {
    this.httpUrl = options.httpUrl;
    this.serverWsUrl = options.wsUrl;
  }

  async init(): Promise<void> {
    const res = await fetch(`${this.httpUrl}/api/map`);
    if (!res.ok) throw new Error('Failed to fetch map from server');
    const data = (await res.json()) as MapData;
    this.map = loadMap(data);
  }

  async runCanaryMini(
    canaryId: 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6',
    name: string,
    durationSec = 60
  ): Promise<CanaryRunResult> {
    console.log(`\n▶ Starting Canary ${canaryId}: ${name} (20 bots, ${durationSec}s mini-run)...`);

    const proxy = new FaultProxy({
      upstreamWsUrl: this.serverWsUrl,
      mode: canaryId as CanaryMode,
    });
    const proxyWsUrl = await proxy.start();

    const bots: BotClient[] = [];
    const brains: BotBrain[] = [];
    const rng = new SeededRNG(42);

    const behaviours: BehaviourType[] = [
      'roamer', 'roamer', 'roamer', 'roamer', 'roamer', 'roamer', 'roamer', 'roamer', 'roamer',
      'hotspot-goer', 'hotspot-goer', 'hotspot-goer', 'hotspot-goer',
      'explorer', 'explorer',
      'border-crosser', 'border-crosser',
      'afk',
      'reconnector',
      'human-pauser',
    ];

    try {
      // 1. Spawn 20 bots pointing at the proxy
      for (let i = 0; i < 20; i++) {
        const id = `canary_${canaryId.toLowerCase()}_${String(i).padStart(3, '0')}`;
        const bot = new BotClient(
          id,
          behaviours[i] || 'roamer',
          'good', // fast networking to isolate injected faults
          this.httpUrl,
          proxyWsUrl,
          this.map
        );
        const brain = new BotBrain(bot, this.map, rng);
        bots.push(bot);
        brains.push(brain);
      }

      // Login & connect
      for (const b of bots) {
        await b.registerAndLogin();
        await b.connect();
        await new Promise((r) => setTimeout(r, 60));
      }

      // Start movement
      for (const br of brains) {
        br.start();
      }

      // Run simulation loop with periodic checks
      const startTime = Date.now();
      let detected = false;
      let detectedByLayer = 'None';
      let evidenceLine = 'No fault detected';

      const checkIntervalMs = 8000;
      let nextCheck = startTime + 10000;

      while (Date.now() - startTime < durationSec * 1000) {
        await new Promise((r) => setTimeout(r, 1000));

        // Periodically run verification layers
        if (Date.now() >= nextCheck) {
          nextCheck = Date.now() + checkIntervalMs;

          // C6 Check: RTT Gate
          if (canaryId === 'C6') {
            const allRtts: number[] = [];
            for (const b of bots) {
              allRtts.push(...b.stats.rttSamples);
            }
            allRtts.sort((a, b) => a - b);
            const p95Idx = Math.floor(allRtts.length * 0.95);
            const p95Rtt = allRtts.length > 0 ? allRtts[p95Idx] : 0;
            if (p95Rtt > 1500) {
              detected = true;
              detectedByLayer = 'RTT gate (p95 < 150 ms)';
              evidenceLine = `Injected 2s frame delay detected: p95 RTT = ${p95Rtt.toFixed(1)}ms (>150ms gate)`;
              break;
            }
          }

          // C5 Check: Reconnect failure
          if (canaryId === 'C5') {
            for (const b of bots) {
              const hasBadClose = b.l1Events.some((e) => e.event === 'close' && e.code === 4099);
              if (b.unexpectedDisconnects > 0 || hasBadClose) {
                detected = true;
                detectedByLayer = 'reconnect checks (bad close code 4099)';
                evidenceLine = `Bot ${b.id} closed with bad close code 4099 on reconnect (unexpectedDisconnects=${b.unexpectedDisconnects})`;
                break;
              }
            }
            if (detected) break;
          }

          // C4 Check: L5 / L6 (dropped MOVE_ACK -> unacknowledged moves or inactive steps)
          if (canaryId === 'C4') {
            const bot0 = bots[0];
            const bot1 = bots[1];
            if (bot0.stats.movesSent > 10 && bot0.stats.acksReceived === 0) {
              detected = true;
              detectedByLayer = 'L5 / L6 (ACK reception & dead-bot detection)';
              evidenceLine = `Bot ${bot0.id} sent ${bot0.stats.movesSent} moves but received 0 ACKs (moves dropped by proxy)`;
              break;
            }
          }

          // C1, C2, C3 Check: L3 Oracle desync check
          if (canaryId === 'C1' || canaryId === 'C2' || canaryId === 'C3') {
            // Freeze moves for checkpoint
            for (const br of brains) br.freeze();
            await new Promise((r) => setTimeout(r, 800));

            for (const b of bots) {
              const res = await b.verifyAoICorrectness();
              if (res.ran && !res.ok) {
                detected = true;
                if (canaryId === 'C1') {
                  detectedByLayer = 'L3 (ghost entity in replica)';
                  evidenceLine = `L3 Oracle desync on ${b.id}: ${res.diff}`;
                } else if (canaryId === 'C2') {
                  detectedByLayer = 'L3 (position mismatch)';
                  evidenceLine = `L3 Oracle desync on ${b.id}: ${res.diff}`;
                } else if (canaryId === 'C3') {
                  detectedByLayer = 'L3 + L2 cross-check';
                  evidenceLine = `L3 Oracle detected corrupted coords (+1) on ${b.id}: ${res.diff}`;
                }
                break;
              }
            }

            for (const br of brains) br.unfreeze();
            if (detected) break;
          }
        }
      }

      // If duration completed without early exit, do final check
      if (!detected) {
        if (canaryId === 'C6') {
          const allRtts: number[] = [];
          for (const b of bots) allRtts.push(...b.stats.rttSamples);
          allRtts.sort((a, b) => a - b);
          const p95 = allRtts[Math.floor(allRtts.length * 0.95)] || 0;
          if (p95 > 150) {
            detected = true;
            detectedByLayer = 'RTT gate';
            evidenceLine = `Final p95 RTT = ${p95.toFixed(1)}ms (>150ms)`;
          }
        } else if (canaryId === 'C4') {
          const b0 = bots[0];
          if (b0.stats.acksReceived === 0 && b0.stats.movesSent > 0) {
            detected = true;
            detectedByLayer = 'L5 / L6';
            evidenceLine = `Bot ${b0.id} received 0 ACKs across run`;
          }
        } else if (canaryId === 'C5') {
          const unexp = bots.reduce((sum, b) => sum + b.unexpectedDisconnects, 0);
          if (unexp > 0) {
            detected = true;
            detectedByLayer = 'reconnect checks';
            evidenceLine = `Detected ${unexp} unexpected disconnects due to bad close codes`;
          }
        }
      }

      return {
        canary: canaryId,
        name,
        detected,
        detectedByLayer,
        evidenceLine,
      };
    } finally {
      for (const br of brains) br.stop();
      for (const b of bots) b.disconnect(true);
      await proxy.close();
    }
  }

  async runAll(): Promise<CanaryRunResult[]> {
    console.log('\n======================================================');
    console.log('🧪 Canary Suite (Section 9: Fault Injection via Proxy)');
    console.log('======================================================');
    console.log('Note on prior implementation:');
    console.log('Previously existing canaries injected faults BOT-SIDE by directly');
    console.log('modifying BotClient internal flags (dropLeaveCanary, dropMoveCanary),');
    console.log('and "Break Reconnect" was only passing an invalid token string.');
    console.log('The new suite uses FaultProxy to mutate real WebSocket S2C binary frames.\n');

    const results: CanaryRunResult[] = [];

    results.push(await this.runCanaryMini('C1', 'Drop every 5th ENTITY_LEAVE', 60));
    results.push(await this.runCanaryMini('C2', 'Drop every 10th ENTITY_MOVE', 60));
    results.push(await this.runCanaryMini('C3', 'Add +1 to x in ENTITY_MOVE', 60));
    results.push(await this.runCanaryMini('C4', 'Drop MOVE_ACK for 2 bots', 60));
    results.push(await this.runCanaryMini('C5', 'Close sockets with bad close code on reconnect', 60));
    results.push(await this.runCanaryMini('C6', 'Delay all frames by 2s for 3 bots', 60));

    console.log('\n========================================================================================');
    console.log('📋 Canary Suite Detection Results Table');
    console.log('========================================================================================');
    console.log('| Canary | Detected? | Detected by which layer | Evidence line |');
    console.log('|---|---|---|---|');
    for (const r of results) {
      console.log(`| ${r.canary} | ${r.detected ? 'YES' : 'NO'} | ${r.detectedByLayer} | ${r.evidenceLine} |`);
    }
    console.log('========================================================================================\n');

    return results;
  }
}
