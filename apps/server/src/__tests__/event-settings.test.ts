import { describe, it, expect, afterEach } from "vitest";
import { loadMap, type MapData, type EventRequest } from "@heist/shared";
import { EventEngine } from "../game/event-engine.js";
import { EVENT_RULES } from "../game/rules.js";
import {
  derivePools,
  planSettings,
  resetSettings,
  SETTING_FIELDS,
  SettingsError,
  TOTAL_PAISE,
} from "../game/settings.js";

const MINUTE = 60_000;
const engines: EventEngine[] = [];

afterEach(() => {
  for (const e of engines.splice(0)) e.close();
  // Settings mutate the shared EVENT_RULES object, so restore the documented
  // defaults between tests rather than leaking an override into the next one.
  resetSettings();
});

function setup() {
  let now = 1800000000000;
  const raw: MapData = {
    version: 30,
    width: 120,
    height: 40,
    collision: Array(40).fill("0".repeat(120)),
    spawns: [{ x: 5, y: 5 }],
    scenes: ["tech", "harbor", "black", "central", "under", "nexus"].map(
      (id, i) => ({
        id,
        name: id,
        kind: "district",
        x: i * 20,
        y: 0,
        width: 20,
        height: 40,
        image: "",
        color: "",
      }),
    ),
    hotspots: [
      { id: "tech-jobs", action: "jobs", name: "Tech", x: 5, y: 5 },
      ...["bank", "raid", "race", "checkout"].map((id, i) => ({
        id,
        action: id,
        name: id,
        x: 65,
        y: 5 + i,
      })),
    ],
    homePlots: Array.from({ length: 90 }, (_, i) => ({
      id: `home-h${i + 1}`,
      address: `H${i + 1}`,
      sceneId: "under",
      x: 81 + (i % 18),
      y: 12 + Math.floor(i / 18),
    })),
  };
  const e = new EventEngine(":memory:", loadMap(raw), () => now);
  engines.push(e);
  const positions = new Map<string, { x: number; y: number }>();
  e.positionOf = (id) => positions.get(id);
  e.connected = () => true;
  const add = (id: string) => {
    e.ensurePlayer(id, id);
    positions.set(id, { x: 5, y: 5 });
    return e.view(id);
  };
  const act = (id: string, action: string, rest: Partial<EventRequest> = {}) =>
    e.action(id, { type: "game_action", action, ...rest });
  return {
    e,
    add,
    act,
    internals: e as any,
    at: (minute: number) => {
      now = 1800000000000 + minute * MINUTE;
    },
    advance: (ms: number) => {
      now += ms;
    },
    get now() {
      return now;
    },
  };
}

describe("the conserved money invariant", () => {
  it("derives pools summing to exactly Rs 4,000 for the documented defaults", () => {
    const pools = derivePools(
      Object.fromEntries(
        SETTING_FIELDS.map((f) => [
          f.key,
          (EVENT_RULES as unknown as Record<string, number>)[f.key],
        ]),
      ),
    );
    expect(Object.values(pools).reduce((a, b) => a + b, 0)).toBe(TOTAL_PAISE);
    expect(TOTAL_PAISE).toBe(EVENT_RULES.total);
  });

  it("keeps the total at exactly Rs 4,000 across a wide sweep of prize settings", () => {
    // This is the invariant the owner called non-negotiable, so it is checked
    // over a range rather than at a single point.
    for (const maxPlayers of [1, 10, 40, 60, 120]) {
      for (const starterPay of [0, 500, 1000, 2000]) {
        for (const standardPay of [0, 1000, 2000]) {
          for (const standardSlots of [1, 8, 16]) {
            let plan;
            try {
              plan = planSettings(
                { maxPlayers, starterPay, standardPay, standardSlots },
                { started: false },
              );
            } catch (error) {
              // Rejection is the correct outcome when the prizes over-commit.
              expect(error).toBeInstanceOf(SettingsError);
              continue;
            }
            const total = Object.values(plan.pools).reduce((a, b) => a + b, 0);
            expect(total).toBe(TOTAL_PAISE);
            expect(plan.pools.TREASURY).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });

  it("refuses prize settings that would commit more than the world contains", () => {
    expect(() =>
      planSettings(
        { maxPlayers: 200, starterPay: 100_000 },
        { started: false },
      ),
    ).toThrow(/more than the Rs 4000.00 the world contains|more than/);
  });

  it("explains which levers to pull when prizes over-commit", () => {
    let message = "";
    try {
      planSettings({ standardPay: 100_000 }, { started: false });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/Reduce a prize amount/);
  });
});

describe("settings validation", () => {
  it("rejects an unknown key rather than silently ignoring it", () => {
    expect(() =>
      planSettings({ notARule: 5 }, { started: false }),
    ).toThrow(/Unknown setting/);
  });

  it("rejects out-of-range and non-integer values", () => {
    expect(() => planSettings({ cap: 10 }, { started: false })).toThrow(
      /must be between/,
    );
    expect(() => planSettings({ cap: 80_000.5 }, { started: false })).toThrow(
      /whole number/,
    );
  });

  it("keeps the wealth cap above the reactivation threshold", () => {
    expect(() =>
      planSettings({ cap: 50_000, reactivate: 60_000 }, { started: false }),
    ).toThrow(/greater than the reactivation threshold/);
  });

  it("keeps raid gates internally consistent", () => {
    expect(() =>
      planSettings({ raidGate: 9, raidQuestions: 5 }, { started: false }),
    ).toThrow(/cannot exceed the number of questions/);
    expect(() =>
      planSettings({ raidPass: 30, raidCrew: 10 }, { started: false }),
    ).toThrow(/cannot exceed the raid crew size/);
  });

  it("allows a live field to change after the event starts", () => {
    expect(() =>
      planSettings({ cap: 120_000 }, { started: true }),
    ).not.toThrow();
  });

  it("refuses a money-defining field after the event starts", () => {
    expect(() => planSettings({ starterPay: 50 }, { started: true })).toThrow(
      /only be changed before the event starts/,
    );
    expect(() => planSettings({ maxPlayers: 50 }, { started: true })).toThrow(
      /only be changed before the event starts/,
    );
  });
});

describe("applying settings through the engine", () => {
  it("takes effect immediately on the live rules object", () => {
    const s = setup();
    expect(EVENT_RULES.cap).toBe(80_000);
    s.e.updateSettings({ cap: 150_000 });
    expect(EVENT_RULES.cap).toBe(150_000);
  });

  it("rebases the opening balances before the event starts and stays conserved", () => {
    const s = setup();
    s.e.updateSettings({ maxPlayers: 60, starterPay: 500 });
    const total = s.e.total();
    expect(total).toBe(TOTAL_PAISE);
    expect(s.internals.state.accounts.POOL_STARTER).toBe(500 * 60);
  });

  it("reports the editable surface with values, defaults and bounds", () => {
    const s = setup();
    const view = s.e.settingsView();
    expect(view.fields.length).toBe(SETTING_FIELDS.length);
    const cap = view.fields.find((f) => f.key === "cap")!;
    expect(cap.default).toBe(80_000);
    expect(cap.min).toBeLessThan(cap.max);
    expect(cap.help).toBeTruthy();
    expect(view.totalPaise).toBe(TOTAL_PAISE);
  });

  it("restores defaults when cleared", () => {
    const s = setup();
    s.e.updateSettings({ cap: 150_000 });
    s.e.clearSettings();
    expect(EVENT_RULES.cap).toBe(80_000);
  });

  it("refuses to rewrite pools once money has moved", () => {
    const s = setup();
    s.add("a");
    s.e.start();
    s.act("a", "job", { id: "ST-01" });
    // Starting the event and claiming work writes ledger rows, after which the
    // opening pools are no longer safe to rewrite.
    expect(() => s.e.updateSettings({ starterPay: 50 })).toThrow();
  });

  it("survives a restart with overrides persisted", () => {
    const s = setup();
    s.e.updateSettings({ cap: 150_000, wrongLimit: 7 });
    const exported = s.e.exportPersistence();
    resetSettings();
    expect(EVENT_RULES.cap).toBe(80_000);
    const restored = new EventEngine(":memory:", s.e.map, () => s.now);
    engines.push(restored);
    restored.importPersistence(exported);
    expect(restored.settingsView().fields.find((f) => f.key === "cap")!.value).toBe(
      150_000,
    );
  });
});

describe("pausing and resuming the event", () => {
  it("only pauses a live event, and not twice", () => {
    const s = setup();
    expect(() => s.e.pause()).toThrow(/Only a live event/);
    s.add("a");
    s.e.start();
    s.e.pause();
    expect(s.e.paused()).toBe(true);
    expect(() => s.e.pause()).toThrow(/already paused/);
  });

  it("freezes the schedule clock while paused", () => {
    const s = setup();
    s.add("a");
    s.e.start();
    s.at(10);
    const before = s.e.minute();
    expect(before).toBeGreaterThan(9);
    s.e.pause();
    s.at(40);
    // Thirty minutes of wall clock passed, but the event did not advance.
    expect(s.e.minute()).toBeCloseTo(before, 5);
  });

  it("resumes the schedule from exactly where it stopped", () => {
    const s = setup();
    s.add("a");
    s.e.start();
    s.at(10);
    const before = s.e.minute();
    s.e.pause();
    s.at(40);
    s.e.resume();
    expect(s.e.minute()).toBeCloseTo(before, 5);
    expect(s.e.paused()).toBe(false);
  });

  it("refuses player actions while paused but still allows a state sync", () => {
    const s = setup();
    s.add("a");
    s.e.start();
    s.e.pause();
    expect(() => s.act("a", "job", { id: "ST-01" })).toThrow(/paused/);
    expect(() => s.act("a", "sync")).not.toThrow();
  });

  it("preserves the remaining time on a held contract across a pause", () => {
    const s = setup();
    s.add("a");
    s.e.start();
    s.act("a", "job", { id: "ST-01" });
    const attempt = Object.values(s.internals.state.attempts).find(
      (a: any) => a.player === "a",
    ) as any;
    const remainingBefore = attempt.expires - s.now;
    expect(remainingBefore).toBeGreaterThan(0);

    s.e.pause();
    s.advance(7 * MINUTE);
    s.e.resume();

    const after = s.internals.state.attempts[attempt.key];
    // The deadline moved with the clock, so the operator did not lose time.
    expect(after.expires - s.now).toBe(remainingBefore);
  });

  it("does not advance the schedule or expire holds while paused", () => {
    const s = setup();
    s.add("a");
    s.e.start();
    const slotsBefore = JSON.stringify(s.internals.state.slots);
    s.e.pause();
    s.at(170);
    s.e.tick();
    expect(s.internals.state.phase).toBe("live");
    expect(JSON.stringify(s.internals.state.slots)).toBe(slotsBefore);
  });

  it("records how long the event spent paused", () => {
    const s = setup();
    s.add("a");
    s.e.start();
    s.e.pause();
    s.advance(90_000);
    s.e.resume();
    expect(s.internals.state.pausedTotal).toBe(90_000);
  });

  it("refuses to resume an event that is not paused", () => {
    const s = setup();
    s.add("a");
    s.e.start();
    expect(() => s.e.resume()).toThrow(/not paused/);
  });
});

describe("per-operator organizer actions", () => {
  it("credits an operator from the Treasury without creating money", () => {
    const s = setup();
    s.add("a");
    const before = s.e.total();
    const treasuryBefore = s.internals.state.accounts.TREASURY;
    s.e.adminAdjustMoney("a", 5_000, "Compensation for a stuck terminal");
    expect(s.e.total()).toBe(before);
    expect(s.internals.state.accounts.TREASURY).toBe(treasuryBefore - 5_000);
    expect(s.internals.state.accounts["HOME:a"]).toBe(5_000);
  });

  it("refuses a credit the Treasury cannot fund", () => {
    const s = setup();
    s.add("a");
    expect(() => s.e.adminAdjustMoney("a", TOTAL_PAISE, "too much")).toThrow(
      /Money cannot be created/,
    );
    expect(s.e.total()).toBe(TOTAL_PAISE);
  });

  it("returns a deduction to the Treasury", () => {
    const s = setup();
    s.add("a");
    s.e.adminAdjustMoney("a", 5_000, "credit");
    const treasury = s.internals.state.accounts.TREASURY;
    s.e.adminAdjustMoney("a", -2_000, "correction");
    expect(s.internals.state.accounts.TREASURY).toBe(treasury + 2_000);
    expect(s.internals.state.accounts["HOME:a"]).toBe(3_000);
    expect(s.e.total()).toBe(TOTAL_PAISE);
  });

  it("writes an auditable ledger row for every adjustment", () => {
    const s = setup();
    s.add("a");
    s.e.adminAdjustMoney("a", 1_234, "Organizer correction");
    const rows = s.internals.db
      .prepare("SELECT actor, reason, paise FROM event_ledger WHERE actor = ?")
      .all("ORGANIZER") as { actor: string; reason: string; paise: number }[];
    expect(rows.some((r) => r.paise === 1_234 && /correction/i.test(r.reason))).toBe(
      true,
    );
  });

  it("rejects an unknown operator and a zero amount", () => {
    const s = setup();
    s.add("a");
    expect(() => s.e.adminAdjustMoney("nobody", 100, "x")).toThrow(
      /No such operator/,
    );
    expect(() => s.e.adminAdjustMoney("a", 0, "x")).toThrow(/non-zero/);
  });

  it("clears a wrong-answer lockout", () => {
    const s = setup();
    s.add("a");
    s.e.start();
    s.act("a", "job", { id: "ST-01" });
    const attempt = Object.values(s.internals.state.attempts).find(
      (a: any) => a.player === "a",
    ) as any;
    attempt.blockedUntil = s.now + 10 * MINUTE;
    attempt.wrong = 3;
    s.e.adminClearPenalties("a");
    expect(s.internals.state.attempts[attempt.key].blockedUntil).toBe(0);
    expect(s.internals.state.attempts[attempt.key].wrong).toBe(0);
  });

  it("releases a held contract back to the queue", () => {
    const s = setup();
    s.add("a");
    s.e.start();
    const slot = s.internals.state.slots.find((x: any) => !x.claimed);
    if (slot) {
      slot.holder = "a";
      const result = s.e.adminReleaseHolds("a") as { released: number };
      expect(result.released).toBeGreaterThanOrEqual(1);
    }
    expect(s.e.total()).toBe(TOTAL_PAISE);
  });
});
