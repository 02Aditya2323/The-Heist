/**
 * Movement prediction and authoritative server reconciliation.
 * Implements FRONTEND_CONTRACT.md Sections 5.3, 5.5, 5.6 and AGENTS.md.
 */

import {
  tryStep,
  type Direction,
  type GameMap,
  type MoveAckMsg,
  type MoveRejectMsg,
  type EntityTeleportMsg,
} from '@heist/shared';
import type { GameBackend } from '../net/backend.js';
import type { InputHandler } from './input.js';
import type { WorldEntity } from '../game/store.js';

export interface PendingPrediction {
  seq: number;
  dir: Direction;
  x: number;
  y: number;
}

export class MovementPredictor {
  public enabled = false;
  public pending: PendingPrediction[] = [];
  public seq = 0;
  public rejectsCount = 0;
  private stepDurationMs: number | null = null;
  private selfEntity: WorldEntity | null = null;
  private map: GameMap | null = null;

  constructor(
    private backend: GameBackend,
    private input: InputHandler
  ) {}

  resetOnWelcome(
    tickRate: number,
    stepTicks: number,
    selfEntity: WorldEntity,
    map: GameMap
  ): void {
    this.stepDurationMs = (stepTicks / tickRate) * 1000;
    this.selfEntity = selfEntity;
    this.map = map;
    this.pending.length = 0;
    this.seq = 0;
    this.enabled = true;
  }

  clearPending(): void {
    this.pending.length = 0;
  }

  update(now: number): void {
    if (!this.enabled || !this.map || !this.selfEntity || this.stepDurationMs === null) {
      return;
    }

    const elapsed = now - this.selfEntity.animStart;

    // 1. Must wait for current step duration to complete before starting next
    if (elapsed < this.stepDurationMs) {
      return;
    }

    // 2. Enforce server queue limit (max 2 unacknowledged in-flight moves)
    if (this.pending.length >= 2) {
      return;
    }

    const dir = this.input.getActiveDirection();
    if (dir === null) return;

    // Face the direction immediately
    this.selfEntity.dir = dir;

    // 3. Local collision check via shared tryStep
    const step = tryStep(this.map, this.selfEntity.tileX, this.selfEntity.tileY, dir);
    if (!step.ok) {
      // Wall blocked locally: do NOT send packet, do NOT enter cooldown
      return;
    }

    // 4. Increment sequence number (wraps at u16 65535)
    this.seq = (this.seq + 1) & 0xffff;

    // 5. Enqueue prediction
    this.pending.push({
      seq: this.seq,
      dir,
      x: step.x,
      y: step.y,
    });

    // 6. Send binary MOVE packet to authoritative server
    this.backend.sendMove(this.seq, dir);

    // 7. Update animation coordinates
    this.selfEntity.prevTileX = this.selfEntity.tileX;
    this.selfEntity.prevTileY = this.selfEntity.tileY;
    this.selfEntity.tileX = step.x;
    this.selfEntity.tileY = step.y;

    // 8. Prevent drift: chain smoothly if holding, or reset if starting fresh
    if (elapsed < this.stepDurationMs * 1.5) {
      this.selfEntity.animStart += this.stepDurationMs;
    } else {
      this.selfEntity.animStart = now;
    }
    this.selfEntity.animDuration = this.stepDurationMs;
  }

  handleAck(ack: MoveAckMsg): void {
    let ackIdx = -1;
    for (let i = 0; i < this.pending.length; i++) {
      if (this.pending[i].seq === ack.seq) {
        ackIdx = i;
        break;
      }
    }

    if (ackIdx !== -1) {
      const predictedAtAck = this.pending[ackIdx];
      this.pending.splice(0, ackIdx + 1);

      // Only correct position if the server position actually differs from prediction. No snapping otherwise.
      if (predictedAtAck.x !== ack.x || predictedAtAck.y !== ack.y) {
        if (!this.map || !this.selfEntity) return;

        let currX = ack.x;
        let currY = ack.y;
        for (const p of this.pending) {
          const next = tryStep(this.map, currX, currY, p.dir);
          if (next.ok) {
            currX = next.x;
            currY = next.y;
            p.x = currX;
            p.y = currY;
          }
        }
        this.selfEntity.tileX = currX;
        this.selfEntity.tileY = currY;
      }
    }
  }

  handleReject(reject: MoveRejectMsg): void {
    this.rejectsCount++;
    if (!this.selfEntity) return;

    // Snap directly to authoritative server coordinates
    this.selfEntity.tileX = reject.x;
    this.selfEntity.tileY = reject.y;
    this.selfEntity.prevTileX = reject.x;
    this.selfEntity.prevTileY = reject.y;
    this.selfEntity.dir = reject.dir;

    // Clear in-flight predictions since the chain broke
    this.pending.length = 0;

    // Reset animation window
    this.selfEntity.animStart = performance.now();
    if (this.stepDurationMs !== null) this.selfEntity.animDuration = this.stepDurationMs;
  }

  handleTeleport(msg: EntityTeleportMsg): void {
    if (this.selfEntity && msg.id === this.selfEntity.id) {
      this.pending.length = 0;
      this.selfEntity.tileX = msg.x;
      this.selfEntity.tileY = msg.y;
      this.selfEntity.prevTileX = msg.x;
      this.selfEntity.prevTileY = msg.y;
      this.selfEntity.dir = msg.dir;
      this.selfEntity.animStart = performance.now();
    }
  }
}
