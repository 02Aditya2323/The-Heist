/** Emerald-inspired canvas renderer. Gameplay geometry always comes from GameMap. */
import type { GameMap } from '@heist/shared';
import type { GameStore, WorldEntity } from '../game/store.js';
import type { GameRenderer, RenderMode } from './types.js';
import { globalCentralExchange } from './central-exchange.js';
import { globalTechQuarter } from './tech-quarter.js';
import { globalDataHarbor } from './data-harbor.js';
import { globalNexusPlaza } from './nexus-plaza.js';
import { globalBlackGrid } from './black-grid.js';
import { globalUndercity } from './undercity.js';

export const INTERNAL_WIDTH = 480;
export const INTERNAL_HEIGHT = 270;
const TILE = 16;

export class PixelRenderer implements GameRenderer {
  public renderMode: RenderMode = 'procedural';
  private readonly displayCtx: CanvasRenderingContext2D;
  private readonly world: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly propSheet = new Image();
  private scale = 1; private offsetX = 0; private offsetY = 0;
  private fps = 60; private lastFps = performance.now(); private frames = 0;
  constructor(private readonly canvas: HTMLCanvasElement) {
    const display = canvas.getContext('2d', { alpha: false }); const world = document.createElement('canvas'); const ctx = world.getContext('2d', { alpha: false });
    if (!display || !ctx) throw new Error('Canvas rendering is unavailable');
    this.displayCtx = display; this.world = world; this.ctx = ctx; world.width = INTERNAL_WIDTH; world.height = INTERNAL_HEIGHT; display.imageSmoothingEnabled = false; ctx.imageSmoothingEnabled = false; this.propSheet.src = '/art/veyra-props-v1.png';
  }
  resize(width: number, height: number): void { this.scale = Math.max(1, Math.min(width / INTERNAL_WIDTH, height / INTERNAL_HEIGHT)); this.canvas.width = width; this.canvas.height = height; this.offsetX = Math.floor((width - INTERNAL_WIDTH * this.scale) / 2); this.offsetY = Math.floor((height - INTERNAL_HEIGHT * this.scale) / 2); }
  render(store: GameStore, debug: boolean, collision: boolean, now: number): void {
    this.trackFps(now); const { ctx } = this; ctx.fillStyle = '#16304c'; ctx.fillRect(0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT);
    if (!store.map || !store.selfEntity) this.waiting(ctx); else {
      const camera = this.camera(store.map, store.selfEntity, now);
      this.map(ctx, store.map, camera.x, camera.y);
      this.districtSigns(ctx, camera.x, camera.y);
      globalCentralExchange.renderProps(ctx, camera.x, camera.y, now);
      globalTechQuarter.renderProps(ctx, camera.x, camera.y, now);
      globalDataHarbor.renderProps(ctx, camera.x, camera.y, now);
      globalNexusPlaza.renderProps(ctx, camera.x, camera.y, now);
      globalBlackGrid.renderProps(ctx, camera.x, camera.y, now);
      globalUndercity.renderProps(ctx, camera.x, camera.y, now);
      this.landmarks(ctx, store.map, camera.x, camera.y, now);
      this.hotspots(ctx, store.map, camera.x, camera.y, now);
      this.people(ctx, store, camera.x, camera.y, now);
      this.hud(ctx, store);
      if (collision) this.collision(ctx, store.map, camera.x, camera.y);
      if (debug) this.debug(ctx, store, camera.x, camera.y);
    }
    this.displayCtx.fillStyle = '#10233a'; this.displayCtx.fillRect(0, 0, this.canvas.width, this.canvas.height); this.displayCtx.drawImage(this.world, 0, 0, INTERNAL_WIDTH, INTERNAL_HEIGHT, this.offsetX, this.offsetY, INTERNAL_WIDTH * this.scale, INTERNAL_HEIGHT * this.scale);
  }
  private camera(map: GameMap, self: WorldEntity, now: number): { x: number; y: number } { const t = Math.min(1, Math.max(0, (now - self.animStart) / self.animDuration)); const x = self.prevTileX + (self.tileX - self.prevTileX) * t; const y = self.prevTileY + (self.tileY - self.prevTileY) * t; return { x: Math.max(0, Math.min(map.width * TILE - INTERNAL_WIDTH, Math.round((x + .5) * TILE - INTERNAL_WIDTH / 2))), y: Math.max(0, Math.min(map.height * TILE - INTERNAL_HEIGHT, Math.round((y + .5) * TILE - INTERNAL_HEIGHT / 2))) }; }
  private map(ctx: CanvasRenderingContext2D, map: GameMap, camX: number, camY: number): void { const sx = Math.max(0, Math.floor(camX / TILE) - 1), ex = Math.min(map.width - 1, Math.ceil((camX + INTERNAL_WIDTH) / TILE) + 1), sy = Math.max(0, Math.floor(camY / TILE) - 1), ey = Math.min(map.height - 1, Math.ceil((camY + INTERNAL_HEIGHT) / TILE) + 1); for (let y = sy; y <= ey; y++) for (let x = sx; x <= ex; x++) this.tile(ctx, x * TILE - camX, y * TILE - camY, x, y, map.collision[y * map.width + x] === 1); }
  private tile(ctx: CanvasRenderingContext2D, x: number, y: number, gx: number, gy: number, solid: boolean): void {
    if (globalCentralExchange.isCentralExchange(gx, gy)) {
      globalCentralExchange.renderTile(ctx, x, y, gx, gy, solid, performance.now());
      return;
    }
    if (globalTechQuarter.isTechQuarter(gx, gy)) {
      globalTechQuarter.renderTile(ctx, x, y, gx, gy, solid, performance.now());
      return;
    }
    if (globalDataHarbor.isDataHarbor(gx, gy)) {
      globalDataHarbor.renderTile(ctx, x, y, gx, gy, solid, performance.now());
      return;
    }
    if (globalNexusPlaza.isNexusPlaza(gx, gy)) {
      globalNexusPlaza.renderTile(ctx, x, y, gx, gy, solid, performance.now());
      return;
    }
    if (globalBlackGrid.isBlackGrid(gx, gy)) {
      globalBlackGrid.renderTile(ctx, x, y, gx, gy, solid, performance.now());
      return;
    }
    if (globalUndercity.isUndercity(gx, gy)) {
      globalUndercity.renderTile(ctx, x, y, gx, gy, solid, performance.now());
      return;
    }

    if (solid) { const blackGrid=gx>130&&gy>74;ctx.fillStyle=blackGrid?'#56394f':'#426079';ctx.fillRect(x,y,TILE,TILE);ctx.fillStyle=blackGrid?'#92545f':'#6686a0';ctx.fillRect(x+1,y+1,14,4);ctx.fillStyle=blackGrid?'#35283f':'#2b415a';ctx.fillRect(x+1,y+5,14,10);if((gx+gy)%3===0){ctx.fillStyle=blackGrid?'#f1a75e':'#a9d4ce';ctx.fillRect(x+4,y+8,3,3);ctx.fillRect(x+10,y+8,3,3);}ctx.fillStyle='#273c53';ctx.fillRect(x,y+14,TILE,2);return;}
    const exchange=gx>=74&&gx<128&&gy>=48&&gy<102, harbor=gx>112&&gy<60, nexus=gx<65&&gy>72, undercity=gy>102&&gx>54&&gx<132;
    const avenue=gx===16||gx===17||gx===32||gx===33||gy===7||gy===8||gy===14||gy===15||gy===24||gy===25||gx===94||gx===95||gx===106||gx===107||gy===64||gy===65||gy===74||gy===75;
    const base=exchange?'#c9b47a':harbor?'#73b9ae':nexus?'#a98ccd':undercity?'#8bba69':avenue?'#d5bd7b':'#77b95a';
    ctx.fillStyle=base;ctx.fillRect(x,y,TILE,TILE);
    ctx.fillStyle=exchange?'#9b865c':harbor?'#4d9497':nexus?'#765eac':undercity?'#618e4f':avenue?'#b68f5b':'#5a9b4a';
    if((gx*7+gy*11)%3===0)ctx.fillRect(x+3,y+4,2,2);
    if(exchange){ctx.fillStyle='#e8d596';ctx.fillRect(x, y, TILE, 1);ctx.fillRect(x,y,1,TILE);if((gx+gy)%5===0){ctx.fillStyle='#f3e7b4';ctx.fillRect(x+7,y+7,2,2);}}
    else if(!avenue&&(gx+gy)%4===0){ctx.fillStyle='#b5dd68';ctx.fillRect(x+10,y+8,2,3);}
    if(!avenue&&!exchange&&(gx*19+gy*31)%89===0){ctx.fillStyle='#466b47';ctx.fillRect(x+5,y+6,6,8);ctx.fillStyle='#86bb60';ctx.fillRect(x+3,y+2,10,7);ctx.fillStyle='#b5dd68';ctx.fillRect(x+5,y+1,6,3);}
    if(avenue){ctx.fillStyle='#ead693';ctx.fillRect(x,y,TILE,1);ctx.fillRect(x,y,1,TILE);}
  }
  private hotspots(ctx: CanvasRenderingContext2D, map: GameMap, camX: number, camY: number, now: number): void { for(const h of map.hotspots??[]){const x=h.x*TILE+8-camX,y=h.y*TILE+8-camY;if(x<-50||x>530||y<-20||y>290)continue;const b=Math.round(Math.sin(now/260+h.x)*2);ctx.fillStyle='#fff5b1';ctx.fillRect(x-3,y-12+b,7,7);ctx.fillStyle='#dc6b44';ctx.fillRect(x-2,y-11+b,5,5);ctx.font='bold 6px monospace';ctx.textAlign='center';const label=h.name.toUpperCase(),w=ctx.measureText(label).width+6;ctx.fillStyle='#183250';ctx.fillRect(x-w/2,y-23+b,w,8);ctx.fillStyle='#fff8d2';ctx.fillText(label,x,y-17+b);} }
  private districtSigns(ctx: CanvasRenderingContext2D, camX: number, camY: number): void { const signs:[string,number,number,string][]=[['TECH QUARTER',34,58,'#4b91bb'],['DATA HARBOR',146,58,'#4d9996'],['CENTRAL EXCHANGE',101,47,'#bd9652'],['NEXUS PLAZA',40,84,'#936dc4'],['BLACK GRID',162,84,'#b85b60'],['UNDERCITY',94,103,'#70a65d']];ctx.font='bold 7px monospace';ctx.textAlign='center';for(const [label,gx,gy,color] of signs){const x=gx*TILE-camX,y=gy*TILE-camY;if(x<-90||x>570||y<-30||y>300)continue;const w=ctx.measureText(label).width+10;ctx.fillStyle='rgba(18,39,58,.9)';ctx.fillRect(x-w/2,y-6,w,12);ctx.strokeStyle=color;ctx.strokeRect(x-w/2+.5,y-5.5,w-1,11);ctx.fillStyle='#fff8d2';ctx.fillText(label,x,y+2);}}
  private landmarks(ctx: CanvasRenderingContext2D, map: GameMap, camX: number, camY: number, now: number): void {
    for(const spot of map.hotspots ?? []) {
      const x=spot.x*TILE-camX, y=spot.y*TILE-camY, n=spot.name.toLowerCase();
      if(x < -70 || x > 550 || y < -70 || y > 340) continue;
      if(n.includes('bank')) {
        globalCentralExchange.drawCentralBank(ctx, this.propSheet, x, y, now);
        continue;
      }
      if(n.includes('raid')) {
        globalCentralExchange.drawRaidCircle(ctx, this.propSheet, x, y, now);
        continue;
      }
      if(n.includes('race')) {
        globalCentralExchange.drawRaceTerminal(ctx, this.propSheet, x, y, now);
        continue;
      }
      if(n.includes('checkout')) {
        globalCentralExchange.drawCheckoutTerminal(ctx, this.propSheet, x, y, now);
        continue;
      }
      if(n.includes('tech') && (n.includes('board') || n.includes('job'))) {
        globalTechQuarter.drawTechJobBoard(ctx, this.propSheet, x, y, now);
        continue;
      }
      if(n.includes('logic') || (n.includes('lab') && !n.includes('dock'))) {
        globalTechQuarter.drawLogicLab(ctx, this.propSheet, x, y, now);
        continue;
      }
      if(n.includes('harbor') && (n.includes('board') || n.includes('job'))) {
        globalDataHarbor.drawHarborJobBoard(ctx, this.propSheet, x, y, now);
        continue;
      }
      if(n.includes('dock')) {
        globalDataHarbor.drawDockTerminal(ctx, this.propSheet, x, y, now);
        continue;
      }
      if(n.includes('nexus') && (n.includes('board') || n.includes('job'))) {
        globalNexusPlaza.drawNexusBoard(ctx, this.propSheet, x, y, now);
        continue;
      }
      if(n.includes('golden') || (n.includes('gate') && !n.includes('city'))) {
        globalNexusPlaza.drawGoldenHourGate(ctx, this.propSheet, x, y, now);
        continue;
      }
      if(n.includes('black') || (n.includes('grid') && (n.includes('board') || n.includes('job')))) {
        globalBlackGrid.drawBlackGridBoard(ctx, this.propSheet, x, y, now);
        continue;
      }
      if(n.includes('cipher') || n.includes('market')) {
        globalBlackGrid.drawCipherMarket(ctx, this.propSheet, x, y, now);
        continue;
      }
      if(n.includes('city') && n.includes('gate')) {
        globalBlackGrid.drawCityGate(ctx, this.propSheet, x, y, now);
        continue;
      }
      if(n.includes('undercity') && (n.includes('job') || n.includes('board'))) {
        globalUndercity.drawUndercityJobs(ctx, this.propSheet, x, y, now);
        continue;
      }
      if(n.includes('home') || n.includes('lane')) {
        globalUndercity.drawHomeLane(ctx, this.propSheet, x, y, now);
        continue;
      }
      if(n.includes('safehouse') || n.includes('row')) {
        globalUndercity.drawSafehouseRow(ctx, this.propSheet, x, y, now);
        continue;
      }

      if(this.propSheet.complete) {
        const terminal=n.includes('board')||n.includes('terminal')||n.includes('gate');
        if(terminal)ctx.drawImage(this.propSheet,52,718,185,270,x-9,y-26,18,27);
        else if(n.includes('home')||n.includes('safehouse'))ctx.drawImage(this.propSheet,197,647,335,345,x-15,y-20,30,31);
        else ctx.drawImage(this.propSheet,538,810,315,150,x-15,y-7,30,14);
      } else {
        ctx.fillStyle='#597b55';ctx.fillRect(x-5,y-8,10,12);ctx.fillStyle='#b5dd68';ctx.fillRect(x-7,y-12,14,8);
      }
    }
  }
  private people(ctx: CanvasRenderingContext2D, store: GameStore, camX: number, camY: number, now: number): void { const all=[store.selfEntity!,...store.entities.values()].map(entity=>{const t=Math.min(1,Math.max(0,(now-entity.animStart)/entity.animDuration));return{entity,x:entity.prevTileX+(entity.tileX-entity.prevTileX)*t,y:entity.prevTileY+(entity.tileY-entity.prevTileY)*t};}).sort((a,b)=>a.y-b.y);for(const p of all){const x=Math.round(p.x*TILE-camX),y=Math.round(p.y*TILE-camY),self=p.entity.id===store.selfEntity!.id;ctx.fillStyle='rgba(27,42,55,.35)';ctx.fillRect(x+4,y+13,9,2);ctx.fillStyle='#f4c79f';ctx.fillRect(x+5,y+3,6,5);ctx.fillStyle=self?'#e75d4b':'#5f78bd';ctx.fillRect(x+4,y+8,8,6);ctx.fillStyle=self?'#3c556b':'#283a63';ctx.fillRect(x+3,y+1,10,3);ctx.fillStyle='#fff';ctx.fillRect(x+7,y+5,1,1);ctx.font='bold 6px monospace';ctx.textAlign='center';ctx.fillStyle='#fff9d9';ctx.fillText(p.entity.name,x+8,y-2);} }
  private collision(ctx: CanvasRenderingContext2D,map:GameMap,cx:number,cy:number):void{ctx.fillStyle='rgba(255,82,82,.35)';for(let y=0;y<map.height;y++)for(let x=0;x<map.width;x++)if(map.collision[y*map.width+x])ctx.fillRect(x*TILE-cx,y*TILE-cy,TILE,TILE);}
  private hud(ctx: CanvasRenderingContext2D, store: GameStore): void { const self = store.selfEntity!; ctx.fillStyle='rgba(20,48,66,.92)';ctx.fillRect(7,238,174,25);ctx.strokeStyle='#fff0a8';ctx.strokeRect(7.5,238.5,173,24);ctx.fillStyle='#fff8d2';ctx.font='bold 7px monospace';ctx.textAlign='left';ctx.fillText(`OPERATOR  ${self.name.toUpperCase()}`,13,248);ctx.fillStyle='#e75d4b';ctx.fillRect(13,252,74,5);ctx.fillStyle='#f4c79f';ctx.fillRect(15,253,70,3);ctx.fillStyle='#fff8d2';ctx.fillText('HOME: --   BANK: --',94,258);ctx.fillStyle='rgba(20,48,66,.92)';ctx.fillRect(361,238,112,25);ctx.strokeStyle='#fff0a8';ctx.strokeRect(361.5,238.5,111,24);ctx.fillStyle='#fff8d2';ctx.font='bold 7px monospace';ctx.textAlign='center';ctx.fillText('MOVE: WASD / ARROWS',417,248);ctx.fillStyle='#b5dd68';ctx.fillText('F3 DEBUG  •  F4 MAP',417,258); }
  private debug(ctx:CanvasRenderingContext2D,store:GameStore,cx:number,cy:number):void{ctx.fillStyle='rgba(19,40,64,.9)';ctx.fillRect(6,6,166,50);ctx.strokeStyle='#fff0a8';ctx.strokeRect(6.5,6.5,165,49);ctx.fillStyle='#fff8d2';ctx.font='7px monospace';ctx.textAlign='left';['VEYRA CITY / DEV MAP',`FPS ${this.fps}  RTT ${store.pingMs}ms`,`TILE ${store.selfEntity?.tileX}, ${store.selfEntity?.tileY}`,`CAM ${cx}, ${cy}`,`AOI ${store.entities.size+1}  ${store.connectionStatus.state}`].forEach((line,i)=>ctx.fillText(line,11,15+i*9));}
  private waiting(ctx:CanvasRenderingContext2D):void{ctx.fillStyle='#6fab55';ctx.fillRect(0,0,INTERNAL_WIDTH,INTERNAL_HEIGHT);ctx.fillStyle='#fff8d2';ctx.font='bold 12px monospace';ctx.textAlign='center';ctx.fillText('VEYRA CITY IS WAKING UP...',240,135);}
  private trackFps(now:number):void{this.frames++;if(now-this.lastFps>500){this.fps=Math.round(this.frames*1000/(now-this.lastFps));this.frames=0;this.lastFps=now;}}
}

