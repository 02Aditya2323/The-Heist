import { it, expect } from "vitest";
import { WebSocketServer } from "ws";
import {
  DIR,
  C2S,
  loadMap,
  decodeC2SFrame,
  encodeWelcome,
  encodeEntityTeleport,
  encodeMoveAck,
} from "@heist/shared";
import { HostingPeer, waitFor } from "../hosting-peer.js";

it("serializes travel and movement even when the teleport reply is delayed", async () => {
  const server = new WebSocketServer({ port: 0 });
  await new Promise<void>((r) => server.once("listening", r));
  const port = (server.address() as { port: number }).port,
    map = loadMap({
      version: 1,
      width: 32,
      height: 32,
      collision: Array(32).fill("0".repeat(32)),
      spawns: [{ x: 5, y: 5 }],
      hotspots: [],
    });
  const received: number[] = [];
  let timer: NodeJS.Timeout | undefined;
  server.on("connection", (ws) => {
    ws.send(encodeWelcome(1, 5, 5, DIR.DOWN, 20, 5, 1, 0));
    ws.on("message", (raw) => {
      for (const msg of decodeC2SFrame(new Uint8Array(raw as Buffer))) {
        if (!msg) continue;
        received.push(msg.opcode);
        if (msg.opcode === C2S.JSON)
          timer = setTimeout(
            () => ws.send(encodeEntityTeleport(1, 10, 10, DIR.DOWN)),
            70,
          );
        if (msg.opcode === C2S.MOVE) ws.send(encodeMoveAck(msg.seq, 11, 10));
      }
    });
  });
  const peer = new HostingPeer("fixture", "p", `http://127.0.0.1:${port}`, map);
  try {
    await peer.connect();
    expect(peer.interact("gate")).toBe(true);
    expect(peer.move(DIR.RIGHT)).toBe(false);
    expect(peer.interact("gate")).toBe(false);
    await waitFor(() => peer.teleports === 1, "delayed teleport");
    expect(received).toEqual([C2S.JSON]);
    expect(peer.move(DIR.RIGHT)).toBe(true);
    expect(peer.interact("gate")).toBe(false);
    await peer.drain();
    expect(peer.acks).toBe(1);
    expect(peer.errors).toBe(0);
    expect(peer.x).toBe(11);
  } finally {
    if (timer) clearTimeout(timer);
    await peer.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
