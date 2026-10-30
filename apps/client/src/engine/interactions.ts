import {sceneAt,type GameMap} from '@heist/shared';
export interface NearbyInteraction {id:string;name:string;kind:'exit'|'terminal'|'event';distance:number}
/** One shared client selection policy for the HUD and controller; server validates intent. */
export function nearbyInteractions(map:GameMap,x:number,y:number,markers:{id:string;name:string;x:number;y:number}[]=[]):NearbyInteraction[]{
  const scene=sceneAt(map,x,y)?.id;
  const all=[...map.hotspots.filter(h=>h.id).map(h=>({...h,id:h.id!,kind:'terminal' as const,radius:3})),
    ...(map.exits??[]).map(e=>({...e,kind:'exit' as const})),...markers.map(m=>({...m,kind:'event' as const,radius:1}))];
  return all.filter(p=>sceneAt(map,p.x,p.y)?.id===scene).map(p=>({id:p.id,name:p.name,kind:p.kind,distance:Math.abs(p.x-x)+Math.abs(p.y-y),radius:p.radius}))
    .filter(p=>p.distance<=p.radius).sort((a,b)=>a.distance-b.distance || (a.kind==='exit'?-1:1)-(b.kind==='exit'?-1:1) || a.id.localeCompare(b.id));
}
