/**
 * apps/bots/src/behaviours.ts
 *
 * Implements the 7 player behavior models specified in Section 4 & 14.
 * Simulates human-like cadences, hesitations, replans, wall bumps, and crowd events.
 */

import {
  findPath,
  pathToDirections,
  isWalkable,
  DIR,
  type Direction,
  type GameMap,
} from '@heist/shared';
import type { BotClient } from './bot.js';
import type { SeededRNG } from './tools/random.js';

export class BotBrain {
  public bot: BotClient;
  private map: GameMap;
  private rng?: SeededRNG;
  private running = false;
  public isFrozen = false;
  public crowdTarget: { x: number; y: number } | null = null;
  private stepDurationMs = 250;

  constructor(bot: BotClient, map: GameMap, rng?: SeededRNG) {
    this.bot = bot;
    this.map = map;
    this.rng = rng;
  }

  private rand(): number {
    return this.rng ? this.rng.next() : Math.random();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop().catch(() => {});
  }

  stop(): void {
    this.running = false;
  }

  freeze(): void {
    this.isFrozen = true;
  }

  unfreeze(): void {
    this.isFrozen = false;
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async loop(): Promise<void> {
    while (this.running) {
      if (!this.bot.isConnected || this.isFrozen) {
        await this.sleep(300);
        continue;
      }

      // If crowd event is active and bot is not AFK, prioritize crowd hotspot
      if (this.crowdTarget && this.bot.behaviour !== 'afk') {
        await this.runCrowdPath();
        continue;
      }

      switch (this.bot.behaviour) {
        case 'roamer':
          await this.runRoamer();
          break;
        case 'hotspot-goer':
          await this.runHotspotGoer();
          break;
        case 'explorer':
          await this.runExplorer();
          break;
        case 'border-crosser':
          await this.runBorderCrosser();
          break;
        case 'afk':
          await this.runAfk();
          break;
        case 'reconnector':
          await this.runReconnector();
          break;
        case 'human-pauser':
          await this.runHumanPauser();
          break;
      }
    }
  }

  private async stepWithJitter(dir: Direction): Promise<void> {
    if (this.isFrozen || !this.bot.isConnected) return;
    this.bot.sendMove(dir);

    // Cadence: 250ms plus 10-60ms jitter, with occasional 100-300ms hesitation
    let delay = this.stepDurationMs + 10 + this.rand() * 50;
    if (this.rand() < 0.12) {
      delay += 100 + this.rand() * 200; // human hesitation
    }
    await this.sleep(delay);
  }

  /**
   * Crowd Event: Bots path to crowd hotspot and linger
   */
  private async runCrowdPath(): Promise<void> {
    if (!this.crowdTarget) return;
    const dest = this.crowdTarget;

    const path = findPath(this.map, this.bot.x, this.bot.y, dest.x, dest.y);
    if (!path || path.length < 1) {
      await this.sleep(1000);
      return;
    }

    const dirs = pathToDirections(this.bot.x, this.bot.y, path);
    for (const d of dirs) {
      if (!this.running || !this.bot.isConnected || this.isFrozen || !this.crowdTarget) break;
      await this.stepWithJitter(d as Direction);
    }

    // Linger near crowd center
    await this.sleep(2000 + this.rand() * 3000);
  }

  /**
   * Roamer (45%): Picks walkable tile via A*, steps along it.
   * Re-plans mid-path ~15% of the time (changed mind).
   */
  private async runRoamer(): Promise<void> {
    const dest = this.pickRandomWalkableTile();
    if (!dest) {
      await this.sleep(1000);
      return;
    }

    const path = findPath(this.map, this.bot.x, this.bot.y, dest.x, dest.y);
    if (!path || path.length < 1) {
      await this.sleep(1000);
      return;
    }

    const dirs = pathToDirections(this.bot.x, this.bot.y, path);
    for (let i = 0; i < dirs.length; i++) {
      if (!this.running || !this.bot.isConnected || this.isFrozen || this.crowdTarget) break;

      // Roamers re-plan mid-path ~15% of the time
      if (i > 3 && this.rand() < 0.15) {
        break; // changed their mind, re-pick destination
      }

      await this.stepWithJitter(dirs[i] as Direction);
    }

    // Think time pause 1-5s
    await this.sleep(1000 + this.rand() * 4000);
  }

  /**
   * Hotspot-goer (20%): Cycles between map hotspots, lingers 10-40s, then wanders or next hotspot
   */
  private async runHotspotGoer(): Promise<void> {
    if (this.map.hotspots.length === 0) {
      await this.runRoamer();
      return;
    }

    const spot = this.map.hotspots[Math.floor(this.rand() * this.map.hotspots.length)];
    const path = findPath(this.map, this.bot.x, this.bot.y, spot.x, spot.y);

    if (path && path.length >= 1) {
      const dirs = pathToDirections(this.bot.x, this.bot.y, path);
      for (const d of dirs) {
        if (!this.running || !this.bot.isConnected || this.isFrozen || this.crowdTarget) break;
        await this.stepWithJitter(d as Direction);
      }
    }

    this.bot.hotspotsVisited.add(spot.name);

    // Linger 10-40s doing small hotspot tasks
    const lingerEnd = Date.now() + (10000 + this.rand() * 30000);
    while (Date.now() < lingerEnd && this.running && this.bot.isConnected && !this.isFrozen && !this.crowdTarget) {
      this.bot.sendPing();
      await this.sleep(3000 + this.rand() * 2000);
    }
  }

  /**
   * Explorer (10%): Walks in random direction 3-20 tiles, bumps walls on purpose, turns
   */
  private async runExplorer(): Promise<void> {
    const dirs: Direction[] = [DIR.UP, DIR.DOWN, DIR.LEFT, DIR.RIGHT];
    const dir = dirs[Math.floor(this.rand() * dirs.length)];
    const steps = 3 + Math.floor(this.rand() * 15);

    for (let i = 0; i < steps; i++) {
      if (!this.running || !this.bot.isConnected || this.isFrozen || this.crowdTarget) break;
      await this.stepWithJitter(dir);
    }

    // Sometimes intentionally walk into a wall
    if (this.rand() < 0.4) {
      await this.stepWithJitter(dir);
    }

    await this.sleep(500 + this.rand() * 1500);
  }

  /**
   * Border-crosser (10%): Walks back and forth across chunk boundaries
   */
  private async runBorderCrosser(): Promise<void> {
    const isNearChunkBorder = this.bot.x % 16 === 15 || this.bot.x % 16 === 0;

    if (!isNearChunkBorder) {
      const targetX = Math.round(this.bot.x / 16) * 16;
      const path = findPath(this.map, this.bot.x, this.bot.y, targetX, this.bot.y);
      if (path && path.length >= 1) {
        const dirs = pathToDirections(this.bot.x, this.bot.y, path);
        for (const d of dirs) {
          if (!this.running || !this.bot.isConnected || this.isFrozen || this.crowdTarget) break;
          await this.stepWithJitter(d as Direction);
        }
      }
    }

    // Step back and forth across border
    for (let i = 0; i < 4; i++) {
      if (!this.running || !this.bot.isConnected || this.isFrozen || this.crowdTarget) break;
      await this.stepWithJitter(DIR.RIGHT);
      await this.stepWithJitter(DIR.LEFT);
    }

    await this.sleep(800 + this.rand() * 1200);
  }

  /**
   * AFK (5%): Stands still, sends periodic pings, occasionally wakes up and walks a few tiles
   */
  private async runAfk(): Promise<void> {
    this.bot.sendPing();

    // Occasional brief wake up: walk 2-3 tiles
    if (this.rand() < 0.08) {
      const dirs: Direction[] = [DIR.UP, DIR.DOWN, DIR.LEFT, DIR.RIGHT];
      const d = dirs[Math.floor(this.rand() * dirs.length)];
      await this.stepWithJitter(d);
      await this.stepWithJitter(d);
    }

    await this.sleep(4000 + this.rand() * 2000);
  }

  /**
   * Reconnector (5%): Steps mid-walk, drops socket, waits 2-10s, reconnects
   */
  private async runReconnector(): Promise<void> {
    const dirs: Direction[] = [DIR.UP, DIR.DOWN, DIR.LEFT, DIR.RIGHT];
    const d = dirs[Math.floor(this.rand() * dirs.length)];
    for (let i = 0; i < 3; i++) {
      if (!this.running || !this.bot.isConnected || this.isFrozen || this.crowdTarget) break;
      await this.stepWithJitter(d);
    }

    if (!this.isFrozen && !this.crowdTarget) {
      this.bot.disconnect(true);
      const waitMs = 2000 + this.rand() * 8000;
      await this.sleep(waitMs);

      if (this.running && !this.isFrozen) {
        this.bot.reconnects++;
        this.bot.recordEvent('reconnect');
        try {
          await this.bot.connect();
        } catch {}
      }
    }
  }

  /**
   * Human-pauser (5%): Roamer that pauses erratically mid-path
   */
  private async runHumanPauser(): Promise<void> {
    const dest = this.pickRandomWalkableTile();
    if (!dest) {
      await this.sleep(1000);
      return;
    }

    const path = findPath(this.map, this.bot.x, this.bot.y, dest.x, dest.y);
    if (!path || path.length < 1) {
      await this.sleep(1000);
      return;
    }

    const dirs = pathToDirections(this.bot.x, this.bot.y, path);
    for (const d of dirs) {
      if (!this.running || !this.bot.isConnected || this.isFrozen || this.crowdTarget) break;
      await this.stepWithJitter(d as Direction);

      if (this.rand() < 0.25) {
        await this.sleep(800 + this.rand() * 2000);
      }
    }

    await this.sleep(2000 + this.rand() * 3000);
  }

  private pickRandomWalkableTile(): { x: number; y: number } | null {
    for (let attempts = 0; attempts < 50; attempts++) {
      const rx = Math.floor(this.rand() * this.map.width);
      const ry = Math.floor(this.rand() * this.map.height);
      if (isWalkable(this.map, rx, ry)) {
        return { x: rx, y: ry };
      }
    }
    return null;
  }
}
