import { chunkOf, encodeEntityEnter, encodeEntityLeave, encodeEntityTeleport, encodeS2CJson, isWalkable, sceneAt, type EventRequest } from '@heist/shared';
import type { World } from './world.js';
import type { ConnectionManager, ClientConnection } from '../net/connection.js';

/** Only server-position-validated terminal inspection and authored exit travel are enabled. */
export function handleWorldAction(world: World, connections: ConnectionManager, conn: ClientConnection, payload: string): void {
  let request: unknown;
  try { request = JSON.parse(payload); } catch { return; }
  if (!request || typeof request !== 'object') return;
  if ((request as {type?:string}).type==='game_action') {
    world.eventRuntime?.handle(conn,request as EventRequest);return;
  }
  const { type, id } = request as { type?:unknown;id?:unknown };
  if (type !== 'interact' || typeof id !== 'string' || id.length > 80) return;
  const entity = world.getEntity(conn.entityId);
  if (!entity) return;
  const error = (message:string) => conn.outbox.push(encodeS2CJson(JSON.stringify({type:'action_error',message})));
  const exit = world.map.exits?.find(e => e.id === id);
  const terminal = world.map.hotspots.find(h => h.id === id);
  const target = exit || terminal;
  if (!target) { error('This city location is unavailable.'); return; }
  const sameScene = sceneAt(world.map, target.x,target.y)?.id === sceneAt(world.map, entity.x,entity.y)?.id;
  if (!sameScene || Math.abs(entity.x-target.x)+Math.abs(entity.y-target.y) > (exit?.radius || 3)) {
    error('Walk next to the terminal or district entrance first.'); return;
  }
  if (!exit) {
    if (world.eventRuntime && !world.eventRuntime.canMove(conn.playerId) && terminal!.action!=='leaderboard') {error('This operator is in custody or has checked out.');return;}
    conn.outbox.push(encodeS2CJson(JSON.stringify({type:'interaction',id:terminal!.id,name:terminal!.name,action:terminal!.action,description:terminal!.description?.replace(/; training pays ₹0/gi,''),status:world.eventRuntime?'live':'preview'})));
    world.eventRuntime?.sendState(conn);
    return;
  }
  if(world.eventRuntime&&!world.eventRuntime.canTravel(conn.playerId)){error('District travel is unavailable in custody, during your raid, or after Checkout.');return;}
  if (!isWalkable(world.map,exit.targetX,exit.targetY)) { error('The destination entrance is blocked.'); return; }
  const oldVisible = world.getVisibleEntities(entity).filter(e=>e.id!==entity.id);
  // Clear predictions on both sides through the protocol's authoritative teleport.
  entity.pending.length = 0;
  entity.x=exit.targetX;entity.y=exit.targetY;
  entity.nextMoveTick=world.tick+world.config.stepTicks;entity.dirty=true;
  world.chunkGrid.update(entity,chunkOf(entity.x,entity.y,world.config.chunkSize));
  const newVisible=world.getVisibleEntities(entity).filter(e=>e.id!==entity.id);
  const oldIds=new Set(oldVisible.map(e=>e.id)),newIds=new Set(newVisible.map(e=>e.id));
  const teleport=encodeEntityTeleport(entity.id,entity.x,entity.y,entity.dir);
  conn.outbox.push(teleport);
  for(const other of oldVisible){
    if(!newIds.has(other.id)) { conn.outbox.push(encodeEntityLeave(other.id)); connections.get(other.id)?.outbox.push(encodeEntityLeave(entity.id)); }
  }
  for(const other of newVisible){
    if(!oldIds.has(other.id)) {
      conn.outbox.push(encodeEntityEnter(other.id,other.x,other.y,other.dir,other.name));
      connections.get(other.id)?.outbox.push(encodeEntityEnter(entity.id,entity.x,entity.y,entity.dir,entity.name));
    } else connections.get(other.id)?.outbox.push(teleport);
  }
}
