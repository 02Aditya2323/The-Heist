import { WebSocket } from "ws";
import {
  DIR,
  S2C,
  encodeMove,
  encodePing,
  encodeC2SJson,
  decodeS2CFrame,
  tryStep,
  type GameMap,
  type Direction,
  type EventView,
} from "@heist/shared";
import { Samples } from "./hosting-stats.js";

export const waitFor = async (
  check: () => boolean,
  /**
   * A function is evaluated at the moment of failure, so an assertion can
   * report what the server actually said rather than only that it timed out.
   */
  message: string | (() => string),
  timeout = 15000,
) => {
  const end = performance.now() + timeout;
  while (!check()) {
    if (performance.now() > end)
      throw new Error(typeof message === "function" ? message() : message);
    await new Promise((r) => setTimeout(r, 20));
  }
};

/** ACK-driven test client, not a replacement for the gameplay prediction system. */
export class HostingPeer {
  ws?: WebSocket;
  id = 0;
  x = 0;
  y = 0;
  dir: Direction = DIR.DOWN;
  stepMs = 0;
  tickMs = 0;
  chunkSize = 0;
  welcomed = false;
  replica = new Map<number, { x: number; y: number }>();
  event?: EventView;
  eventStates = 0;
  moves = 0;
  acks = 0;
  rejects = 0;
  errors = 0;
  unexpectedDisconnects = 0;
  bytes = 0;
  bytesSent = 0;
  framesIn = 0;
  packetsIn = 0;
  packetsOut = 0;
  replicationPackets = 0;
  onAck?: (latency: number) => void;
  kicks: number[] = [];
  results: { message: string; error?: boolean }[] = [];
  resultCount = 0;
  interactions: { id: string; name: string }[] = [];
  interactionCount = 0;
  teleports = 0;
  rtt = new Samples();
  private seq = 0;
  private pending = new Map<number, { at: number; x: number; y: number }>();
  private heartbeat?: NodeJS.Timeout;
  private intentional = false;
  private connected = false;
  private worldIntentPending = false;
  constructor(
    public token: string,
    public playerId: string,
    private origin: string,
    private map: GameMap,
  ) {}
  async connect() {
    this.pending.clear();
    this.seq = 0;
    this.replica.clear();
    this.welcomed = false;
    this.intentional = false;
    const ws = new WebSocket(
      `${this.origin.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(this.token)}`,
    );
    this.ws = ws;
    ws.on("message", (raw) => {
      try {
        this.framesIn++;
        this.bytes += (raw as Buffer).byteLength;
        for (const m of decodeS2CFrame(new Uint8Array(raw as Buffer))) {
          if (!m) {
            this.errors++;
            continue;
          }
          this.packetsIn++;
          if ([S2C.ENTITY_ENTER,S2C.ENTITY_LEAVE,S2C.ENTITY_MOVE,S2C.ENTITY_TELEPORT].includes(m.opcode as any)) this.replicationPackets++;
          switch (m.opcode) {
            case S2C.WELCOME:
              this.id = m.selfId;
              this.x = m.x;
              this.y = m.y;
              this.dir = m.dir;
              this.stepMs = (m.stepTicks / m.tickRate) * 1000;
              this.tickMs = 1000 / m.tickRate;
              if (!(this.stepMs > 0 && Number.isFinite(this.stepMs)))
                throw new Error("Invalid WELCOME cadence");
              this.pending.clear();
              this.seq = 0;
              this.replica.clear();
              this.welcomed = true;
              this.connected = true;
              if (this.heartbeat) clearInterval(this.heartbeat);
              this.heartbeat = setInterval(
                () => this.send(encodePing(performance.now() | 0)),
                2500,
              );
              break;
            case S2C.ENTITY_ENTER:
            case S2C.ENTITY_MOVE:
              this.replica.set(m.id, { x: m.x, y: m.y });
              break;
            case S2C.ENTITY_LEAVE:
              this.replica.delete(m.id);
              break;
            case S2C.MOVE_ACK: {
              const p = this.pending.get(m.seq);
              if (!p || p.x !== m.x || p.y !== m.y) this.errors++;
              if (p) { const latency=performance.now()-p.at; this.rtt.add(latency); this.onAck?.(latency); }
              this.pending.delete(m.seq);
              this.x = m.x;
              this.y = m.y;
              this.acks++;
              break;
            }
            case S2C.MOVE_REJECT:
              this.x = m.x;
              this.y = m.y;
              this.dir = m.dir;
              this.pending.clear();
              this.rejects++;
              break;
            case S2C.ENTITY_TELEPORT:
              if (m.id === this.id) {
                this.worldIntentPending = false;
                this.teleports++;
                this.pending.clear();
                this.x = m.x;
                this.y = m.y;
                this.dir = m.dir;
              } else this.replica.set(m.id, { x: m.x, y: m.y });
              break;
            case S2C.JSON: {
              const value = JSON.parse(m.payload);
              if (value.type === "interaction" || value.type === "action_error") this.worldIntentPending = false;
              if (value.type === "event_state") {
                this.event = value;
                this.eventStates++;
              }
              if (value.type === "game_result") {
                this.resultCount++;
                this.results.push(value);
                if (this.results.length > 32) this.results.shift();
              }
              if (value.type === "interaction") {
                this.interactionCount++;
                this.interactions.push(value);
                if (this.interactions.length > 32) this.interactions.shift();
              }
              if (value.type === "action_error") this.errors++;
              break;
            }
            case S2C.KICK:
              if (this.kicks.length < 16) this.kicks.push(m.reason);
              this.errors++;
              break;
            case S2C.PONG:
              break;
          }
        }
      } catch {
        this.errors++;
      }
    });
    ws.on("error", () => {
      this.errors++;
    });
    ws.on("close", () => {
      if (!this.intentional) this.unexpectedDisconnects++;
      this.connected = false;
      this.worldIntentPending = false;
      this.welcomed = false;
      this.pending.clear();
      if (this.heartbeat) clearInterval(this.heartbeat);
    });
    await waitFor(() => this.welcomed, "Bot WELCOME timed out");
  }
  send(packet: Uint8Array) {
    if (this.ws?.readyState === WebSocket.OPEN) { this.bytesSent += packet.byteLength; this.packetsOut++; this.ws.send(packet); }
  }
  sendJson(payload: string | object) {
    this.send(
      encodeC2SJson(
        typeof payload === "string" ? payload : JSON.stringify(payload),
      ),
    );
  }
  /** World travel cancels predictions; never overlap it with an unacknowledged move. */
  interact(id: string): boolean {
    if (!this.connected || !this.welcomed || this.pending.size || this.worldIntentPending) return false;
    this.worldIntentPending = true;
    this.sendJson({type:'interact',id});
    return true;
  }
  move(dir: Direction) {
    if (!this.connected || !this.welcomed || this.worldIntentPending || this.pending.size >= 1)
      return false;
    const step = tryStep(this.map, this.x, this.y, dir);
    if (!step.ok) {
      this.dir = dir;
      return false;
    }
    this.dir = dir;
    const seq = (this.seq = (this.seq + 1) & 65535);
    this.pending.set(seq, { at: performance.now(), x: step.x, y: step.y });
    this.moves++;
    this.send(encodeMove(seq, dir));
    return true;
  }
  async drain() {
    await waitFor(() => this.pending.size === 0, "Unacknowledged movement");
  }
  async close() {
    this.intentional = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.pending.clear();
    const ws = this.ws;
    if (!ws || ws.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        ws.terminate();
        resolve();
      }, 1500);
      ws.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.close();
    });
  }
}
