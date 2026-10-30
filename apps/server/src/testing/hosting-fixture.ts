/** Disposable lab fixture creation only. Production boot never imports this module. */
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { hash } from "argon2";
import { isWalkable, sceneAt, tryStep, DIR, type GameMap } from "@heist/shared";
import { SqliteDatabase } from "../persistence/sqlite.js";
import { EventEngine } from "../game/event-engine.js";
import { templates } from "../game/challenges.js";

export interface HostingFixture {
  version: 1;
  count: number;
  layout: "crowd" | "spread";
  durationSeconds: number;
  password: string;
  adminToken: string;
  debugToken: string;
  accounts: { username: string; playerId: string; x: number; y: number }[];
}
export async function createHostingFixture(
  directory: string,
  map: GameMap,
  count: number,
  layout: "crowd" | "spread",
  seconds: number,
): Promise<HostingFixture> {
  const fixture: HostingFixture = {
    version: 1,
    count,
    layout,
    durationSeconds: seconds,
    password: randomBytes(24).toString("hex"),
    adminToken: randomBytes(32).toString("hex"),
    debugToken: randomBytes(32).toString("hex"),
    accounts: [],
  };
  const db = new SqliteDatabase(join(directory, "auth.db"));
  const engine = new EventEngine(
    join(directory, "auth.db"),
    map,
    Date.now,
    Math.max(180, Math.ceil(seconds / 60) + 10),
  );
  try {
    const passwordHash = await hash(fixture.password);
    const station =
      map.hotspots.find(
        (h) => h.id === templates.find((t) => t.id === "ST-01")?.station,
      ) ?? map.hotspots.find((h) => h.action === "jobs");
    if (!station || !isWalkable(map, station.x, station.y))
      throw new Error("No walkable job terminal");
    const scenes = map.scenes ?? [];
    for (let i = 0; i < count; i++) {
      const username = `lab_${String(i).padStart(3, "0")}`,
        playerId = randomBytes(16).toString("hex");
      let point = { x: station.x, y: station.y };
      if (layout === "spread" && i > 0 && scenes.length) {
        const scene = scenes[(i - 1) % scenes.length];
        let found = false;
        for (let y = scene.y; y < scene.y + scene.height && !found; y++)
          for (let x = scene.x; x < scene.x + scene.width && !found; x++)
            if (
              isWalkable(map, x, y) &&
              sceneAt(map, x, y)?.id === scene.id &&
              [DIR.UP, DIR.DOWN, DIR.LEFT, DIR.RIGHT].filter(
                (d) => tryStep(map, x, y, d).ok,
              ).length >= 2
            ) {
              point = { x, y };
              found = true;
            }
        if (!found) throw new Error(`No walkable fixture point in ${scene.id}`);
      }
      await db.players.createPlayer(playerId, username, passwordHash);
      await db.state.save({
        playerId,
        ...point,
        dir: DIR.DOWN,
        data: JSON.stringify({ mapVersion: map.version }),
        updatedAt: new Date(),
      });
      engine.ensurePlayer(playerId, username);
      // Preload realistic mixed workbench payloads to stress broadcasts. This fixture-only
      // extension retains them through a long soak; production challenge lifetimes are unchanged.
      //
      // These are held in "job" mode, not "training". Player training is disabled, and the
      // server hides training attempts from the event view and refuses to answer or probe
      // them, so training payloads stressed nothing and the suite could never see its five
      // challenges. The mode is incidental to the purpose here, which is purely to make the
      // broadcast payload realistically large.
      const internal = engine as any;
      for (const id of ["ST-01", "ST-02", "ST-03", "SD-07", "EX-04"])
        internal.attempt(
          internal.state.players[playerId],
          id,
          "job",
          Date.now() + (seconds + 600) * 1000,
          "hosting-fixture",
          // Opened a minute ago, because that is what a preloaded contract
          // means: the operator is holding it, not opening it now. Without this
          // the suite trips the five-second minimum solve time, since creating
          // the fixture, booting the server, connecting the peers and starting
          // the event can all finish inside five seconds on a fast machine.
          { openedAt: Date.now() - 60_000 },
        );
      fixture.accounts.push({ username, playerId, ...point });
    }
    (engine as any).save();
  } finally {
    engine.close();
    await db.close();
  }
  return fixture;
}
