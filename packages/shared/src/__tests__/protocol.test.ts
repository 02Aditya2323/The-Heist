/**
 * Tests for the binary protocol codec.
 * Spec requirement: round-trip unit tests for every opcode.
 */
import { describe, it, expect } from 'vitest';
import {
  C2S, S2C, DIR,
  encodeMove, encodePing, encodeC2SJson,
  encodeWelcome, encodeEntityEnter, encodeEntityLeave,
  encodeEntityMove, encodeMoveAck, encodeMoveReject,
  encodePong, encodeS2CJson, encodeKick, encodeEntityTeleport,
  decodeC2SFrame, decodeS2CFrame, concatMessages,
  type MoveMsg, type PingMsg, type C2SJsonMsg,
  type WelcomeMsg, type EntityEnterMsg, type EntityLeaveMsg,
  type EntityMoveMsg, type MoveAckMsg, type MoveRejectMsg,
  type PongMsg, type S2CJsonMsg, type KickMsg, type EntityTeleportMsg,
  type Direction,
} from '../index.js';

// ── Client → Server round-trips ─────────────────────────────────

describe('C2S Protocol', () => {
  it('MOVE round-trips correctly', () => {
    const encoded = encodeMove(1234, DIR.RIGHT);
    const msgs = decodeC2SFrame(encoded);
    expect(msgs).toHaveLength(1);
    const msg = msgs[0] as MoveMsg;
    expect(msg.opcode).toBe(C2S.MOVE);
    expect(msg.seq).toBe(1234);
    expect(msg.dir).toBe(DIR.RIGHT);
  });

  it('MOVE with max seq (65535)', () => {
    const encoded = encodeMove(65535, DIR.UP);
    const msgs = decodeC2SFrame(encoded);
    const msg = msgs[0] as MoveMsg;
    expect(msg.seq).toBe(65535);
    expect(msg.dir).toBe(DIR.UP);
  });

  it('MOVE with seq=0', () => {
    const encoded = encodeMove(0, DIR.DOWN);
    const msgs = decodeC2SFrame(encoded);
    const msg = msgs[0] as MoveMsg;
    expect(msg.seq).toBe(0);
    expect(msg.dir).toBe(DIR.DOWN);
  });

  it('PING round-trips correctly', () => {
    const encoded = encodePing(123456789);
    const msgs = decodeC2SFrame(encoded);
    expect(msgs).toHaveLength(1);
    const msg = msgs[0] as PingMsg;
    expect(msg.opcode).toBe(C2S.PING);
    expect(msg.clientTime).toBe(123456789);
  });

  it('PING with max u32', () => {
    const encoded = encodePing(0xffffffff);
    const msgs = decodeC2SFrame(encoded);
    const msg = msgs[0] as PingMsg;
    expect(msg.clientTime).toBe(0xffffffff);
  });

  it('C2S JSON round-trips correctly', () => {
    const payload = '{"type":"chat","text":"hello world"}';
    const encoded = encodeC2SJson(payload);
    const msgs = decodeC2SFrame(encoded);
    expect(msgs).toHaveLength(1);
    const msg = msgs[0] as C2SJsonMsg;
    expect(msg.opcode).toBe(C2S.JSON);
    expect(msg.payload).toBe(payload);
  });

  it('C2S JSON with unicode', () => {
    const payload = '{"emoji":"🎮🎯"}';
    const encoded = encodeC2SJson(payload);
    const msgs = decodeC2SFrame(encoded);
    const msg = msgs[0] as C2SJsonMsg;
    expect(msg.payload).toBe(payload);
  });

  it('C2S JSON with empty string', () => {
    const encoded = encodeC2SJson('');
    const msgs = decodeC2SFrame(encoded);
    const msg = msgs[0] as C2SJsonMsg;
    expect(msg.payload).toBe('');
  });

  it('Multiple C2S messages in one frame', () => {
    const frame = concatMessages([
      encodeMove(1, DIR.UP),
      encodeMove(2, DIR.DOWN),
      encodePing(42),
      encodeMove(3, DIR.LEFT),
    ]);
    const msgs = decodeC2SFrame(frame);
    expect(msgs).toHaveLength(4);
    expect((msgs[0] as MoveMsg).seq).toBe(1);
    expect((msgs[0] as MoveMsg).dir).toBe(DIR.UP);
    expect((msgs[1] as MoveMsg).seq).toBe(2);
    expect((msgs[2] as PingMsg).clientTime).toBe(42);
    expect((msgs[3] as MoveMsg).seq).toBe(3);
    expect((msgs[3] as MoveMsg).dir).toBe(DIR.LEFT);
  });

  it('Empty frame returns empty array', () => {
    const msgs = decodeC2SFrame(new ArrayBuffer(0));
    expect(msgs).toHaveLength(0);
  });

  it('Unknown opcode returns null and stops parsing', () => {
    const buf = new Uint8Array([0xFF, 0x00, 0x00]);
    const msgs = decodeC2SFrame(buf);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toBeNull();
  });
});

// ── Server → Client round-trips ─────────────────────────────────

describe('S2C Protocol', () => {
  it('WELCOME round-trips correctly', () => {
    const encoded = encodeWelcome(42, 100, 200, DIR.UP, 20, 5, 1, 12345);
    const msgs = decodeS2CFrame(encoded);
    expect(msgs).toHaveLength(1);
    const msg = msgs[0] as WelcomeMsg;
    expect(msg.opcode).toBe(S2C.WELCOME);
    expect(msg.selfId).toBe(42);
    expect(msg.x).toBe(100);
    expect(msg.y).toBe(200);
    expect(msg.dir).toBe(DIR.UP);
    expect(msg.tickRate).toBe(20);
    expect(msg.stepTicks).toBe(5);
    expect(msg.mapVersion).toBe(1);
    expect(msg.serverTick).toBe(12345);
  });

  it('WELCOME with large tick value', () => {
    const encoded = encodeWelcome(1, 0, 0, DIR.DOWN, 20, 5, 1, 0xfffffffe);
    const msgs = decodeS2CFrame(encoded);
    const msg = msgs[0] as WelcomeMsg;
    expect(msg.serverTick).toBe(0xfffffffe);
  });

  it('ENTITY_ENTER round-trips correctly', () => {
    const encoded = encodeEntityEnter(7, 50, 75, DIR.LEFT, 'TestPlayer');
    const msgs = decodeS2CFrame(encoded);
    expect(msgs).toHaveLength(1);
    const msg = msgs[0] as EntityEnterMsg;
    expect(msg.opcode).toBe(S2C.ENTITY_ENTER);
    expect(msg.id).toBe(7);
    expect(msg.x).toBe(50);
    expect(msg.y).toBe(75);
    expect(msg.dir).toBe(DIR.LEFT);
    expect(msg.name).toBe('TestPlayer');
  });

  it('ENTITY_ENTER with max-length name', () => {
    const longName = 'A'.repeat(20); // MAX_USERNAME_LEN
    const encoded = encodeEntityEnter(1, 0, 0, DIR.UP, longName);
    const msgs = decodeS2CFrame(encoded);
    const msg = msgs[0] as EntityEnterMsg;
    expect(msg.name).toBe(longName);
  });

  it('ENTITY_ENTER with single-char name', () => {
    const encoded = encodeEntityEnter(1, 0, 0, DIR.UP, 'X');
    const msgs = decodeS2CFrame(encoded);
    const msg = msgs[0] as EntityEnterMsg;
    expect(msg.name).toBe('X');
  });

  it('ENTITY_LEAVE round-trips correctly', () => {
    const encoded = encodeEntityLeave(99);
    const msgs = decodeS2CFrame(encoded);
    expect(msgs).toHaveLength(1);
    const msg = msgs[0] as EntityLeaveMsg;
    expect(msg.opcode).toBe(S2C.ENTITY_LEAVE);
    expect(msg.id).toBe(99);
  });

  it('ENTITY_MOVE round-trips correctly', () => {
    const encoded = encodeEntityMove(12, 128, 64, DIR.RIGHT);
    const msgs = decodeS2CFrame(encoded);
    expect(msgs).toHaveLength(1);
    const msg = msgs[0] as EntityMoveMsg;
    expect(msg.opcode).toBe(S2C.ENTITY_MOVE);
    expect(msg.id).toBe(12);
    expect(msg.x).toBe(128);
    expect(msg.y).toBe(64);
    expect(msg.dir).toBe(DIR.RIGHT);
  });

  it('ENTITY_MOVE is exactly 8 bytes (spec requirement)', () => {
    const encoded = encodeEntityMove(1, 1, 1, DIR.UP);
    expect(encoded.byteLength).toBe(8);
  });

  it('MOVE_ACK round-trips correctly', () => {
    const encoded = encodeMoveAck(555, 30, 40);
    const msgs = decodeS2CFrame(encoded);
    expect(msgs).toHaveLength(1);
    const msg = msgs[0] as MoveAckMsg;
    expect(msg.opcode).toBe(S2C.MOVE_ACK);
    expect(msg.seq).toBe(555);
    expect(msg.x).toBe(30);
    expect(msg.y).toBe(40);
  });

  it('MOVE_REJECT round-trips correctly', () => {
    const encoded = encodeMoveReject(777, 50, 60, DIR.DOWN);
    const msgs = decodeS2CFrame(encoded);
    expect(msgs).toHaveLength(1);
    const msg = msgs[0] as MoveRejectMsg;
    expect(msg.opcode).toBe(S2C.MOVE_REJECT);
    expect(msg.seq).toBe(777);
    expect(msg.x).toBe(50);
    expect(msg.y).toBe(60);
    expect(msg.dir).toBe(DIR.DOWN);
  });

  it('PONG round-trips correctly', () => {
    const encoded = encodePong(99999, 5000);
    const msgs = decodeS2CFrame(encoded);
    expect(msgs).toHaveLength(1);
    const msg = msgs[0] as PongMsg;
    expect(msg.opcode).toBe(S2C.PONG);
    expect(msg.clientTime).toBe(99999);
    expect(msg.serverTick).toBe(5000);
  });

  it('S2C JSON round-trips correctly', () => {
    const payload = '{"type":"challenge","id":42}';
    const encoded = encodeS2CJson(payload);
    const msgs = decodeS2CFrame(encoded);
    expect(msgs).toHaveLength(1);
    const msg = msgs[0] as S2CJsonMsg;
    expect(msg.opcode).toBe(S2C.JSON);
    expect(msg.payload).toBe(payload);
  });

  it('KICK round-trips correctly', () => {
    const encoded = encodeKick(3);
    const msgs = decodeS2CFrame(encoded);
    expect(msgs).toHaveLength(1);
    const msg = msgs[0] as KickMsg;
    expect(msg.opcode).toBe(S2C.KICK);
    expect(msg.reason).toBe(3);
  });

  it('ENTITY_TELEPORT round-trips correctly', () => {
    const encoded = encodeEntityTeleport(5, 200, 150, DIR.LEFT);
    const msgs = decodeS2CFrame(encoded);
    expect(msgs).toHaveLength(1);
    const msg = msgs[0] as EntityTeleportMsg;
    expect(msg.opcode).toBe(S2C.ENTITY_TELEPORT);
    expect(msg.id).toBe(5);
    expect(msg.x).toBe(200);
    expect(msg.y).toBe(150);
    expect(msg.dir).toBe(DIR.LEFT);
  });

  it('Multiple S2C messages in one frame', () => {
    const frame = concatMessages([
      encodeEntityEnter(1, 10, 20, DIR.UP, 'Alice'),
      encodeEntityEnter(2, 30, 40, DIR.DOWN, 'Bob'),
      encodeEntityMove(1, 10, 19, DIR.UP),
      encodeMoveAck(1, 10, 19),
      encodeEntityLeave(2),
    ]);
    const msgs = decodeS2CFrame(frame);
    expect(msgs).toHaveLength(5);
    expect((msgs[0] as EntityEnterMsg).name).toBe('Alice');
    expect((msgs[1] as EntityEnterMsg).name).toBe('Bob');
    expect((msgs[2] as EntityMoveMsg).y).toBe(19);
    expect((msgs[3] as MoveAckMsg).seq).toBe(1);
    expect((msgs[4] as EntityLeaveMsg).id).toBe(2);
  });

  it('All directions round-trip through ENTITY_MOVE', () => {
    for (const dir of [DIR.UP, DIR.DOWN, DIR.LEFT, DIR.RIGHT] as Direction[]) {
      const encoded = encodeEntityMove(1, 50, 50, dir);
      const msgs = decodeS2CFrame(encoded);
      expect((msgs[0] as EntityMoveMsg).dir).toBe(dir);
    }
  });

  it('Edge case: id=0 and coordinates=0', () => {
    const encoded = encodeEntityMove(0, 0, 0, DIR.UP);
    const msgs = decodeS2CFrame(encoded);
    const msg = msgs[0] as EntityMoveMsg;
    expect(msg.id).toBe(0);
    expect(msg.x).toBe(0);
    expect(msg.y).toBe(0);
  });

  it('Edge case: max u16 values', () => {
    const encoded = encodeEntityMove(0xffff, 0xffff, 0xffff, DIR.RIGHT);
    const msgs = decodeS2CFrame(encoded);
    const msg = msgs[0] as EntityMoveMsg;
    expect(msg.id).toBe(0xffff);
    expect(msg.x).toBe(0xffff);
    expect(msg.y).toBe(0xffff);
  });
});

// ── concatMessages ──────────────────────────────────────────────

describe('concatMessages', () => {
  it('concatenates multiple messages into one buffer', () => {
    const a = encodeMove(1, DIR.UP);    // 4 bytes
    const b = encodePing(100);          // 5 bytes
    const result = concatMessages([a, b]);
    expect(result.byteLength).toBe(9);
  });

  it('empty array returns empty buffer', () => {
    const result = concatMessages([]);
    expect(result.byteLength).toBe(0);
  });

  it('single message returns same bytes', () => {
    const a = encodeMove(42, DIR.LEFT);
    const result = concatMessages([a]);
    expect(result).toEqual(a);
  });
});
