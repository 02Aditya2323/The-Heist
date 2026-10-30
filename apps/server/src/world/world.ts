/**
 * apps/server/src/world/world.ts
 *
 * Authoritative game world state.
 * Manages entities, map, chunk grid, and spatial relationships.
 */

import {
  type GameMap,
  type MapData,
  type Direction,
  type ChunkCoord,
  chunkOf,
  randomSpawn,
  DIR,
  isWalkable,
} from '@heist/shared';
import type { Config } from '../config.js';
import type { PlayerStateRecord } from '../persistence/interfaces.js';
import type { SnapshotEntityProvider } from '../persistence/snapshotter.js';
import { type Entity, type PendingMove } from './entity.js';
import { ChunkGrid } from './chunk-grid.js';
import { EntityIdPool } from './id-pool.js';
import type { RuntimePort } from '../game/runtime-port.js';

export class World implements SnapshotEntityProvider {
  /** Populated only from authenticated account records, never client JSON. */
  public readonly staffPlayers = new Set<string>();
  public eventRuntime?: RuntimePort;
  public tick = 0;
  public readonly map: GameMap;
  public readonly rawMap: MapData;
  public readonly config: Config;
  public readonly chunkGrid = new ChunkGrid();
  public readonly idPool = new EntityIdPool();

  private entities = new Map<number, Entity>();
  private entitiesByPlayerId = new Map<string, Entity>();

  constructor(map: GameMap, rawMap: MapData, config: Config) {
    this.map = map;
    this.rawMap = rawMap;
    this.config = config;
  }

  get entityCount(): number {
    return this.entities.size;
  }

  get connectedPlayerCount(): number {
    let count = 0;
    for (const ent of this.entities.values()) {
      if (ent.connected) count++;
    }
    return count;
  }

  get ghostCount(): number {
    let count = 0;
    for (const ent of this.entities.values()) {
      if (!ent.connected) count++;
    }
    return count;
  }

  getAllEntities(): IterableIterator<Entity> {
    return this.entities.values();
  }

  getEntity(id: number): Entity | undefined {
    return this.entities.get(id);
  }

  getEntityByPlayerId(playerId: string): Entity | undefined {
    return this.entitiesByPlayerId.get(playerId);
  }

  /**
   * Spawn a new entity or resume an existing ghost.
   */
  createOrResumeEntity(
    playerId: string,
    name: string,
    savedState?: PlayerStateRecord | null
  ): Entity {
    // Check if player already exists in world (e.g. reconnecting ghost)
    const existing = this.entitiesByPlayerId.get(playerId);
    if (existing) {
      existing.connected = true;
      existing.disconnectedAt = undefined;
      return existing;
    }

    const id = this.idPool.acquire();
    if (id === null) {
      throw new Error('Entity ID pool exhausted (max 65535 concurrent entities)');
    }

    let x = 0;
    let y = 0;
    let dir: Direction = DIR.DOWN;
    let data: Record<string, unknown> = {};

    if (savedState) {
      try {
        data = JSON.parse(savedState.data || '{}');
      } catch {
        data = {};
      }
      if (data.mapVersion === this.map.version && (!data.eventGeneration || data.eventGeneration === this.eventRuntime?.eventKey()) && isWalkable(this.map, savedState.x, savedState.y)) {
        x = savedState.x;
        y = savedState.y;
        dir = savedState.dir as Direction;
      } else {
        const spawn = randomSpawn(this.map);
        x = spawn.x;
        y = spawn.y;
      }
    } else {
      const spawn = randomSpawn(this.map);
      x = spawn.x;
      y = spawn.y;
    }
    data.mapVersion = this.map.version;
    if (this.eventRuntime?.eventKey()) data.eventGeneration = this.eventRuntime.eventKey();

    const chunk: ChunkCoord = chunkOf(x, y, this.config.chunkSize);

    const entity: Entity = {
      id,
      playerId,
      name,
      x,
      y,
      dir,
      nextMoveTick: 0,
      pending: [],
      chunk,
      connected: true,
      dirty: true,
      data,
    };

    this.entities.set(id, entity);
    this.entitiesByPlayerId.set(playerId, entity);
    this.chunkGrid.add(entity);

    return entity;
  }

  /**
   * Removes an entity from the world and puts its ID into quarantine.
   */
  removeEntity(id: number): Entity | null {
    const ent = this.entities.get(id);
    if (!ent) return null;

    this.entities.delete(id);
    this.entitiesByPlayerId.delete(ent.playerId);
    this.chunkGrid.remove(ent);
    this.idPool.release(id);

    return ent;
  }

  /**
   * Enqueues a move command for an entity.
   * Returns false if the pending queue is already at capacity (spec: immediate reject).
   */
  queueMove(id: number, seq: number, dir: Direction): boolean {
    const ent = this.entities.get(id);
    if (!ent) return false;
    if (this.eventRuntime && !this.eventRuntime.canMove(ent.playerId)) return false;

    if (ent.pending.length >= this.config.maxPendingMoves) {
      return false;
    }

    ent.pending.push({ seq, dir });
    return true;
  }

  /**
   * Returns all entities currently inside viewer's 3x3 chunk AoI.
   */
  getVisibleEntities(viewer: Entity): Entity[] {
    const aoiIds = this.chunkGrid.getEntitiesInAoI(viewer.chunk);
    const result: Entity[] = [];
    for (const id of aoiIds) {
      const ent = this.entities.get(id);
      if (ent) {
        result.push(ent);
      }
    }
    return result;
  }

  /**
   * For GET /debug/aoi/:playerId
   */
  getVisibleEntityIds(playerId: string): {
    x: number;
    y: number;
    visibleEntityIds: number[];
    entities: { id: number; x: number; y: number }[];
  } | null {
    const ent = this.entitiesByPlayerId.get(playerId);
    if (!ent) return null;
    const aoiIds = this.chunkGrid.getEntitiesInAoI(ent.chunk);
    const visibleEntityIds = Array.from(aoiIds).sort((a, b) => a - b);
    const entities: { id: number; x: number; y: number }[] = [];
    for (const id of visibleEntityIds) {
      const other = this.entities.get(id);
      if (other) {
        entities.push({ id: other.id, x: other.x, y: other.y });
      }
    }
    return {
      x: ent.x,
      y: ent.y,
      visibleEntityIds,
      entities,
    };
  }

  /**
   * Implements SnapshotEntityProvider interface for periodic persistence.
   */
  getDirtyEntities() {
    const dirtyList = [];
    for (const ent of this.entities.values()) {
      if (ent.dirty) {
        dirtyList.push({
          playerId: ent.playerId,
          x: ent.x,
          y: ent.y,
          dir: ent.dir,
          data: ent.data,
          clearDirty: () => {
            ent.dirty = false;
          },
        });
      }
    }
    return dirtyList;
  }
}
