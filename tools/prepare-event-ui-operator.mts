/** Move an existing, named local QA operator through authored gates for browser QA. */
import { WebSocket } from "ws";
import {
  decodeS2CFrame,
  encodeMove,
  encodePing,
  encodeC2SJson,
  findPath,
  pathToDirections,
  loadMap,
  sceneAt,
  S2C,
  type Direction,
} from "@heist/shared";
const base = "http://localhost:8080",
  credentials = { username: "mapqa_city_0", password: "Local-QA-only-123" };
const login = await fetch(`${base}/api/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(credentials),
});
if (!login.ok) throw new Error("Existing QA account is unavailable");
const auth = await login.json(),
  map = loadMap(await (await fetch(`${base}/api/map`)).json()),
  packets: any[] = [];
const ws = new WebSocket(
  `${base.replace("http", "ws")}/ws?token=${auth.token}`,
);
ws.on("message", (data) =>
  packets.push(...decodeS2CFrame(new Uint8Array(data as Buffer))),
);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function wait(check: () => boolean) {
  const end = Date.now() + 8000;
  while (!check()) {
    if (Date.now() > end) throw new Error("Packet timeout");
    await sleep(10);
  }
}
const ping = setInterval(() => {
  if (ws.readyState === WebSocket.OPEN)
    ws.send(encodePing(performance.now() | 0));
}, 2500);
let x = 0,
  y = 0,
  seq = 0,
  cadence = 0;
async function walk(tx: number, ty: number) {
  const path = findPath(map, x, y, tx, ty);
  if (!path) throw new Error("Unreachable QA target");
  for (const dir of pathToDirections(x, y, path)) {
    const current = ++seq,
      started = performance.now();
    ws.send(encodeMove(current, dir as Direction));
    await wait(() =>
      packets.some(
        (p) =>
          (p.opcode === S2C.MOVE_ACK || p.opcode === S2C.MOVE_REJECT) &&
          p.seq === current,
      ),
    );
    const ack = packets.find(
      (p) =>
        (p.opcode === S2C.MOVE_ACK || p.opcode === S2C.MOVE_REJECT) &&
        p.seq === current,
    );
    if (ack.opcode === S2C.MOVE_REJECT) throw new Error("QA move rejected");
    x = ack.x;
    y = ack.y;
    await sleep(Math.max(0, cadence + 5 - (performance.now() - started)));
  }
}
try {
  await wait(() => packets.some((p) => p.opcode === S2C.WELCOME));
  const welcome = packets.find((p) => p.opcode === S2C.WELCOME);
  x = welcome.x;
  y = welcome.y;
  cadence = (welcome.stepTicks / welcome.tickRate) * 1000;
  const destination = process.argv[2] || "logic",
    target = map.hotspots.find((h) => h.id === destination);
  if (!target) throw new Error("Unknown POI");
  const targetScene = sceneAt(map, target.x, target.y)!.id;
  while (sceneAt(map, x, y)?.id !== targetScene) {
    const current = sceneAt(map, x, y)!.id,
      queue = [{ scene: current, gates: [] as string[] }],
      seen = new Set([current]);
    let route: string[] | undefined;
    while (queue.length) {
      const item = queue.shift()!;
      if (item.scene === targetScene) {
        route = item.gates;
        break;
      }
      for (const gate of map.exits || []) {
        if (sceneAt(map, gate.x, gate.y)?.id !== item.scene) continue;
        const next = sceneAt(map, gate.targetX, gate.targetY)!.id;
        if (!seen.has(next)) {
          seen.add(next);
          queue.push({ scene: next, gates: [...item.gates, gate.id] });
        }
      }
    }
    if (!route?.length) throw new Error("No district route");
    const gate = map.exits!.find((g) => g.id === route![0])!;
    await walk(gate.x, gate.y);
    const start = packets.length;
    ws.send(encodeC2SJson(JSON.stringify({ type: "interact", id: gate.id })));
    await wait(() =>
      packets.slice(start).some((p) => p.opcode === S2C.ENTITY_TELEPORT),
    );
    x = gate.targetX;
    y = gate.targetY;
  }
  await walk(target.x, target.y);
  console.log(
    JSON.stringify({
      passed: true,
      operator: credentials.username,
      target: destination,
      steps: seq,
      x,
      y,
      rejects: packets.filter((p) => p.opcode === S2C.MOVE_REJECT).length,
    }),
  );
} finally {
  clearInterval(ping);
  ws.close(1000, "Browser QA placement complete");
}
