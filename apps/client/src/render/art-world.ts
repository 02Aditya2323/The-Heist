import { DIR, sceneAt, type ArtScene, type GameMap } from '@heist/shared';
import type { GameStore, WorldEntity } from '../game/store.js';
import type { GameRenderer } from './types.js';
import { nearbyInteractions } from '../engine/interactions.js';
import { OPERATOR_CELL, operatorFrame, operatorRow } from './operator-sprite.js';

/**
 * Keeps a value inside a range, tolerating an inverted range. A label wider than
 * the visible world leaves `lo` above `hi`; centring it is the readable answer.
 */
const clamp = (value: number, lo: number, hi: number): number =>
  lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, value));

/** Original art is sampled directly into the DPR canvas. No low-resolution intermediate. */
export class ArtWorldRenderer implements GameRenderer {
  readonly renderMode = 'painted' as const;
  zoom = 1;
  previewSceneId: string | null = null;
  showNames = true;
  currentFps = 0;
  imageError: string | null = null;
  private ctx: CanvasRenderingContext2D;
  private operatorSheet = new Image();
  private reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private focus: {key: string; x: number; y: number; at: number; leaving: boolean} | null = null;
  private images = new Map<string, HTMLImageElement>();
  private lastFrame = 0;
  private frameCount = 0;
  private sampleStart = performance.now();
  private width = 0;
  private height = 0;
  private dpr = 1;
  private previewPan = { x: 0, y: 0 };
  private drag: { x: number; y: number } | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is unavailable');
    this.ctx = ctx;
    this.operatorSheet.src = '/art/operators/operator-sheet.svg?v=gait-8';
    canvas.addEventListener('pointerdown', e => {
      if (!this.previewSceneId) return;
      this.drag = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', e => {
      if (!this.drag) return;
      this.previewPan.x -= (e.clientX - this.drag.x) / this.zoom;
      this.previewPan.y -= (e.clientY - this.drag.y) / this.zoom;
      this.drag = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointerup', () => { this.drag = null; });
    canvas.addEventListener('pointercancel', () => { this.drag = null; });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      this.setZoom(this.zoom + (e.deltaY < 0 ? .1 : -.1));
    }, { passive: false });
  }

  resize(width: number, height: number): void {
    this.width = width; this.height = height;
    // A bounded backing store protects modest lab PCs on very high-DPI monitors.
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  setZoom(value: number): void { this.zoom = Math.max(this.previewSceneId ? .2 : .5, Math.min(1.5, Math.round(value * 20) / 20)); }
  inspectScene(scene: ArtScene, map: GameMap, focus?:{x:number;y:number}): void {
    this.previewSceneId = scene.id;
    this.previewPan = { x: 0, y: 0 };
    const fit = Math.min(this.width / (scene.width * (map.tileSize || 32)), (this.height - 110) / (scene.height * (map.tileSize || 32)));
    this.setZoom(Math.floor(fit * 20) / 20);
    if(focus){const tile=map.tileSize||32;this.previewPan={x:(focus.x+.5-scene.x-scene.width/2)*tile,y:(focus.y+.5-scene.y-scene.height/2)*tile};this.setZoom(1);}
  }
  returnToPlayer(): void { this.previewSceneId = null; this.zoom = 1; this.previewPan = { x: 0, y: 0 }; }
  isSceneLoaded(id: string): boolean {
    const image = this.images.get(id);
    return !!image?.complete && image.naturalWidth > 0;
  }

  private image(scene: ArtScene): HTMLImageElement {
    const cached = this.images.get(scene.id);
    if (cached?.getAttribute('src')===scene.image) { this.images.delete(scene.id); this.images.set(scene.id, cached); return cached; }
    this.images.delete(scene.id);
    const img = new Image();
    img.onload = () => { this.imageError = null; };
    img.onerror = () => { this.imageError = `Could not load ${scene.name}. Check the art asset path.`; };
    img.src = scene.image;
    this.images.set(scene.id, img);
    // Only three decoded scenes stay resident. Other panels are browser-cacheable files.
    if (this.images.size > 3) this.images.delete(this.images.keys().next().value!);
    return img;
  }

  render(store: GameStore, debug: boolean, collision: boolean, now: number): void {
    // No frame limiter. GameLoop already drives this from requestAnimationFrame,
    // which is paced to the display, so a second 1000/60 gate could only ever
    // drop frames. On a 60Hz screen rAF arrives about every 16.667ms with
    // jitter, and every delta landing marginally under the 16.6667 threshold
    // skipped a frame outright: the city held still for 33ms and the sprite
    // then moved two steps' worth at once. That is the walking judder.
    if (document.hidden) return;
    this.lastFrame = now;
    this.frameCount++;
    if (now - this.sampleStart > 600) {
      this.currentFps = Math.round(this.frameCount * 1000 / (now - this.sampleStart));
      this.frameCount = 0; this.sampleStart = now;
    }
    const ctx = this.ctx, map = store.map;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#080d14'; ctx.fillRect(0, 0, this.width, this.height);
    if (!map?.scenes?.length) return;
    const self = store.selfEntity;
    const scene = this.previewSceneId ? map.scenes.find(s => s.id === this.previewSceneId)
      : self ? sceneAt(map, self.tileX, self.tileY) : map.scenes.find(s => s.id === 'central');
    if (!scene) return;
    const tile = map.tileSize || 32;
    const point = self ? this.position(self, now) : { x: scene.x + scene.width / 2, y: scene.y + scene.height / 2 };
    const preview = !!this.previewSceneId || !self;
    const centerX = preview ? (scene.x + scene.width / 2) * tile + this.previewPan.x : (point.x + .5) * tile;
    const centerY = preview ? (scene.y + scene.height / 2) * tile + this.previewPan.y : (point.y + .5) * tile;
    const vw = this.width / this.zoom, vh = this.height / this.zoom;
    const left = scene.x * tile, top = scene.y * tile;
    const sceneW = scene.width * tile, sceneH = scene.height * tile;
    const cx = sceneW <= vw ? left - (vw - sceneW) / 2 : Math.max(left, Math.min(left + sceneW - vw, centerX - vw / 2));
    const cy = sceneH <= vh ? top - (vh - sceneH) / 2 : Math.max(top, Math.min(top + sceneH - vh, centerY - vh / 2));
    ctx.save();
    ctx.scale(this.zoom, this.zoom); ctx.translate(-cx, -cy);
    const image = this.image(scene);
    if (image.complete && image.naturalWidth > 0) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      // The map fits 1664×928 pixels from a 1672×941 source. Crop the spare edge pixels
      // rather than stretching its aspect ratio or changing the world size.
      ctx.drawImage(image, 0, 0, sceneW, sceneH, left, top, sceneW, sceneH);
    } else {
      ctx.fillStyle = '#101c2a'; ctx.fillRect(left, top, sceneW, sceneH);
      ctx.fillStyle = '#e0e8ef'; ctx.font = '20px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`Loading ${scene.name}…`, centerX, centerY);
    }
    if (collision) this.collision(ctx, map, scene, tile);
    if(scene.kind==='neighborhood'){
      ctx.font='bold 11px monospace';ctx.textAlign='center';ctx.textBaseline='middle';
      for(const home of map.homePlots||[]){
        if(home.sceneId!==scene.id)continue;
        const hx=(home.x+.5)*tile,hy=(home.y+.5)*tile;
        ctx.fillStyle='rgba(6,12,20,.85)';ctx.fillRect(hx-25,hy+9,50,16);
        ctx.fillStyle='#ffe3aa';ctx.fillText(home.address,hx,hy+17);
        const owner=store.event?.homes.find(h=>h.id===home.id);
        if(owner){const label=owner.owner,w=ctx.measureText(label).width+12;ctx.fillStyle='rgba(6,12,20,.9)';ctx.fillRect(hx-w/2,hy+29,w,16);ctx.fillStyle=owner.capped?'#ff9c85':owner.id===store.event?.player.homeId?'#8bf5d6':'#bcd1db';ctx.fillText(label,hx,hy+37);}
      }
    }
    for(const state of store.event?.stationStates||[]){
      const spot=map.hotspots.find(h=>h.id===state.id);if(!spot||sceneAt(map,spot.x,spot.y)?.id!==scene.id)continue;
      const x=(spot.x+.5)*tile,y=(spot.y+.5)*tile,colors:Record<string,string>={Code:'#71d5f5',Debug:'#fb8d89',CTF:'#83dcaa',Puzzle:'#ba99f0'},color=colors[state.type]||'#82bbca';
      ctx.save();ctx.strokeStyle=state.state==='locked'?'#74838c':color;ctx.fillStyle=ctx.strokeStyle;ctx.globalAlpha=state.state==='open'?.55+.08*Math.sin(now/900):state.state==='training'?.55:.9;ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,13,0,Math.PI*2);ctx.stroke();
      ctx.font='bold 10px monospace';ctx.textAlign='center';ctx.fillText(state.state==='cleared'?'✓':state.state==='busy'?'◉':state.type==='Code'?'<>':state.type==='Debug'?'!':state.type==='CTF'?'⚑':'◇',x,y+3);
      for(let i=0;i<state.difficulty;i++){ctx.beginPath();ctx.arc(x-4*(state.difficulty-1)+i*8,y+20,2,0,Math.PI*2);ctx.fill();}ctx.restore();
      if(state.state==='locked'){ctx.font='10px monospace';ctx.fillStyle='#a2b2bd';ctx.fillText(`${Math.ceil(Math.max(0,state.until-(store.event?.serverTime||0))/1000)}s`,x,y-17);}
      if(spot.id==='sql'){ctx.font='bold 10px sans-serif';ctx.textAlign='center';ctx.fillStyle='rgba(4,12,19,.9)';ctx.fillRect(x-56,y-35,112,19);ctx.fillStyle='#b9ecfb';ctx.fillText('CODE REVIEW DESK',x,y-25);}
    }
    for(const spot of map.hotspots.filter(h=>['raid','bank','race','golden'].includes(h.id||''))){
      if(sceneAt(map,spot.x,spot.y)?.id!==scene.id||!store.event)continue;
      const x=(spot.x+.5)*tile,y=(spot.y+.5)*tile,e=store.event;
      if(spot.id==='raid'&&e.raid.window){const active=e.raid.endsAt>e.serverTime;ctx.strokeStyle=active?'#ef766e':'#e3bd73';ctx.fillStyle=ctx.strokeStyle;ctx.lineWidth=2;
        for(let i=0;i<e.raid.required;i++){const angle=i/e.raid.required*Math.PI*2-Math.PI/2,px=x+34*Math.cos(angle),py=y+34*Math.sin(angle);ctx.beginPath();ctx.arc(px,py,4,0,Math.PI*2);if(i<e.raid.crew)ctx.fill();else ctx.stroke();}
        if(e.raid.standingSince&&!e.raid.joined){ctx.beginPath();ctx.arc(x,y,26,-Math.PI/2,-Math.PI/2+Math.min(1,(e.serverTime-e.raid.standingSince)/60000)*Math.PI*2);ctx.stroke();}}
      const live=e.activities.find(a=>a.startsAt<=e.serverTime&&a.endsAt>e.serverTime&&(spot.id==='race'?a.id.startsWith('RC'):a.id.startsWith('GH')));
      if((spot.id==='race'||spot.id==='golden')&&live){ctx.strokeStyle=spot.id==='golden'?'#f6ce70':'#74d7ef';ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,24+2*Math.sin(now/350),0,Math.PI*2);ctx.stroke();}
      if(spot.id==='bank'&&e.raid.endsAt>e.serverTime){ctx.fillStyle='rgba(155,30,35,.22)';ctx.fillRect(x-34,y-110,68,84);ctx.font='bold 10px monospace';ctx.textAlign='center';ctx.fillStyle='#ffbbb0';ctx.fillText('CLOSED FOR RAID',x,y-10);}
    }
    for(const marker of store.event?.markers||[]){
      if(sceneAt(map,marker.x,marker.y)?.id!==scene.id)continue;
      const mx=(marker.x+.5)*tile,my=(marker.y+.5)*tile;ctx.save();ctx.translate(mx,my);
      ctx.fillStyle='#d3f7ce';ctx.strokeStyle='#17362b';ctx.lineWidth=2;
      if(marker.id.startsWith('card-')){ctx.shadowColor='#efc66d';ctx.shadowBlur=9;}
      if(marker.id==='courier'){ctx.fillStyle='#c3eac8';ctx.fillRect(-7,-24,14,22);ctx.fillStyle='#1b2f29';ctx.fillRect(-5,-17,10,4);ctx.fillStyle='#ebc77f';ctx.fillRect(5,-15,9,12);}else{ctx.rotate(-.15);ctx.fillRect(-8,-8,16,12);ctx.strokeRect(-8,-8,16,12);ctx.fillStyle='#397458';ctx.fillRect(-4,-5,6,3);}
      ctx.restore();ctx.font='bold 10px sans-serif';ctx.textAlign='center';ctx.fillStyle='#d7ffd6';ctx.fillText(marker.name,mx,my+18);
    }
    // Entrances are game data, not misleading arrows burned into the source artwork.
    ctx.font='bold 11px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
    for(const gate of map.exits||[]){
      if(sceneAt(map,gate.x,gate.y)?.id!==scene.id)continue;
      const gx=(gate.x+.5)*tile,gy=(gate.y+.5)*tile;
      ctx.fillStyle='#fff0b3';ctx.beginPath();ctx.moveTo(gx,gy-6);ctx.lineTo(gx+6,gy);ctx.lineTo(gx,gy+6);ctx.lineTo(gx-6,gy);ctx.fill();
      const label=gate.name.replace(/^To /,'→ '),w=ctx.measureText(label).width+10;
      // A gate sitting near the edge of a scene would otherwise have its name
      // sliced off by the canvas edge, which is where travel labels matter most.
      const lx=clamp(gx,cx+w/2+6,cx+vw-w/2-6),ly=clamp(gy+10,cy+6,cy+vh-26);
      ctx.fillStyle='rgba(6,12,20,.6)';ctx.fillRect(lx-w/2,ly,w,18);ctx.fillStyle='#ffe8b0';ctx.fillText(label,lx,ly+10);
    }
    if (!preview && self) this.interactionAccent(ctx, store, now, tile);
    if (!preview && self) {
      const people = [self, ...store.entities.values()]
        .filter(e => e.id === self.id || sceneAt(map, e.tileX, e.tileY)?.id === scene.id)
        .map(entity => ({ entity, point: this.position(entity, now) }))
        .sort((a, b) => a.point.y - b.point.y || a.entity.id - b.entity.id);
      for (const item of people) {
        const x = (item.point.x + .5) * tile, y = (item.point.y + .5) * tile;
        if (x < cx - 40 || x > cx + vw + 40 || y < cy - 60 || y > cy + vh + 40) continue;
        this.operator(ctx, item.entity, x, y, item.entity.id === self.id, now,
          this.showNames && (people.length <= 8 || item.entity.id === self.id));
      }
    }
    if(image.complete&&image.naturalWidth>0)for(const layer of scene.foregroundRects||[])ctx.drawImage(image,layer.x,layer.y,layer.width,layer.height,left+layer.x,top+layer.y,layer.width,layer.height);
    ctx.restore();
    if(store.event?.activities.some(a=>a.id.startsWith('GH')&&a.startsAt<=store.event!.serverTime&&a.endsAt>store.event!.serverTime)){
      const glow=ctx.createRadialGradient(this.width/2,this.height/2,Math.min(this.width,this.height)*.25,this.width/2,this.height/2,Math.max(this.width,this.height)*.65);glow.addColorStop(0,'rgba(218,173,63,0)');glow.addColorStop(1,'rgba(218,173,63,.12)');ctx.fillStyle=glow;ctx.fillRect(0,0,this.width,this.height);
    }
    if (debug) {
      const lines = [`${this.currentFps} FPS · ${store.pingMs} ms RTT`,
        `Map ${map.version} · ${tile}px tile · ${Math.round(this.zoom * 100)}% zoom`,
        `${store.entities.size + (self ? 1 : 0)} nearby · ${this.images.size}/3 decoded art panels`,
        `Canvas ${this.canvas.width}×${this.canvas.height} · DPR ${this.dpr}`];
      ctx.fillStyle = 'rgba(6,12,20,.9)'; ctx.fillRect(18, 88, 300, 91);
      ctx.font = '12px monospace'; ctx.textAlign = 'left'; ctx.fillStyle = '#dce7f4';
      lines.forEach((line, i) => ctx.fillText(line, 30, 110 + i * 18));
    }
  }

  private position(entity: WorldEntity, now: number): { x: number; y: number } {
    const t = entity.animDuration > 0 ? Math.max(0, Math.min(1, (now - entity.animStart) / entity.animDuration)) : 1;
    return { x: entity.prevTileX + (entity.tileX - entity.prevTileX) * t,
      y: entity.prevTileY + (entity.tileY - entity.prevTileY) * t };
  }

  private operator(ctx: CanvasRenderingContext2D, entity: WorldEntity, x: number, y: number, self: boolean, now: number, name: boolean): void {
    ctx.save(); ctx.translate(x, y);
    const progress = entity.animDuration > 0 ? (now - entity.animStart) / entity.animDuration : 1;
    const moving = progress >= 0 && progress < 1 && (entity.tileX !== entity.prevTileX || entity.tileY !== entity.prevTileY);
    // Ground contact stays still while the sheet supplies the body bob and foot lift.
    for (let i = 3; i >= 0; i--) {
      ctx.fillStyle = `rgba(2,8,15,${.035 + (3-i)*.025})`;
      ctx.beginPath(); ctx.ellipse(0, 1, 8+i*1.7, 2.5+i*.7, 0, 0, Math.PI*2); ctx.fill();
    }
    if (self) {
      ctx.strokeStyle = 'rgba(126,221,227,.52)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(0, 0, 12, 5, 0, 0, Math.PI*2); ctx.stroke();
      ctx.strokeStyle = 'rgba(171,241,238,.8)';
      ctx.beginPath(); ctx.ellipse(0, 0, 12, 5, 0, Math.PI*.1, Math.PI*.45); ctx.stroke();
    }
    const parity = (entity.prevTileX + entity.prevTileY) & 1;
    const frame = moving ? operatorFrame(progress, true, parity)
      : this.reducedMotion.matches ? 0 : Math.floor(now / 1800) % 2;
    const cell = OPERATOR_CELL, scale = .8;
    if (this.operatorSheet.complete && this.operatorSheet.naturalWidth) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.operatorSheet, frame*cell.width, operatorRow(entity.dir)*cell.height,
        cell.width, cell.height, -cell.footX*scale, -cell.footY*scale, cell.width*scale, cell.height*scale);
    } else {
      // Keep the player visible during an asset load or a failed image request.
      ctx.fillStyle='#203443';ctx.beginPath();ctx.roundRect(-6,-25,12,20,4);ctx.fill();
      ctx.fillStyle='#c8997f';ctx.beginPath();ctx.ellipse(0,-29,5,6,0,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#0b1720';ctx.fillRect(-6,-8,5,9);ctx.fillRect(1,-8,5,9);
      ctx.fillStyle='#70d7df';ctx.fillRect(-4,-23,2,5);
    }
    if (self) {
      ctx.fillStyle = 'rgba(154,235,237,.85)';
      ctx.beginPath(); ctx.moveTo(0,-46); ctx.lineTo(-2.5,-49); ctx.lineTo(2.5,-49); ctx.fill();
    }
    if (name) {
      ctx.font = '500 10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const label = entity.name.slice(0, 20), w = ctx.measureText(label).width + 22;
      ctx.fillStyle = 'rgba(6,17,26,.72)'; ctx.beginPath(); ctx.roundRect(-w/2,-66,w,16,4); ctx.fill();
      ctx.fillStyle = self ? '#8cdbda' : '#a1b8c5'; ctx.beginPath(); ctx.arc(-w/2+7,-58,1.5,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = self ? '#d3eeed' : '#c2ced5'; ctx.fillText(label,4,-58);
    }
    ctx.restore();
  }

  private interactionAccent(ctx: CanvasRenderingContext2D, store: GameStore, now: number, tile: number) {
    const map = store.map!, self = store.selfEntity!;
    const candidate = nearbyInteractions(map,self.tileX,self.tileY,store.event?.markers)[0];
    const anchor = candidate && (candidate.kind === 'exit' ? map.exits?.find(p=>p.id===candidate.id)
      : candidate.kind === 'event' ? store.event?.markers.find(p=>p.id===candidate.id) : map.hotspots.find(p=>p.id===candidate.id));
    const key = candidate ? `${candidate.kind}:${candidate.id}` : '';
    if (anchor && (this.focus?.key !== key || this.focus.leaving)) this.focus={key,x:anchor.x,y:anchor.y,at:now,leaving:false};
    else if (!anchor && this.focus && !this.focus.leaving) { this.focus.leaving=true;this.focus.at=now; }
    const f=this.focus; if (!f) return;
    const fade=Math.min(1,(now-f.at)/160), alpha=f.leaving ? 1-fade : fade;
    if (alpha<=0 && f.leaving) { this.focus=null; return; }
    if (sceneAt(map,f.x,f.y)?.id !== sceneAt(map,self.tileX,self.tileY)?.id) return;
    const x=(f.x+.5)*tile,y=(f.y+.5)*tile;
    const pulse=this.reducedMotion.matches ? 0 : Math.sin(now/550)*.07;
    ctx.save();ctx.globalAlpha=alpha;ctx.translate(x,y);
    ctx.fillStyle=`rgba(111,222,217,${.05+pulse*.2})`;ctx.beginPath();ctx.ellipse(0,1,19,8,0,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle=`rgba(150,234,222,${.55+pulse})`;ctx.lineWidth=1.25;
    ctx.beginPath();ctx.moveTo(-13,-7);ctx.lineTo(-13,-12);ctx.lineTo(-8,-12);
    ctx.moveTo(8,-12);ctx.lineTo(13,-12);ctx.lineTo(13,-7);
    ctx.moveTo(-13,7);ctx.lineTo(-13,12);ctx.lineTo(-8,12);
    ctx.moveTo(8,12);ctx.lineTo(13,12);ctx.lineTo(13,7);ctx.stroke();
    ctx.restore();
  }

  private collision(ctx: CanvasRenderingContext2D, map: GameMap, scene: ArtScene, tile: number): void {
    for (let y = scene.y; y < scene.y + scene.height; y++) for (let x = scene.x; x < scene.x + scene.width; x++) {
      ctx.fillStyle = map.collision[y * map.width + x] ? 'rgba(240,61,77,.3)' : 'rgba(65,213,158,.18)';
      ctx.fillRect(x * tile, y * tile, tile, tile);
      ctx.strokeStyle = 'rgba(255,255,255,.11)'; ctx.lineWidth = .5; ctx.strokeRect(x * tile, y * tile, tile, tile);
    }
    for (const spot of [...map.hotspots, ...(map.exits || [])]) {
      if (sceneAt(map, spot.x, spot.y)?.id !== scene.id) continue;
      // Collision diagnostics mark exact anchors, not giant overlapping interaction circles.
      const x=(spot.x+.5)*tile,y=(spot.y+.5)*tile;
      ctx.strokeStyle = 'radius' in spot ? '#fff6b4' : '#8be6f0'; ctx.lineWidth = 2;
      ctx.strokeRect(x-7,y-7,14,14);
    }
  }
}
