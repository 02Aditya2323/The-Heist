/**
 * Central game store holding authoritative world state, self entity, and AoI entities.
 * Follows AGENTS.md data-flow architecture.
 */

import { DIR, type Direction, type GameMap, type EventView } from '@heist/shared';
import type { ConnectionStatusInfo } from '../net/backend.js';

export interface WorldEntity {
  id: number;
  name: string;
  tileX: number;
  tileY: number;
  prevTileX: number;
  prevTileY: number;
  dir: Direction;
  animStart: number;
  animDuration: number;
}

export interface CadenceConfig {
  tickRate: number;
  stepTicks: number;
  stepDurationMs: number;
}

const SESSION_TOKEN_KEY = 'heist_session_token';
const SESSION_USERNAME_KEY = 'heist_session_username';

export class GameStore {
  public event: EventView | null = null;
  public token: string | null = null;
  public username = '';
  public map: GameMap | null = null;
  public selfId: number | null = null;
  public selfEntity: WorldEntity | null = null;
  public entities = new Map<number, WorldEntity>();
  public cadence: CadenceConfig | null = null;
  public serverTick = 0;
  public pingMs = 0;
  public rejectsCount = 0;
  public connectionStatus: ConnectionStatusInfo = { state: 'DISCONNECTED' };

  constructor() {
    this.token = this.loadStoredToken();
    this.username = this.loadStoredUsername();
  }

  loadStoredToken(): string | null {
    try {
      return sessionStorage.getItem(SESSION_TOKEN_KEY);
    } catch {
      return null;
    }
  }

  loadStoredUsername(): string {
    try {
      return sessionStorage.getItem(SESSION_USERNAME_KEY) || '';
    } catch {
      return '';
    }
  }

  saveSession(token: string, username: string): void {
    this.token = token;
    this.username = username;
    try {
      sessionStorage.setItem(SESSION_TOKEN_KEY, token);
      sessionStorage.setItem(SESSION_USERNAME_KEY, username);
    } catch {}
  }

  clearSession(): void {
    this.token = null;
    this.username = '';
    try {
      sessionStorage.removeItem(SESSION_TOKEN_KEY);
      sessionStorage.removeItem(SESSION_USERNAME_KEY);
    } catch {}
  }

  resetOnWelcome(
    selfId: number,
    x: number,
    y: number,
    dir: Direction,
    tickRate: number,
    stepTicks: number,
    serverTick: number
  ): void {
    // Dynamic cadence calculation from WELCOME
    const stepDurationMs = (stepTicks / tickRate) * 1000;
    this.cadence = { tickRate, stepTicks, stepDurationMs };
    this.selfId = selfId;
    this.serverTick = serverTick;

    // Reset entities map before new ENTER messages arrive
    this.entities.clear();

    const now = performance.now();
    this.selfEntity = {
      id: selfId,
      name: this.username || `Agent #${selfId}`,
      tileX: x,
      tileY: y,
      prevTileX: x,
      prevTileY: y,
      dir,
      animStart: now,
      animDuration: stepDurationMs,
    };
  }

  handleEntityEnter(id: number, x: number, y: number, dir: Direction, name: string): void {
    if (!this.cadence) return;
    const stepDurationMs = this.cadence.stepDurationMs;
    const now = performance.now();
    this.entities.set(id, {
      id,
      name,
      tileX: x,
      tileY: y,
      prevTileX: x,
      prevTileY: y,
      dir,
      animStart: now,
      animDuration: stepDurationMs,
    });
  }

  handleEntityLeave(id: number): void {
    this.entities.delete(id);
  }

  handleEntityMove(id: number, x: number, y: number, dir: Direction): void {
    const ent = this.entities.get(id);
    if (!ent) return;

    if (!this.cadence) return;
    const stepDurationMs = this.cadence.stepDurationMs;
    ent.prevTileX = ent.tileX;
    ent.prevTileY = ent.tileY;
    ent.tileX = x;
    ent.tileY = y;
    ent.dir = dir;
    ent.animStart = performance.now();
    ent.animDuration = stepDurationMs;
  }

  handleEntityTeleport(id: number, x: number, y: number, dir: Direction): void {
    if (this.selfEntity && id === this.selfEntity.id) {
      this.selfEntity.tileX = x;
      this.selfEntity.tileY = y;
      this.selfEntity.prevTileX = x;
      this.selfEntity.prevTileY = y;
      this.selfEntity.dir = dir;
      this.selfEntity.animStart = performance.now();
    } else {
      const ent = this.entities.get(id);
      if (ent) {
        // Teleport: jump with no sliding animation
        ent.prevTileX = x;
        ent.prevTileY = y;
        ent.tileX = x;
        ent.tileY = y;
        ent.dir = dir;
      }
    }
  }
}
