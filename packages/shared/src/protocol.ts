/**
 * @heist/shared - protocol.ts
 *
 * Binary protocol codec for the hot path (little-endian).
 * Each WS frame contains one or more back-to-back messages: [opcode u8][payload].
 * Payload length is fixed per opcode (except JSON which has a length prefix).
 *
 * Rule from spec: packages/shared/protocol.ts must expose encodeX / decodeFrame
 * and have round-trip unit tests for every opcode.
 */

import { C2S, S2C, type Direction } from './constants.js';

// ── Message types ───────────────────────────────────────────────────────────

// Client → Server
export interface MoveMsg {
  opcode: typeof C2S.MOVE;
  seq: number;
  dir: Direction;
}

export interface PingMsg {
  opcode: typeof C2S.PING;
  clientTime: number;
}

export interface C2SJsonMsg {
  opcode: typeof C2S.JSON;
  payload: string;
}

export type C2SMessage = MoveMsg | PingMsg | C2SJsonMsg;

// Server → Client
export interface WelcomeMsg {
  opcode: typeof S2C.WELCOME;
  selfId: number;
  x: number;
  y: number;
  dir: Direction;
  tickRate: number;
  stepTicks: number;
  mapVersion: number;
  serverTick: number;
}

export interface EntityEnterMsg {
  opcode: typeof S2C.ENTITY_ENTER;
  id: number;
  x: number;
  y: number;
  dir: Direction;
  name: string;
}

export interface EntityLeaveMsg {
  opcode: typeof S2C.ENTITY_LEAVE;
  id: number;
}

export interface EntityMoveMsg {
  opcode: typeof S2C.ENTITY_MOVE;
  id: number;
  x: number;
  y: number;
  dir: Direction;
}

export interface MoveAckMsg {
  opcode: typeof S2C.MOVE_ACK;
  seq: number;
  x: number;
  y: number;
}

export interface MoveRejectMsg {
  opcode: typeof S2C.MOVE_REJECT;
  seq: number;
  x: number;
  y: number;
  dir: Direction;
}

export interface PongMsg {
  opcode: typeof S2C.PONG;
  clientTime: number;
  serverTick: number;
}

export interface S2CJsonMsg {
  opcode: typeof S2C.JSON;
  payload: string;
}

export interface KickMsg {
  opcode: typeof S2C.KICK;
  reason: number;
}

export interface EntityTeleportMsg {
  opcode: typeof S2C.ENTITY_TELEPORT;
  id: number;
  x: number;
  y: number;
  dir: Direction;
}

export type S2CMessage =
  | WelcomeMsg
  | EntityEnterMsg
  | EntityLeaveMsg
  | EntityMoveMsg
  | MoveAckMsg
  | MoveRejectMsg
  | PongMsg
  | S2CJsonMsg
  | KickMsg
  | EntityTeleportMsg;

export type AnyMessage = C2SMessage | S2CMessage;

// ── Payload sizes (bytes, excluding the 1-byte opcode) ──────────────────────

const C2S_SIZES: Record<number, number | 'variable'> = {
  [C2S.MOVE]: 3,         // seq u16 + dir u8
  [C2S.PING]: 4,         // clientTime u32
  [C2S.JSON]: 'variable',
};

const S2C_SIZES: Record<number, number | 'variable'> = {
  [S2C.WELCOME]: 14,     // selfId u16 + x u16 + y u16 + dir u8 + tickRate u8 + stepTicks u8 + mapVersion u16 + serverTick u32 = 14
  [S2C.ENTITY_ENTER]: 'variable', // id u16 + x u16 + y u16 + dir u8 + nameLen u8 + name[nameLen]
  [S2C.ENTITY_LEAVE]: 2, // id u16
  [S2C.ENTITY_MOVE]: 7,  // id u16 + x u16 + y u16 + dir u8
  [S2C.MOVE_ACK]: 6,     // seq u16 + x u16 + y u16
  [S2C.MOVE_REJECT]: 7,  // seq u16 + x u16 + y u16 + dir u8
  [S2C.PONG]: 8,         // clientTime u32 + serverTick u32
  [S2C.JSON]: 'variable',
  [S2C.KICK]: 1,         // reason u8
  [S2C.ENTITY_TELEPORT]: 7, // id u16 + x u16 + y u16 + dir u8
};

// ── Encoders (Client → Server) ─────────────────────────────────────────────

export function encodeMove(seq: number, dir: Direction): Uint8Array {
  const buf = new ArrayBuffer(4);
  const view = new DataView(buf);
  view.setUint8(0, C2S.MOVE);
  view.setUint16(1, seq, true);
  view.setUint8(3, dir);
  return new Uint8Array(buf);
}

export function encodePing(clientTime: number): Uint8Array {
  const buf = new ArrayBuffer(5);
  const view = new DataView(buf);
  view.setUint8(0, C2S.PING);
  view.setUint32(1, clientTime, true);
  return new Uint8Array(buf);
}

export function encodeC2SJson(payload: string): Uint8Array {
  const encoded = new TextEncoder().encode(payload);
  const buf = new ArrayBuffer(3 + encoded.length);
  const view = new DataView(buf);
  view.setUint8(0, C2S.JSON);
  view.setUint16(1, encoded.length, true);
  new Uint8Array(buf).set(encoded, 3);
  return new Uint8Array(buf);
}

// ── Encoders (Server → Client) ─────────────────────────────────────────────

export function encodeWelcome(
  selfId: number, x: number, y: number, dir: Direction,
  tickRate: number, stepTicks: number, mapVersion: number, serverTick: number,
): Uint8Array {
  // opcode(1) + selfId(2) + x(2) + y(2) + dir(1) + tickRate(1) + stepTicks(1) + mapVersion(2) + serverTick(4) = 16
  const buf = new ArrayBuffer(16);
  const view = new DataView(buf);
  let off = 0;
  view.setUint8(off++, S2C.WELCOME);
  view.setUint16(off, selfId, true); off += 2;
  view.setUint16(off, x, true); off += 2;
  view.setUint16(off, y, true); off += 2;
  view.setUint8(off++, dir);
  view.setUint8(off++, tickRate);
  view.setUint8(off++, stepTicks);
  view.setUint16(off, mapVersion, true); off += 2;
  view.setUint32(off, serverTick >>> 0, true);
  return new Uint8Array(buf);
}

export function encodeEntityEnter(
  id: number, x: number, y: number, dir: Direction, name: string,
): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  if (nameBytes.length > 255) throw new Error('Name too long for ENTITY_ENTER');
  // opcode(1) + id(2) + x(2) + y(2) + dir(1) + nameLen(1) + name
  const total = 1 + 2 + 2 + 2 + 1 + 1 + nameBytes.length;
  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  let off = 0;
  view.setUint8(off++, S2C.ENTITY_ENTER);
  view.setUint16(off, id, true); off += 2;
  view.setUint16(off, x, true); off += 2;
  view.setUint16(off, y, true); off += 2;
  view.setUint8(off++, dir);
  view.setUint8(off++, nameBytes.length);
  new Uint8Array(buf).set(nameBytes, off);
  return new Uint8Array(buf);
}

export function encodeEntityLeave(id: number): Uint8Array {
  const buf = new Uint8Array(3);
  buf[0] = S2C.ENTITY_LEAVE;
  buf[1] = id & 0xff;
  buf[2] = (id >> 8) & 0xff;
  return buf;
}

export function encodeEntityMove(
  id: number, x: number, y: number, dir: Direction,
): Uint8Array {
  const buf = new Uint8Array(8);
  buf[0] = S2C.ENTITY_MOVE;
  buf[1] = id & 0xff;
  buf[2] = (id >> 8) & 0xff;
  buf[3] = x & 0xff;
  buf[4] = (x >> 8) & 0xff;
  buf[5] = y & 0xff;
  buf[6] = (y >> 8) & 0xff;
  buf[7] = dir;
  return buf;
}

export function encodeMoveAck(seq: number, x: number, y: number): Uint8Array {
  const buf = new Uint8Array(7);
  buf[0] = S2C.MOVE_ACK;
  buf[1] = seq & 0xff;
  buf[2] = (seq >> 8) & 0xff;
  buf[3] = x & 0xff;
  buf[4] = (x >> 8) & 0xff;
  buf[5] = y & 0xff;
  buf[6] = (y >> 8) & 0xff;
  return buf;
}

export function encodeMoveReject(
  seq: number, x: number, y: number, dir: Direction,
): Uint8Array {
  const buf = new Uint8Array(8);
  buf[0] = S2C.MOVE_REJECT;
  buf[1] = seq & 0xff;
  buf[2] = (seq >> 8) & 0xff;
  buf[3] = x & 0xff;
  buf[4] = (x >> 8) & 0xff;
  buf[5] = y & 0xff;
  buf[6] = (y >> 8) & 0xff;
  buf[7] = dir;
  return buf;
}

export function encodePong(clientTime: number, serverTick: number): Uint8Array {
  const buf = new Uint8Array(9);
  buf[0] = S2C.PONG;
  buf[1] = clientTime & 0xff;
  buf[2] = (clientTime >>> 8) & 0xff;
  buf[3] = (clientTime >>> 16) & 0xff;
  buf[4] = (clientTime >>> 24) & 0xff;
  buf[5] = serverTick & 0xff;
  buf[6] = (serverTick >>> 8) & 0xff;
  buf[7] = (serverTick >>> 16) & 0xff;
  buf[8] = (serverTick >>> 24) & 0xff;
  return buf;
}

export function encodeS2CJson(payload: string): Uint8Array {
  const encoded = new TextEncoder().encode(payload);
  const buf = new ArrayBuffer(3 + encoded.length);
  const view = new DataView(buf);
  view.setUint8(0, S2C.JSON);
  view.setUint16(1, encoded.length, true);
  new Uint8Array(buf).set(encoded, 3);
  return new Uint8Array(buf);
}

export function encodeKick(reason: number): Uint8Array {
  const buf = new ArrayBuffer(2);
  const view = new DataView(buf);
  view.setUint8(0, S2C.KICK);
  view.setUint8(1, reason);
  return new Uint8Array(buf);
}

export function encodeEntityTeleport(
  id: number, x: number, y: number, dir: Direction,
): Uint8Array {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  let off = 0;
  view.setUint8(off++, S2C.ENTITY_TELEPORT);
  view.setUint16(off, id, true); off += 2;
  view.setUint16(off, x, true); off += 2;
  view.setUint16(off, y, true); off += 2;
  view.setUint8(off, dir);
  return new Uint8Array(buf);
}

// ── Frame concatenation ─────────────────────────────────────────────────────

/** Concatenate multiple encoded messages into a single binary frame for one ws.send */
export function concatMessages(msgs: Uint8Array[]): Uint8Array {
  if (msgs.length === 0) return new Uint8Array(0);
  if (msgs.length === 1) return msgs[0];
  let totalLen = 0;
  for (let i = 0; i < msgs.length; i++) totalLen += msgs[i].length;
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (let i = 0; i < msgs.length; i++) {
    out.set(msgs[i], offset);
    offset += msgs[i].length;
  }
  return out;
}

// ── Decoders ────────────────────────────────────────────────────────────────

/**
 * Decode a binary frame into an array of messages.
 * A frame may contain multiple back-to-back messages.
 * Returns decoded messages. Unknown opcodes are skipped (returns null for that slot).
 */
export function decodeC2SFrame(data: ArrayBuffer | Uint8Array): (C2SMessage | null)[] {
  const buf = data instanceof Uint8Array ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data;
  const view = new DataView(buf);
  const len = view.byteLength;
  const messages: (C2SMessage | null)[] = [];
  let off = 0;

  while (off < len) {
    const opcode = view.getUint8(off);
    off++;

    switch (opcode) {
      case C2S.MOVE: {
        if (off + 3 > len) return messages; // truncated
        const seq = view.getUint16(off, true); off += 2;
        const dir = view.getUint8(off) as Direction; off += 1;
        messages.push({ opcode: C2S.MOVE, seq, dir });
        break;
      }
      case C2S.PING: {
        if (off + 4 > len) return messages;
        const clientTime = view.getUint32(off, true); off += 4;
        messages.push({ opcode: C2S.PING, clientTime });
        break;
      }
      case C2S.JSON: {
        if (off + 2 > len) return messages;
        const strLen = view.getUint16(off, true); off += 2;
        if (off + strLen > len) return messages;
        const bytes = new Uint8Array(buf, off, strLen);
        const payload = new TextDecoder().decode(bytes);
        off += strLen;
        messages.push({ opcode: C2S.JSON, payload });
        break;
      }
      default:
        // Unknown opcode — we can't know the payload length, so stop parsing
        messages.push(null);
        return messages;
    }
  }

  return messages;
}

export function decodeS2CFrame(data: ArrayBuffer | Uint8Array): (S2CMessage | null)[] {
  const buf = data instanceof Uint8Array
    ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
    : data;
  const view = new DataView(buf);
  const len = view.byteLength;
  const messages: (S2CMessage | null)[] = [];
  let off = 0;

  while (off < len) {
    const opcode = view.getUint8(off);
    off++;

    switch (opcode) {
      case S2C.WELCOME: {
        if (off + 15 > len) return messages;
        const selfId = view.getUint16(off, true); off += 2;
        const x = view.getUint16(off, true); off += 2;
        const y = view.getUint16(off, true); off += 2;
        const dir = view.getUint8(off) as Direction; off += 1;
        const tickRate = view.getUint8(off); off += 1;
        const stepTicks = view.getUint8(off); off += 1;
        const mapVersion = view.getUint16(off, true); off += 2;
        const serverTick = view.getUint32(off, true); off += 4;
        messages.push({
          opcode: S2C.WELCOME, selfId, x, y, dir,
          tickRate, stepTicks, mapVersion, serverTick,
        });
        break;
      }
      case S2C.ENTITY_ENTER: {
        if (off + 8 > len) return messages; // minimum: id+x+y+dir+nameLen = 8
        const id = view.getUint16(off, true); off += 2;
        const x = view.getUint16(off, true); off += 2;
        const y = view.getUint16(off, true); off += 2;
        const dir = view.getUint8(off) as Direction; off += 1;
        const nameLen = view.getUint8(off); off += 1;
        if (off + nameLen > len) return messages;
        const nameBytes = new Uint8Array(buf, off, nameLen);
        const name = new TextDecoder().decode(nameBytes);
        off += nameLen;
        messages.push({ opcode: S2C.ENTITY_ENTER, id, x, y, dir, name });
        break;
      }
      case S2C.ENTITY_LEAVE: {
        if (off + 2 > len) return messages;
        const id = view.getUint16(off, true); off += 2;
        messages.push({ opcode: S2C.ENTITY_LEAVE, id });
        break;
      }
      case S2C.ENTITY_MOVE: {
        if (off + 7 > len) return messages;
        const id = view.getUint16(off, true); off += 2;
        const x = view.getUint16(off, true); off += 2;
        const y = view.getUint16(off, true); off += 2;
        const dir = view.getUint8(off) as Direction; off += 1;
        messages.push({ opcode: S2C.ENTITY_MOVE, id, x, y, dir });
        break;
      }
      case S2C.MOVE_ACK: {
        if (off + 6 > len) return messages;
        const seq = view.getUint16(off, true); off += 2;
        const x = view.getUint16(off, true); off += 2;
        const y = view.getUint16(off, true); off += 2;
        messages.push({ opcode: S2C.MOVE_ACK, seq, x, y });
        break;
      }
      case S2C.MOVE_REJECT: {
        if (off + 7 > len) return messages;
        const seq = view.getUint16(off, true); off += 2;
        const x = view.getUint16(off, true); off += 2;
        const y = view.getUint16(off, true); off += 2;
        const dir = view.getUint8(off) as Direction; off += 1;
        messages.push({ opcode: S2C.MOVE_REJECT, seq, x, y, dir });
        break;
      }
      case S2C.PONG: {
        if (off + 8 > len) return messages;
        const clientTime = view.getUint32(off, true); off += 4;
        const serverTick = view.getUint32(off, true); off += 4;
        messages.push({ opcode: S2C.PONG, clientTime, serverTick });
        break;
      }
      case S2C.JSON: {
        if (off + 2 > len) return messages;
        const strLen = view.getUint16(off, true); off += 2;
        if (off + strLen > len) return messages;
        const bytes = new Uint8Array(buf, off, strLen);
        const payload = new TextDecoder().decode(bytes);
        off += strLen;
        messages.push({ opcode: S2C.JSON, payload });
        break;
      }
      case S2C.KICK: {
        if (off + 1 > len) return messages;
        const reason = view.getUint8(off); off += 1;
        messages.push({ opcode: S2C.KICK, reason });
        break;
      }
      case S2C.ENTITY_TELEPORT: {
        if (off + 7 > len) return messages;
        const id = view.getUint16(off, true); off += 2;
        const x = view.getUint16(off, true); off += 2;
        const y = view.getUint16(off, true); off += 2;
        const dir = view.getUint8(off) as Direction; off += 1;
        messages.push({ opcode: S2C.ENTITY_TELEPORT, id, x, y, dir });
        break;
      }
      default:
        messages.push(null);
        return messages;
    }
  }

  return messages;
}
