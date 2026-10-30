import { strict as assert } from "node:assert";
import type { EventView } from "@heist/shared";
import { raidPresentation } from "../apps/client/src/ui/terminal-cards.js";

const base = {
  phase: "lobby",
  serverTime: 100000,
  player: { completed: 0 },
  raid: {
    window: 0,
    crew: 0,
    required: 8,
    standingSince: 0,
    endsAt: 0,
    joined: false,
    solved: 0,
  },
} as EventView;
const check = (
  change: Partial<EventView>,
  raidChange: Partial<EventView["raid"]> = {},
  completed = 5,
) =>
  raidPresentation({
    ...base,
    phase: "live",
    ...change,
    player: { ...base.player, completed },
    raid: { ...base.raid, window: 1, ...raidChange },
  });
assert.equal(raidPresentation(base).phase, "closed");
assert.equal(check({ phase: "frozen" }).phase, "sealed");
assert.equal(check({}, {}, 4).phase, "qualify");
assert.equal(check({}).phase, "ready");
assert.equal(check({}, { standingSince: 80000 }).phase, "holding");
assert.equal(check({}, { standingSince: 80000 }).holdSeconds, 20);
assert.equal(check({}, { standingSince: 200000 }).holdSeconds, 0);
assert.equal(check({}, { standingSince: 1 }).holdSeconds, 60);
assert.equal(check({}, { joined: true }).phase, "joined");
assert.equal(check({}, { joined: true }).progress, 1);
assert.equal(check({}, { endsAt: 200000 }).phase, "active");
assert.equal(check({ phase: "frozen" }, { endsAt: 200000 }).active, false);
assert.equal(check({ phase: "lobby" }, { endsAt: 200000 }).phase, "closed");
assert.equal(check({}, { crew: 12, required: 10 }).crew, 10);
assert.equal(check({}, { crew: -5 }).crew, 0);
assert.equal(check({}, { required: 10 }).required, 10);
assert.equal(
  JSON.stringify(base),
  JSON.stringify({
    phase: "lobby",
    serverTime: 100000,
    player: { completed: 0 },
    raid: {
      window: 0,
      crew: 0,
      required: 8,
      standingSince: 0,
      endsAt: 0,
      joined: false,
      solved: 0,
    },
  }),
);
console.log(
  "Terminal cards passed: all seven raid phases, 8/10-person crews, server-time hold progress, clamping and no state mutations.",
);
