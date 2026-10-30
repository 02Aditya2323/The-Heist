/**
 * Layered render pipeline enforcing strict draw order:
 * 1. Ground -> 2. Ground decals -> 3. Y-sorted entities -> 4. Overhang -> 5. Lighting hook
 */

import { DIR, type GameMap } from '@heist/shared';
import { TILE_SIZE } from '../assets/atlas.js';
import type { TilemapRenderer } from './tilemap.js';
import type { WorldEntity } from '../game/store.js';

export class RenderLayers {
  // 1. GROUND PASS
  renderGround(
    ctx: CanvasRenderingContext2D,
    map: GameMap,
    camX: number,
    camY: number,
    tilemap: TilemapRenderer
  ): number {
    return tilemap.renderVisibleChunks(ctx, map, camX, camY, 480, 270, 'ground');
  }

  // 2. GROUND DECALS PASS (Puddle glints, street markings)
  renderGroundDecals(
    _ctx: CanvasRenderingContext2D,
    _map: GameMap,
    _camX: number,
    _camY: number
  ): void {
    // Ground decals are baked into chunk ground canvas or dynamic wet ripples
  }

  // 3. ENTITIES PASS (Sorted by Y position for proper depth overlap)
  renderEntities(
    ctx: CanvasRenderingContext2D,
    selfEntity: WorldEntity,
    otherEntities: Iterable<WorldEntity>,
    camX: number,
    camY: number,
    now: number
  ): void {
    const list: WorldEntity[] = [selfEntity, ...otherEntities];

    // Compute interpolated pixel positions first
    const items = list.map((ent) => {
      const elapsed = now - ent.animStart;
      const t = Math.min(1.0, Math.max(0, elapsed / ent.animDuration));
      const smoothX = ent.prevTileX + (ent.tileX - ent.prevTileX) * t;
      const smoothY = ent.prevTileY + (ent.tileY - ent.prevTileY) * t;
      return {
        ent,
        px: smoothX * TILE_SIZE,
        py: smoothY * TILE_SIZE,
        sortY: smoothY,
        isSelf: ent.id === selfEntity.id,
      };
    });

    // Sort ascending by Y coordinate so entities lower on screen overlap those above
    items.sort((a, b) => a.sortY - b.sortY);

    for (const item of items) {
      const sx = Math.round(item.px - camX);
      const sy = Math.round(item.py - camY);

      // Cull offscreen entities
      if (sx < -20 || sx > 480 + 20 || sy < -30 || sy > 270 + 20) {
        continue;
      }

      this.drawEntity(ctx, item.ent, sx, sy, item.isSelf);
    }
  }

  private drawEntity(
    ctx: CanvasRenderingContext2D,
    ent: WorldEntity,
    sx: number,
    sy: number,
    isSelf: boolean
  ): void {
    const size = 12; // 12x12 entity rectangle on 16px tile
    const offset = 2;
    const ex = sx + offset;
    const ey = sy + offset;

    // Entity body shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(ex + 1, ey + size - 1, size - 2, 3);

    // Entity body
    ctx.fillStyle = isSelf ? '#00d2ff' : '#10b981';
    ctx.fillRect(ex, ey, size, size);

    // Outline
    ctx.strokeStyle = isSelf ? '#ffffff' : '#a7f3d0';
    ctx.lineWidth = 1;
    ctx.strokeRect(ex + 0.5, ey + 0.5, size - 1, size - 1);

    // Facing indicator (2px pixel dot)
    ctx.fillStyle = isSelf ? '#051824' : '#022c22';
    const cx = ex + size / 2;
    const cy = ey + size / 2;
    if (ent.dir === DIR.UP) {
      ctx.fillRect(cx - 1, ey + 2, 2, 2);
    } else if (ent.dir === DIR.DOWN) {
      ctx.fillRect(cx - 1, ey + size - 4, 2, 2);
    } else if (ent.dir === DIR.LEFT) {
      ctx.fillRect(ex + 2, cy - 1, 2, 2);
    } else if (ent.dir === DIR.RIGHT) {
      ctx.fillRect(ex + size - 4, cy - 1, 2, 2);
    }

    // Name label
    ctx.font = '7px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = isSelf ? '#00f0ff' : '#e2e8f0';
    ctx.fillText(isSelf ? `${ent.name}` : ent.name, cx, ey - 3);
  }

  // 4. OVERHANG PASS (Roof lips, awnings, neon sign tops covering players)
  renderOverhang(
    ctx: CanvasRenderingContext2D,
    map: GameMap,
    camX: number,
    camY: number,
    tilemap: TilemapRenderer
  ): void {
    tilemap.renderVisibleChunks(ctx, map, camX, camY, 480, 270, 'overhang');
    tilemap.drawHotspotSigns(ctx, map, camX, camY);
  }

  // 5. LIGHTING PASS (Placeholder hook for upcoming lighting prompt)
  renderLighting(
    _ctx: CanvasRenderingContext2D,
    _map: GameMap,
    _camX: number,
    _camY: number
  ): void {
    // Empty lighting hook for next prompt
  }
}
