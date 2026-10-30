import { sceneAt, type GameMap } from '@heist/shared';
import type { GameStore } from '../game/store.js';
import type { ArtWorldRenderer } from '../render/art-world.js';
import { CityAtlas } from './city-atlas.js';
import {nearbyInteractions,type NearbyInteraction} from '../engine/interactions.js';

export class WorldUI {
  private lastUpdate = 0;
  private sceneSelect: HTMLSelectElement;
  private dialog: HTMLDialogElement;
  private inspect = false;
  private crowded = false;
  private onInteract: (choice:NearbyInteraction) => void = () => {};
  private choices = document.createElement('dialog');
  private atlas: CityAtlas;

  constructor(private store: GameStore, private renderer: ArtWorldRenderer, private onPause: (paused: boolean) => void) {
    this.sceneSelect = document.getElementById('scene-select') as HTMLSelectElement;
    this.dialog = document.getElementById('terminal-dialog') as HTMLDialogElement;
    this.atlas = new CityAtlas(store, (scene,focus) => {
      this.atlas.hide();
      document.getElementById('map-inspector')!.hidden = false;
      this.sceneSelect.value = scene.id;
      if (this.store.map) renderer.inspectScene(scene, this.store.map,focus);
    });
    document.getElementById('atlas-close')!.addEventListener('click', () => this.toggleInspector(false));
    document.getElementById('world-overview')!.addEventListener('click', () => this.toggleInspector(true));
    document.getElementById('inspect-map')!.addEventListener('click', () => this.toggleInspector());
    document.getElementById('return-to-game')!.addEventListener('click', () => this.toggleInspector(false));
    document.getElementById('zoom-in')!.addEventListener('click', () => renderer.setZoom(renderer.zoom + .1));
    document.getElementById('zoom-out')!.addEventListener('click', () => renderer.setZoom(renderer.zoom - .1));
    document.getElementById('zoom-native')!.addEventListener('click', () => renderer.setZoom(1));
    document.getElementById('toggle-crowd-names')!.addEventListener('click', () => { this.crowded = !this.crowded; renderer.showNames = !this.crowded; });
    this.choices.className='interaction-choices';this.choices.setAttribute('aria-label','Choose nearby interaction');document.body.append(this.choices);
    this.choices.addEventListener('close',()=>this.onPause(this.inspect || !!document.querySelector('dialog[open]')));
    document.getElementById('interact-button')!.addEventListener('click', () => this.requestInteraction());
    this.sceneSelect.addEventListener('change', () => {
      const s = this.store.map?.scenes?.find(s => s.id === this.sceneSelect.value);
      if (s && this.store.map) renderer.inspectScene(s, this.store.map);
    });
    document.getElementById('dialog-close')!.addEventListener('click', () => this.dialog.close());
    this.dialog.addEventListener('close', () => this.onPause(this.inspect || !!document.querySelector('dialog[open]')));
    window.addEventListener('keydown', e => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.code === 'KeyM' && !e.repeat && !document.querySelector('dialog[open]')) { e.preventDefault(); this.toggleInspector(this.inspect && !this.atlas.visible ? true : undefined); }
      if ((e.code === 'KeyE' || e.code === 'Space') && !e.repeat && !this.inspect && !document.querySelector('dialog[open]')) { e.preventDefault(); this.requestInteraction(); }
      if (e.code === 'Escape' && this.inspect) this.toggleInspector(false);
    });
  }

  setMap(map: GameMap): void {
    const selected = this.sceneSelect.value;
    this.sceneSelect.replaceChildren();
    for (const scene of map.scenes || []) {
      const option = document.createElement('option'); option.value = scene.id;
      option.textContent = `${scene.kind === 'connector' ? '↔ ' : ''}${scene.name}`;
      this.sceneSelect.append(option);
    }
    this.sceneSelect.value = selected || 'central';
    this.atlas.setMap();
    this.update(performance.now() + 1000);
  }

  bindInteraction(callback: (choice:NearbyInteraction) => void): void { this.onInteract = callback; }
  private requestInteraction(){
    const {selfEntity:self,map}=this.store;if(!self||!map||this.inspect||this.store.connectionStatus.state!=='CONNECTED'||document.querySelector('dialog[open]'))return;
    const choices=nearbyInteractions(map,self.tileX,self.tileY,this.store.event?.markers);
    if(choices.length===1){this.onInteract(choices[0]);return;}if(!choices.length)return;
    this.choices.replaceChildren();const title=document.createElement('h2');title.textContent='Choose your next move';this.choices.append(title);
    for(const choice of choices){const button=document.createElement('button');button.type='button';button.textContent=`${choice.kind==='exit'?'Travel →':choice.kind==='event'?'Event ·':'Open ·'} ${choice.name}`;
      button.addEventListener('click',()=>{this.choices.close();this.onPause(false);this.onInteract(choice);});this.choices.append(button);}
    const close=document.createElement('button');close.type='button';close.textContent='Cancel · Esc';close.addEventListener('click',()=>this.choices.close());this.choices.append(close);this.choices.showModal();this.onPause(true);
  }
  toggleInspector(force?: boolean): void {
    this.inspect = force ?? !this.inspect;
    document.getElementById('map-inspector')!.hidden = true;
    if (this.inspect) {
      this.renderer.returnToPlayer();
      this.atlas.show();
    } else { this.atlas.hide(); this.renderer.returnToPlayer(); }
    this.onPause(this.inspect || this.dialog.open);
  }

  update(now: number): void {
    this.atlas.update(now);
    if (now - this.lastUpdate < 150) return;
    this.lastUpdate = now;
    const { selfEntity: self, map } = this.store;
    const previewScene = map?.scenes?.find(s => s.id === this.renderer.previewSceneId);
    const current = previewScene || (map && self ? sceneAt(map, self.tileX, self.tileY) : map?.scenes?.find(s => s.id === 'central'));
    document.getElementById('district-title')!.textContent = current?.name || 'Veyra City';
    document.getElementById('district-subtitle')!.textContent = this.inspect ? 'MAP REVIEW · generated city · drag to pan' : self ? 'VEYRA CITY · ZERO HOUR' : 'CITY PREVIEW · sign in to walk';
    document.getElementById('connection-readout')!.textContent = self ? `${this.store.connectionStatus.state.toLowerCase()} · ${this.store.pingMs} ms` : 'city preview';
    document.getElementById('player-readout')!.textContent = `${this.store.entities.size + (self ? 1 : 0)} nearby`;
    document.getElementById('zoom-readout')!.textContent = `${Math.round(this.renderer.zoom * 100)}%`;
    document.getElementById('render-error')!.textContent = this.renderer.imageError || '';
    document.getElementById('art-load-state')!.textContent = current
      ? `${current.name} artwork ${this.renderer.isSceneLoaded(current.id) ? 'loaded' : 'loading…'}` : '';
    const choices = self && map ? nearbyInteractions(map,self.tileX,self.tileY,this.store.event?.markers) : [];
    const candidate = choices[0];
    const action = document.getElementById('interact-button') as HTMLButtonElement;
    const visible = !!candidate && !this.inspect && !document.querySelector('dialog[open]');
    if (visible && (action.hidden || action.dataset.target !== candidate!.id)) {
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches)
        action.animate([{opacity:0,scale:'.96',translate:'0 4px'},{opacity:1,scale:'1',translate:'0 0'}],{duration:170,easing:'ease-out'});
    }
    action.dataset.target = candidate?.id || '';
    action.hidden = !visible;
    action.textContent = choices.length>1 ? `E · Choose interaction (${choices.length})` : candidate ? `E · ${candidate.name}` : '';
  }

  showTerminal(payload: unknown): void {
    if (!payload || typeof payload !== 'object') return;
    const message = payload as Record<string, unknown>;
    if (message.type !== 'interaction' && message.type !== 'action_error') return;
    document.getElementById('terminal-title')!.textContent = typeof message.name === 'string' ? message.name : 'City terminal';
    document.getElementById('terminal-copy')!.textContent = typeof message.description === 'string' ? message.description : typeof message.message === 'string' ? message.message : '';
    document.getElementById('terminal-state')!.textContent = message.type === 'action_error' ? 'Move closer and try again.' : 'Location verified. Your actions are checked and settled by the server.';
    document.getElementById('terminal-game')!.replaceChildren();
    if (!this.dialog.open) this.dialog.showModal();
    this.onPause(true);
  }
}
