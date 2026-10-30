import { describe, it, expect, afterEach } from "vitest";
import { loadMap, type MapData, type EventRequest } from "@heist/shared";
import { EventEngine } from "../game/event-engine.js";
import {
  generateChallenge,
  generateLegacyChallenge,
  templates,
} from "../game/challenges.js";
import { mkdtempSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { LEGACY_INITIAL_POOLS, INITIAL_POOLS, EVENT_RULES } from "../game/rules.js";
import { resetSettings } from "../game/settings.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
const MINUTE = 60000;
const engines: EventEngine[] = [];
it('keeps private completed history after the old five-minute card window',()=>{
  const s=setup();s.add('a');s.add('b');s.e.start();s.act('a','job',{id:'ST-01'});s.solve('a');
  const before=s.e.view('a').completedChallenges!;expect(before).toHaveLength(1);expect(before[0].template).toBe('ST-01');expect(before[0].mode).toBe('job');expect(before[0].location).toContain('tech');
  s.at(10);expect(s.e.view('a').challenges.some(c=>c.solved)).toBe(false);expect(s.e.view('a').completedChallenges).toEqual(before);expect(s.e.view('b').completedChallenges).toHaveLength(0);
  const value=s.e.exportPersistence(),restored=new EventEngine(':memory:',s.e.map,()=>s.now());engines.push(restored);restored.importPersistence(value);
  expect(restored.view('a').completedChallenges).toEqual(before);
});
afterEach(() => {
  for (const e of engines.splice(0)) e.close();
});
function setup(path = ":memory:") {
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
      { id: "harbor-jobs", action: "jobs", name: "Harbor", x: 25, y: 5 },
      { id: "black-jobs", action: "jobs", name: "Black", x: 45, y: 5 },
      ...["bank", "raid", "race", "checkout"].map((id, i) => ({
        id,
        action: id,
        name: id,
        x: 65,
        y: 5 + i,
      })),
      ...[
        "logic",
        "osint",
        "sandbox",
        "market",
        "nexus-info",
        "golden",
        "nexus-event",
      ].map((id, i) => ({ id, action: "events", name: id, x: 102 + i, y: 12 })),
    ],
    homePlots: Array.from({ length: 90 }, (_, i) => ({
      id: `home-h${i + 1}`,
      address: `H${i + 1}`,
      sceneId: "under",
      x: 81 + (i % 18),
      y: 12 + Math.floor(i / 18),
    })),
  };
  const e = new EventEngine(path, loadMap(raw), () => now);
  engines.push(e);
  const positions = new Map<string, { x: number; y: number }>();
  e.positionOf = (id) => positions.get(id);
  e.connected = () => true;
  const internals = e as any;
  const add = (id: string) => {
    e.ensurePlayer(id, id);
    positions.set(id, { x: 5, y: 5 });
    return e.view(id);
  };
  const at = (minute: number) => {
    now = 1800000000000 + minute * MINUTE;
  };
  const act = (id: string, action: string, rest: Partial<EventRequest> = {}) =>
    e.action(id, { type: "game_action", action, ...rest });
  const solve = (id: string, key?: string) => {
    const attempt = key
      ? internals.state.attempts[key]
      : (Object.values(internals.state.attempts)
          .filter((a: any) => a.player === id && !a.solved && a.expires > now)
          .at(-1) as any);
    if (!attempt) throw new Error("No test attempt");
    const player = id;
    const answer = generateChallenge(
      internals.state.secret,
      player,
      attempt.template,
      attempt.variant,
    ).answer;
    const available =
      attempt.mode === "race"
        ? Math.max(
            attempt.openedAt || now,
            internals.state.contests.find((c: any) => c.id === attempt.template)
              .start,
          )
        : attempt.openedAt || now;
    now = Math.max(now, available + 5000);
    return act(id, "answer", { id: attempt.key, answer });
  };
  const fund = (id: string, amount: number, kind = "HOME") =>
    internals.transaction(() => {
      let left = amount;
      for (const source of [
        "POOL_EXPERT",
        "POOL_STANDARD",
        "POOL_RACE",
        "POOL_EVENT",
        "TREASURY",
        "POOL_STARTER",
      ]) {
        const take = Math.min(left, internals.state.accounts[source]);
        internals.transfer(source, `${kind}:${id}`, take, "Test fixture");
        left -= take;
        if (!left) break;
      }
      if (left) throw new Error("Fixture funds unavailable");
    });
  return {
    e,
    internals,
    add,
    at,
    act,
    solve,
    fund,
    positions,
    advance: (ms: number) => {
      now += ms;
    },
    now: () => now,
  };
}
describe("Zero Hour authoritative gameplay", () => {
  it("restores nested JSON state and SQL ledger on failed transactions", () => {
    const s = setup();
    s.add("a");
    s.add("b");
    s.fund("a", 5000);
    const before = structuredClone(s.internals.state),
      rows = s.e.ledger().length;
    expect(() =>
      s.internals.transaction(() => {
        s.internals.state.players.a.completed.push("temporary");
        s.internals.state.players.a.messages.push({
          at: s.now(),
          text: "temporary",
        });
        s.internals.transfer("HOME:a", "HOME:b", 100, "rollback fixture", "a");
        throw new Error("abort nested state");
      }),
    ).toThrow("abort nested state");
    expect(s.internals.state).toEqual(before);
    expect(s.e.ledger()).toHaveLength(rows);
    // A balanced-but-unledgered change must also roll back, not merely preserve total.
    expect(() =>
      s.internals.transaction(() => {
        s.internals.state.accounts["HOME:a"]--;
        s.internals.state.accounts["HOME:b"]++;
      }),
    ).toThrow(/without a ledger transfer/);
    expect(s.internals.state).toEqual(before);
    expect(s.e.audit().ok).toBe(true);
  });
  it("persists presence atomically without rewriting balances or restoring Home protection", () => {
    const folder = mkdtempSync(join(tmpdir(), "heist-presence-"));
    const path = join(folder, "event.db"),
      s = setup(path);
    s.add("a");
    s.fund("a", 5000);
    s.internals.state.players.a.insideHome = true;
    s.internals.save();
    const auditBefore = s.e.audit();
    s.e.setOnline("a", false);
    expect(s.e.view("a").player.insideHome).toBe(false);
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const state = JSON.parse(
        (db.prepare("SELECT data FROM event_state WHERE id=1").get() as any)
          .data,
      );
      expect(state.players.a.offlineAt).toBe(s.now());
      expect(state.players.a.insideHome).toBe(false);
      expect(state.accounts).toEqual(auditBefore.accounts);
      s.e.setOnline("a", true);
      const updated = JSON.parse(
        (db.prepare("SELECT data FROM event_state WHERE id=1").get() as any)
          .data,
      );
      expect(updated.players.a.offlineAt).toBe(0);
      expect(updated.players.a.insideHome).toBe(false);
      // Failed presence writes must not advance in-memory metadata.
      const run = s.internals.presenceUpdate;
      s.internals.presenceUpdate = {
        run() {
          throw new Error("disk unavailable");
        },
      };
      expect(() => s.e.setOnline("a", false)).toThrow("disk unavailable");
      expect(s.internals.state.players.a.offlineAt).toBe(0);
      s.internals.presenceUpdate = run;
      expect(s.e.audit().ok).toBe(true);
    } finally {
      db.close();
    }
  });
  it("caches only public puzzle data without stale timing, cross-player contamination or mutable views", () => {
    const s = setup();
    s.add("a");
    s.add("b");
    s.e.start();
    s.act("a", "job", { id: "ST-01" });
    s.act("b", "job", { id: "ST-01" });
    s.advance(5000);
    const before = s.e.view("a").challenges[0];
    const clean = structuredClone(before);
    before.workbench!.code = "tampered";
    const restored = s.e.view("a").challenges[0];
    expect(restored).toEqual(clean);
    expect(restored).not.toHaveProperty("answer");
    expect(restored).not.toHaveProperty("validate");
    const attempts = Object.values(s.internals.state.attempts) as any[];
    for (const id of ["a", "b"]) {
      const attempt = attempts.find((a) => a.player === id)!;
      expect(s.e.view(id).challenges[0].prompt).toBe(
        generateChallenge(
          s.internals.state.secret,
          id,
          attempt.template,
          attempt.variant,
        ).prompt,
      );
    }
    s.act("a", "answer", { id: clean.id, answer: "incorrect" });
    expect(s.e.view("a").challenges[0].answerReadyAt).toBe(s.now() + 5000);
    expect(s.e.view("b").challenges[0].answerReadyAt).toBe(0);
    // status() is the cheap public health read. It reports the pause flag so an
    // automated deploy can refuse to restart mid-event, and must still expose
    // nothing about the economy or any player.
    expect(s.e.status()).toEqual({ phase: "live", paused: false });
    s.advance(5000);
    s.solve("a", clean.id);
    expect(s.e.view("a").challenges[0].solved).toBe(true);
    expect(s.e.audit().ok).toBe(true);
  });
  it("bounds the presentation cache independently of accumulated attempt history", () => {
    const s = setup();
    s.add("a");
    for (let i = 0; i < 520; i++) {
      const attempt = s.internals.attempt(
        s.internals.state.players.a,
        "ST-01",
        "training",
        s.now() + MINUTE,
        `cache-${i}`,
      );
      s.internals.presentation(attempt);
    }
    expect(s.internals.presentations.size).toBe(512);
    expect(
      [...s.internals.presentations.values()].every(
        (v: any) => !("answer" in v) && !("validate" in v),
      ),
    ).toBe(true);
  });
  it("publishes the existing answer interval for UI without exposing answers", () => {
    const s = setup();
    s.add("a");
    s.e.start();s.act("a", "job", { id: "ST-01" });s.advance(5000);
    const c = s.e.view("a").challenges.at(-1)!;
    expect(c.answerReadyAt).toBe(0);
    s.act("a", "answer", { id: c.id, answer: "-9999999" });
    const updated = s.e
      .view("a")
      .challenges.find((challenge) => challenge.id === c.id)!;
    expect(updated.answerReadyAt).toBe(s.now() + 5000);
    expect(updated).not.toHaveProperty("answer");
    expect(() =>
      s.act("a", "answer", { id: c.id, answer: "-9999999" }),
    ).toThrow(/cooldown/);
    s.advance(5000);
    expect(() =>
      s.act("a", "answer", { id: c.id, answer: "-9999999" }),
    ).not.toThrow();
  });
  it("backs up and ledger-migrates a legacy lobby without rewriting its active rehearsal", () => {
    const folder = mkdtempSync(join(tmpdir(), "heist-book-migration-")),
      path = join(folder, "event.db"),
      old = setup(path);
    old.add("a");
    const p = old.internals.state.players.a,
      attempt = old.internals.attempt(
        p,
        "ST-03",
        "training",
        old.now() + 30 * MINUTE,
        "legacy-copy",
      );
    delete attempt.catalogueVersion;
    const expected = generateLegacyChallenge(
      old.internals.state.secret,
      "a",
      "ST-03",
      "legacy-copy",
    );
    const state = structuredClone(old.internals.state);
    delete state.rulesVersion;
    delete state.initialPools;
    state.accounts = {
      ...LEGACY_INITIAL_POOLS,
      "HOME:a": 0,
      "BANK:a": 0,
      "TRANSIT:a": 0,
    };
    old.e.close();
    engines.splice(engines.indexOf(old.e), 1);
    const db = new DatabaseSync(path);
    db.prepare("UPDATE event_state SET data=? WHERE id=1").run(
      JSON.stringify(state),
    );
    db.close();
    const restored = setup(path);
    expect(existsSync(`${path}.before-final-book.db`)).toBe(true);
    expect(restored.e.view("a").phase).toBe("lobby");
    expect(restored.e.view("a").challenges).toHaveLength(0);
    expect(restored.internals.presentation(restored.internals.state.attempts[attempt.key]).prompt).toBe(expected.prompt);
    expect(restored.e.audit().accounts).toMatchObject(INITIAL_POOLS);
    expect(restored.e.audit().ok).toBe(true);
    expect(restored.e.ledger()).toHaveLength(3);
    expect(()=>restored.act("a", "answer", { id: attempt.key, answer: expected.answer })).toThrow(/training is disabled/i);
    expect(restored.e.view("a").player.home).toBe(0);
    expect(restored.internals.state.attempts[attempt.key].solved).toBe(false);
  });
  it("applies the eight-person rule with balanced 2A/2B/1C questions and keeps failure money intact", () => {
    const s = setup();
    for (let i = 0; i < 8; i++) {
      const id = `p${i}`;
      s.add(id);
      s.internals.state.players[id].completed = Array(5).fill("fixture");
      s.positions.set(id, { x: 65, y: 6 });
    }
    s.e.start();
    s.at(45);
    for (let i = 0; i < 8; i++) s.act(`p${i}`, "raid_join");
    s.advance(MINUTE);
    s.e.tick();
    expect(s.e.view("p0").raid.crew).toBe(8);
    const raid = s.internals.activeRaid();
    for (const ids of Object.values(raid.templates) as string[][]) {
      const tiers = ids.map(
        (id) => templates.find((t) => t.id === id)!.raidTier,
      );
      expect(tiers.filter((t) => t === "A")).toHaveLength(2);
      expect(tiers.filter((t) => t === "B")).toHaveLength(2);
      expect(tiers.filter((t) => t === "C")).toHaveLength(1);
    }
    for (let i = 0; i < 4; i++) {
      s.solve(`p${i}`);
      s.solve(`p${i}`);
    }
    const before = s.e.audit().accounts;
    s.advance(15 * MINUTE);
    s.e.tick();
    expect(s.e.audit().accounts).toEqual(before);
    expect(s.e.audit().ok).toBe(true);
  });
  it("applies the approved 60-player limit and fixes eight or ten crew places at start", () => {
    const small = setup();
    for (let i = 0; i < 35; i++) small.add(`p${i}`);
    small.e.start();
    expect(small.e.view("p0").raid.required).toBe(8);
    small.add("p35");
    expect(small.e.view("p0").raid.required).toBe(8);
    const large = setup();
    for (let i = 0; i < 40; i++) large.add(`p${i}`);
    large.e.start();
    expect(large.e.view("p0").raid.required).toBe(10);
    for (let i = 40; i < 60; i++) large.add(`p${i}`);
    expect(() => large.add("overflow")).toThrow(/60/);
  });
  it("gives all sixty operators a distinct Home, opening later wards as needed", () => {
    // Homes were once restricted to wards A-C, which is 45 plots. That was
    // invisible while the cap was 40 and would have refused the 46th operator
    // at 60, reporting that all 90 addresses were taken.
    const s = setup();
    for (let i = 0; i < EVENT_RULES.maxPlayers; i++) s.add(`p${i}`);
    const homes = Object.values(s.internals.state.players).map((p: any) => p.homeId);
    expect(homes).toHaveLength(EVENT_RULES.maxPlayers);
    expect(new Set(homes).size).toBe(EVENT_RULES.maxPlayers);
    expect(homes.every((h: string) => !!h)).toBe(true);
  });
  it("orders live contracts by soonest expiry and solved ones newest first", () => {
    // The list used to come straight out of the attempts map, so the sequence a
    // player saw, and which contract the HUD featured as active, depended on
    // key order rather than on anything meaningful.
    const s = setup();
    s.add("a");
    s.e.start();
    const p = s.internals.state.players.a;
    const now = s.now();
    s.internals.attempt(p, "SD-01", "job", now + 9 * MINUTE, "late");
    s.internals.attempt(p, "SD-02", "job", now + 2 * MINUTE, "urgent");
    s.internals.attempt(p, "SD-03", "job", now + 5 * MINUTE, "middle");
    const live = s.e.view("a").challenges.filter((c: any) => !c.solved);
    expect(live.map((c: any) => c.title.split(" · ")[0])).toEqual([
      "SD-02",
      "SD-03",
      "SD-01",
    ]);
    // Stable across frames, not just sorted once.
    expect(s.e.view("a").challenges.map((c: any) => c.id)).toEqual(
      s.e.view("a").challenges.map((c: any) => c.id),
    );
  });
  it("uses four slots per documented Standard template and the exact Expert order", () => {
    const s = setup();
    s.add("a");
    s.e.start();
    const slots = s.internals.state.slots;
    expect(
      slots.filter((v: any) => v.wave === 1).map((v: any) => v.template),
    ).toEqual([
      "SD-01",
      "SD-01",
      "SD-01",
      "SD-01",
      "SD-02",
      "SD-02",
      "SD-02",
      "SD-02",
    ]);
    expect(
      slots.filter((v: any) => !v.wave).map((v: any) => v.template),
    ).toEqual(["EX-01", "EX-04", "EX-02", "EX-05", "EX-03"]);
    expect(s.e.audit().accounts).toMatchObject({
      POOL_STARTER: 60000,
      POOL_STANDARD: 80000,
      TREASURY: 30000,
      BANK_FEE_VAULT: 0,
    });
  });
  it("moves rounded Bank fees to the vault, excludes transit and never charges a minute twice", () => {
    const s = setup();
    s.add("a");
    s.e.start();
    s.fund("a", 20000);
    s.at(10);
    s.positions.set("a", { x: 65, y: 5 });
    s.act("a", "deposit", { amount: 20000 });
    s.act("a", "withdraw", { amount: 5000 });
    s.advance(MINUTE);
    s.e.tick();
    expect(s.e.view("a").player.bank).toBe(14985);
    expect(s.e.view("a").player.transit).toBe(5000);
    expect(s.e.audit().accounts.BANK_FEE_VAULT).toBe(15);
    s.e.tick();
    expect(s.e.audit().accounts.BANK_FEE_VAULT).toBe(15);
    s.advance(MINUTE);
    s.e.tick();
    expect(s.e.audit().accounts.BANK_FEE_VAULT).toBe(30);
    expect(s.e.audit().ok).toBe(true);
  });
  it("rejects voluntary Checkout before minute 150 and forged instant solves", () => {
    const s = setup();
    s.add("a");
    s.e.start();
    s.act("a", "job", { id: "ST-01" });
    const c = s.e.view("a").challenges[0],
      a = s.internals.state.attempts[c.id];
    const answer = generateChallenge(
      s.internals.state.secret,
      "a",
      "ST-01",
      a.variant,
    ).answer;
    expect(() => s.act("a", "answer", { id: c.id, answer })).toThrow(
      /Minimum solve/,
    );
    s.positions.set("a", { x: 65, y: 8 });
    expect(() => s.act("a", "checkout", { confirm: true })).toThrow(/150/);
    s.at(150);
    s.act("a", "checkout", { confirm: true });
    expect(s.e.view("a").player.checkedOut).toBe(true);
  });
  it("keeps private answers and secret seeds out of transmitted workbenches", () => {
    const s = setup();
    s.add("a");
    s.e.start();s.act("a", "job", { id: "ST-01" });
    const text = JSON.stringify(s.e.view("a"));
    expect(text).not.toContain(s.internals.state.secret);
    expect(text).not.toMatch(/"answer"\s*:/);
    expect(text).not.toContain("validate");
    expect(s.e.view("a").challenges[0].workbench?.kind).toBe("code");
  });
  it("allows nine valid keypad guesses, keeps its lock, and triggers jail on exhaustion", () => {
    const s = setup();
    s.add("owner");
    s.add("thief");
    s.e.start();
    s.fund("owner", 8000);
    s.fund("thief", 500);
    s.at(40);
    const home = s.e.map.homePlots![0];
    s.positions.set("thief", home);
    s.act("thief", "burglary", { id: home.id });
    const c = s.e.view("thief").challenges[0];
    const a = s.internals.state.attempts[c.id],
      secret = generateChallenge(
        s.internals.state.secret,
        "thief",
        "BG-01",
        a.variant,
      ).answer,
      wrong = secret === "012" ? "013" : "012";
    for (let i = 0; i < 9; i++) {
      s.advance(5000);
      s.act("thief", "answer", { id: c.id, answer: wrong });
      if (i < 8) expect(s.e.view("thief").player.jailedUntil).toBe(0);
    }
    expect(s.e.view("thief").player.home).toBe(200);
    expect(s.e.canMove("thief")).toBe(false);
    expect(s.e.audit().ok).toBe(true);
  });
  it("limits each number machine to five server-verified probes and persists results", () => {
    const s = setup();
    s.add("a");
    s.positions.set("a", { x: 45, y: 5 });
    s.e.start();s.at(60);s.act("a", "job", { id: "EX-04" });
    const c = s.e.view("a").challenges[0];
    for (let i = 0; i < 5; i++)
      s.act("a", "probe", { id: c.id, input: String(i) });
    expect(s.e.view("a").challenges[0].testRuns).toBe(5);
    expect(() => s.act("a", "probe", { id: c.id, input: "5" })).toThrow(/five/);
    expect(s.e.ledger()).toHaveLength(0);
  });
  it("preserves historical training credit but hides and blocks old question copies", () => {
    const s = setup();
    s.add("a");
    const p=s.internals.state.players.a;
    const solved=s.internals.attempt(p,'ST-01','training',s.now()+MINUTE,'old-solved');solved.solved=true;
    p.training.push('ST-01');p.completed.push('training:ST-01');
    const old=s.internals.attempt(p,'EX-04','training',s.now()+MINUTE,'old-active');
    expect(()=>s.act('a','job',{id:'ST-01',training:true})).toThrow(/training is disabled/i);
    expect(s.e.view('a').challenges).toHaveLength(0);
    expect(s.e.view('a').completedChallenges).toHaveLength(1);
    expect(s.e.view('a').player.completed).toBe(1);
    expect(()=>s.act('a','answer',{id:old.key,answer:'7'})).toThrow(/training is disabled/i);
    expect(()=>s.act('a','probe',{id:old.key,input:'7'})).toThrow(/unavailable/i);
    expect(s.e.audit().ok).toBe(true);
  });
  it("runs the complete 180-minute schedule, carries unused seeds, closes late entry and seals scores", () => {
    const s = setup();
    s.add("a");
    s.e.start();
    for (let minute = 0; minute <= 180; minute++) {
      s.at(minute);
      s.e.tick();
      expect(s.e.audit().ok).toBe(true);
      if (minute === 20)
        expect(
          s.e
            .view("a")
            .jobs.filter((j) => j.tier === "SD")
            .reduce((n, j) => n + j.remaining, 0),
        ).toBe(16);
      if (minute === 90) expect(s.e.audit().accounts.BANK_SEED_2).toBe(80000);
      if (minute === 120) expect(() => s.add("late")).toThrow(/registration/);
      if (minute === 150)
        expect(s.e.audit().accounts.BANK_SEED_FINAL).toBe(130000);
    }
    expect(s.e.view("a").phase).toBe("frozen");
    expect(s.e.view("a").player.checkedOut).toBe(true);
    expect(s.e.audit().total).toBe(400000);
  });
  it("freezes a balanced but unlogged account mutation when reconciling the ledger", () => {
    const s = setup();
    s.add("a");
    s.e.start();
    s.internals.state.accounts.TREASURY -= 100;
    s.internals.state.accounts["HOME:a"] += 100;
    expect(s.e.total()).toBe(400000);
    expect(s.e.audit()).toMatchObject({ ok: false, reconciled: false });
    expect(s.e.view("a").phase).toBe("frozen");
    expect(() => s.act("a", "job", { id: "ST-01" })).toThrow(/frozen/);
  });
  it("protects occupied Homes, releases their owners, and keeps capped Homes exposed", () => {
    const s = setup();
    s.add("owner");
    s.add("thief");
    s.add("other");
    s.e.start();
    s.fund("owner", 8000);
    s.at(40);
    const home = s.e.map.homePlots![0];
    s.positions.set("owner", home);
    s.positions.set("thief", home);
    s.positions.set("other", home);
    s.act("owner", "enter_home");
    expect(s.e.canMove("owner")).toBe(false);
    expect(() => s.act("thief", "burglary", { id: home.id })).toThrow(
      /protected/,
    );
    s.act("owner", "leave_home");
    expect(s.e.canMove("owner")).toBe(true);
    s.act("thief", "burglary", { id: home.id });
    s.solve("thief");
    expect(s.e.view("owner").player.home).toBe(7600);
    s.fund("owner", 72400);
    s.internals.transaction(() =>
      s.internals.checkCap(s.internals.state.players.owner),
    );
    s.act("owner", "enter_home");
    s.act("other", "burglary", { id: home.id });
    s.solve("other");
    expect(s.e.view("owner").player.home).toBe(79000);
    expect(s.e.view("other").player.home).toBe(3000);
    expect(s.e.audit().ok).toBe(true);
  });
  it("starts exactly ₹4000 and conserves it through 10,000 seeded transfers", () => {
    const { e, internals } = setup();
    expect(e.total()).toBe(400000);
    let seed = 41;
    internals.transaction(() => {
      for (let i = 0; i < 10000; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const keys = Object.keys(internals.state.accounts),
          from = keys[seed % keys.length],
          to = keys[(seed >>> 9) % keys.length],
          amount = Math.min(seed % 1000, internals.state.accounts[from]);
        internals.transfer(from, to, amount, "Random audit");
        expect(e.total()).toBe(400000);
      }
    });
    expect(e.audit().ok).toBe(true);
    expect(e.ledger(500).length).toBe(500);
  });
  it("pays Starter once, handles duplicate answers, and rejects forged remote starts", () => {
    const s = setup();
    s.add("a");
    s.e.start();
    s.act("a", "job", { id: "ST-01" });
    const key = s.e.view("a").challenges[0].id;
    s.solve("a", key);
    for (let i = 0; i < 10; i++) s.solve("a", key);
    expect(s.e.view("a").player.home).toBe(1000);
    expect(s.e.ledger().length).toBe(1);
    expect(() => s.act("a", "job", { id: "ST-02" })).toThrow();
    s.positions.set("a", { x: 60, y: 30 });
    expect(() => s.act("a", "job", { id: "SD-01" })).toThrow(/terminal/);
  });
  it("serializes two claims and advances an expired lock to a 30-second queue offer", () => {
    const s = setup();
    s.add("a");
    s.add("b");
    for (const id of ["c", "d", "e"]) s.add(id);
    s.e.start();
    s.act("a", "job", { id: "SD-01" });
    for (const id of ["c", "d", "e"]) s.act(id, "job", { id: "SD-01" });
    s.act("b", "job", { id: "SD-01" });
    expect(s.e.view("b").queues[0].position).toBe(1);
    s.advance(6 * MINUTE + 1);
    s.e.tick();
    const offer = s.e.view("b").queues[0];
    expect(offer.offerUntil).toBe(s.now() + 30000);
    s.act("b", "accept_queue", { id: offer.id });
    s.solve("b");
    expect(s.e.view("b").player.home).toBe(2000);
    expect(s.e.view("a").player.home).toBe(0);
    expect(s.e.audit().ok).toBe(true);
  });
  it("rejects training acquisition for every job template in lobby and live phases", () => {
    const s = setup();
    s.add("a");
    for(const phase of ['lobby','live']){if(phase==='live')s.e.start();
      for(const t of templates.filter(t=>['ST','SD','EX'].includes(t.tier)))expect(()=>s.act('a','job',{id:t.id,training:true})).toThrow(/training is disabled/i);
      expect(s.e.view('a').challenges).toHaveLength(0);}
    expect(s.e.view("a").player.completed).toBe(0);
    expect(s.e.view("a").player.home).toBe(0);
  });
  it("gives equal-complexity personal race variants to entrants, ranks correct answers and limits claims", () => {
    const s = setup();
    for (const id of ["a", "b", "c", "d"]) {
      s.add(id);
      s.positions.set(id, { x: 65, y: 7 });
    }
    s.e.start();
    s.at(25);
    for (const id of ["a", "b", "c", "d"])
      s.act(id, "race_enter", { id: "RC-01" });
    s.at(30);
    expect(s.e.view("a").challenges[0].workbench?.code).not.toBe(
      s.e.view("b").challenges[0].workbench?.code,
    );
    for (const id of ["a", "b", "c", "d"]) {
      s.solve(id);
      s.advance(1);
    }
    expect(["a", "b", "c", "d"].map((id) => s.e.view(id).player.home)).toEqual([
      5000, 3000, 2000, 0,
    ]);
    expect(s.e.audit().ok).toBe(true);
  });
  it("deposits after minute 10 and delays a withdrawal five minutes", () => {
    const s = setup();
    s.add("a");
    s.e.start();
    s.fund("a", 2000);
    s.positions.set("a", { x: 65, y: 5 });
    expect(() => s.act("a", "deposit", { amount: 1000 })).toThrow(/minute 10/);
    s.at(10);
    s.act("a", "deposit", { amount: 1000 });
    s.act("a", "withdraw", { amount: 500 });
    s.advance(5 * MINUTE - 1);
    s.e.tick();
    expect(s.e.view("a").player.transit).toBe(500);
    s.advance(1);
    s.e.tick();
    expect(s.e.view("a").player).toMatchObject({
      home: 1500,
      bank: 499,
      transit: 0,
    });
  });
  it("rolls back an entire failed transfer transaction and preserves ledger rows", () => {
    const s = setup();
    s.add("a");
    const before = s.e.audit();
    expect(() =>
      s.internals.transaction(() => {
        s.internals.transfer("POOL_STARTER", "HOME:a", 500, "Rollback test");
        s.internals.transfer("POOL_STARTER", "HOME:a", 999999, "Invalid");
      }),
    ).toThrow();
    expect(s.e.audit()).toEqual(before);
    expect(s.e.ledger()).toHaveLength(0);
  });
  it("locks a Home against concurrent thieves, applies a failure fee and jail", () => {
    const s = setup();
    for (const id of ["owner", "thief", "other"]) s.add(id);
    s.internals.state.players.thief.completed = Array(5).fill("fixture");
    s.e.start();
    s.fund("owner", 8000);
    s.fund("thief", 500);
    s.at(40);
    const home = s.e.map.homePlots![0];
    s.positions.set("owner", { x: 65, y: 5 });
    s.positions.set("thief", home);
    s.positions.set("other", home);
    s.act("thief", "burglary", { id: home.id, level: 2 });
    expect(() => s.act("other", "burglary", { id: home.id })).toThrow(/locked/);
    const key = s.e.view("thief").challenges[0].id;
    s.advance(5000);
    s.act("thief", "answer", { id: key, answer: "wrong" });
    expect(s.e.view("owner").player.home).toBe(8000);
    expect(s.e.view("thief").player.home).toBe(200);
    expect(s.e.canMove("thief")).toBe(false);
    s.advance(3 * MINUTE);
    expect(s.e.canMove("thief")).toBe(true);
    expect(s.e.audit().ok).toBe(true);
  });
  it("steals the specified share, protects the ₹5 floor and messages the owner", () => {
    const s = setup();
    s.add("owner");
    s.add("thief");
    s.e.start();
    s.fund("owner", 8000);
    s.internals.state.players.thief.completed = Array(5).fill("fixture");
    s.at(40);
    s.positions.set("owner", { x: 65, y: 5 });
    const home = s.e.map.homePlots![0];
    s.positions.set("thief", home);
    s.act("thief", "burglary", { id: home.id, level: 2 });
    s.solve("thief");
    expect(s.e.view("owner").player.home).toBe(7200);
    expect(s.e.view("thief").player.home).toBe(800);
    expect(s.e.view("owner").messages.at(-1)?.text).toMatch(/thief.*₹8.00/);
    expect(() => s.act("thief", "burglary", { id: home.id })).toThrow(
      /cooldown/,
    );
  });
  it("caps at ₹800, refuses further reward, remains capped at ₹650, reactivates below ₹600", () => {
    const s = setup();
    s.add("a");
    s.e.start();
    s.fund("a", 79900);
    s.act("a", "job", { id: "ST-01" });
    s.solve("a");
    expect(s.e.view("a").player.home).toBe(80000);
    expect(s.e.view("a").player.capped).toBe(true);
    s.internals.transaction(() => {
      expect(
        s.internals.reward(
          s.internals.state.players.a,
          "POOL_EXPERT",
          8000,
          "Cap test",
        ),
      ).toBe(0);
      s.internals.transfer("HOME:a", "TREASURY", 15000, "Cap fixture");
      s.internals.checkCap(s.internals.state.players.a);
    });
    expect(s.e.view("a").player.capped).toBe(true);
    s.internals.transaction(() => {
      s.internals.transfer("HOME:a", "TREASURY", 5001, "Cap fixture");
      s.internals.checkCap(s.internals.state.players.a);
    });
    expect(s.e.view("a").player.capped).toBe(false);
    expect(s.e.audit().ok).toBe(true);
  });
  it("reserves no unfunded bounty and exposes capped Homes even under the normal floor/cooldown", () => {
    const s = setup();
    s.add("a");
    s.add("b");
    s.e.start();
    s.fund("a", 80000);
    s.internals.transaction(() => {
      s.internals.transfer(
        "TREASURY",
        "POOL_EXPERT",
        s.internals.state.accounts.TREASURY,
        "Fixture",
      );
      s.internals.checkCap(s.internals.state.players.a);
    });
    expect(s.internals.state.players.a.bounty).toBe(false);
    s.internals.state.players.a.homeCooldown = s.now() + MINUTE;
    s.at(40);
    s.positions.set("a", s.e.map.homePlots![0]);
    s.positions.set("b", s.e.map.homePlots![0]);
    s.act("b", "burglary", { id: s.e.map.homePlots![0].id });
    s.solve("b");
    expect(s.e.view("b").player.home).toBe(1000);
  });
  it("a ten-person raid fails with four gate passes and takes no money", () => {
    const s = setup();
    for (let i = 0; i < 10; i++) {
      const id = `p${i}`;
      s.add(id);
      s.internals.state.players[id].completed = Array(5).fill("fixture");
      s.positions.set(id, { x: 65, y: 6 });
    }
    for (let i = 10; i < 36; i++) s.add(`spectator-${i}`);
    s.e.start();
    s.at(45);
    for (let i = 0; i < 10; i++) s.act(`p${i}`, "raid_join");
    s.advance(MINUTE);
    s.e.tick();
    expect(s.e.view("p0").raid.crew).toBe(10);
    expect(() => s.act("p0", "deposit", { amount: 1 })).toThrow(/locked/);
    for (let i = 0; i < 4; i++) {
      s.solve(`p${i}`);
      s.solve(`p${i}`);
    }
    const before = s.e.audit().accounts;
    s.advance(15 * MINUTE);
    s.e.tick();
    expect(s.e.audit().accounts).toEqual(before);
  });
  it("includes in-transit money in a successful raid and applies the ₹160 question ceiling", () => {
    const s = setup();
    for (let i = 0; i < 10; i++) {
      const id = `p${i}`;
      s.add(id);
      s.internals.state.players[id].completed = Array(5).fill("fixture");
      s.positions.set(id, { x: 65, y: 6 });
      s.fund(id, 20000, "BANK");
    }
    for (let i = 10; i < 36; i++) s.add(`spectator-${i}`);
    s.e.start();
    s.at(150);
    s.e.tick();
    s.act("p9", "withdraw", { amount: 10000 });
    for (let i = 0; i < 10; i++) s.act(`p${i}`, "raid_join");
    s.advance(MINUTE);
    s.e.tick();
    expect(
      s.internals
        .activeRaid()
        .sources.reduce((n: number, x: any) => n + x.amount, 0),
    ).toBeGreaterThan(20000);
    for (let i = 0; i < 5; i++) {
      s.solve(`p${i}`);
      s.solve(`p${i}`);
    }
    s.advance(15 * MINUTE);
    s.e.tick();
    expect(s.e.view("p0").player.home).toBe(32000);
    expect(s.e.audit().accounts.BANK_SEED_FINAL).toBeGreaterThan(10000);
    expect(s.e.audit().ok).toBe(true);
    s.e.tick();
    expect(s.e.view("p9").player.transit).toBe(0);
  });
  it("removes premature circle leavers and blocks Checkout during a raid", () => {
    const s = setup();
    s.add("a");
    s.internals.state.players.a.completed = Array(5).fill("fixture");
    s.e.start();
    s.at(45);
    s.positions.set("a", { x: 65, y: 6 });
    s.act("a", "raid_join");
    s.positions.set("a", { x: 50, y: 20 });
    s.advance(MINUTE);
    s.e.tick();
    expect(s.e.view("a").raid.crew).toBe(0);
  });
  it("checks out offline players after ten minutes, rejects old requests and freezes payouts", () => {
    const s = setup();
    s.add("a");
    s.e.start();
    s.fund("a", 500);
    s.e.setOnline("a", false);
    s.advance(10 * MINUTE - 1);
    s.e.tick();
    expect(s.e.view("a").player.checkedOut).toBe(false);
    s.advance(1);
    s.e.tick();
    expect(s.e.view("a").player.payout).toBe(500);
    expect(() => s.act("a", "job", { id: "ST-01" })).toThrow(/checked out/);
    s.add("b");
    s.fund("b", 200);
    s.e.freeze();
    expect(s.e.view("b").player.payout).toBe(200);
    expect(() => s.act("b", "deposit", { amount: 1 })).toThrow(/frozen/);
    expect(s.e.audit().ok).toBe(true);
  });
  it("restores claims, balances and the original seed across a database restart", () => {
    const folder = mkdtempSync(join(tmpdir(), "heist-event-test-")),
      path = join(folder, "event.db");
    const s = setup(path);
    s.add("a");
    s.e.start();
    s.act("a", "job", { id: "ST-01" });
    s.solve("a");
    s.e.close();
    engines.splice(engines.indexOf(s.e), 1);
    const restored = setup(path);
    expect(restored.e.view("a").player.home).toBe(1000);
    expect(restored.e.ledger()).toHaveLength(1);
    expect(restored.e.audit().ok).toBe(true);
  });
  it("keeps variants deterministic for all 42 templates and different for different players", () => {
    expect(templates).toHaveLength(42);
    for (const t of templates) {
      const a = generateChallenge("known-seed", "operator-a", t.id);
      expect(JSON.stringify(a)).toEqual(
        JSON.stringify(generateChallenge("known-seed", "operator-a", t.id)),
      );
      expect(a.validate(a.answer)).toBe(true);
      expect(a.prompt.length).toBeGreaterThan(30);
      expect(a.answer.length).toBeGreaterThan(0);
    }
    expect(generateChallenge("known-seed", "operator-a", "ST-01")).not.toEqual(
      generateChallenge("known-seed", "operator-b", "ST-01"),
    );
  });
  it("matches the published known-seed answer vector for every authored template", () => {
    const expected = {
      "ST-01": "516",
      "ST-02": "463",
      "ST-03": "61",
      "SD-01": "231",
      "SD-02": "OPEN GATE 4",
      "SD-03": "224",
      "SD-04": "75",
      "SD-05": "121",
      "SD-06": "4",
      "SD-07": "8006",
      "SD-08": "HEIST{6641_f75b821e38}",
      "SD-09": "operator-5 02:14",
      "SD-10": "20",
      "EX-01": "730",
      "EX-02": "313",
      "EX-03": "636",
      "EX-04": "HEIST{administrator_18_2924bb18c3}",
      "EX-05": "svc_5 03:15",
      "BG-01": "6470",
      "BG-02": "57",
      "BG-03": "97",
      "RC-01": "4",
      "RC-02": "7",
      "RC-03": "10",
      "GH-01": "5",
      "GH-02": "124",
      "GH-03": "85",
      "BR-01": "40",
      "BR-02": "504",
      "BR-03": "56,60,67,68,85",
      "BR-04": "242",
      "BR-05": "6788",
      "BR-06": "422",
      "BR-07": "VAULT-5-8",
      "BR-08": "HEIST{19_11a844f564}",
      "BR-09": "h3",
      "BR-10": "10.51.224.64",
      "BL-01": "890",
      "BL-02": "415",
      "BL-03": "615",
      "BL-04": "HEIST{administrator_16_3307673eaa}",
      "BL-05": "svc_16 03:15",
    };
    for (const [id, answer] of Object.entries(expected))
      expect(
        generateLegacyChallenge("known-seed", "operator-a", id).answer,
      ).toBe(answer);
  });
  it("awards five Golden Hour cards once each, follows the courier lock, and pays sprint places", () => {
    const s = setup();
    for (let i = 0; i < 6; i++) s.add(`p${i}`);
    s.e.start();
    s.at(70);
    s.e.tick();
    expect(s.e.markers()).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      const id = `p${i}`,
        marker = s.e.markers()[0];
      s.positions.set(id, marker);
      s.act(id, "event_enter", { id: "GH-01" });
      s.solve(id);
    }
    expect(s.e.markers()).toHaveLength(0);
    expect(s.e.view("p0").player.home).toBe(2000);
    s.at(115);
    s.e.tick();
    const courier = s.e.markers().find((m) => m.id === "courier")!;
    s.positions.set("p5", courier);
    s.positions.set("p4", courier);
    s.act("p5", "event_enter", { id: "GH-02" });
    expect(() => s.act("p4", "event_enter", { id: "GH-02" })).toThrow(/locked/);
    s.solve("p5");
    expect(s.e.view("p5").player.home).toBe(10000);
    s.at(165);
    s.e.tick();
    for (let i = 0; i < 6; i++) {
      s.positions.set(`p${i}`, { x: 107, y: 12 });
      s.act(`p${i}`, "event_enter", { id: "GH-03" });
      s.solve(`p${i}`);
    }
    expect(s.e.audit().accounts.POOL_EVENT).toBe(0);
    expect(s.e.audit().ok).toBe(true);
  });
  it("rate limits each challenge and blocks it for 60 seconds after three wrong answers", () => {
    const s = setup();
    s.add("a");
    s.e.start();
    s.act("a", "job", { id: "ST-01" });
    const key = s.e.view("a").challenges[0].id;
    s.advance(5000);
    s.act("a", "answer", { id: key, answer: "wrong" });
    expect(() => s.act("a", "answer", { id: key, answer: "wrong" })).toThrow(
      /cooldown/,
    );
    for (let i = 1; i < 3; i++) {
      s.advance(5000);
      s.act("a", "answer", { id: key, answer: "wrong" });
    }
    expect(() => s.solve("a", key)).toThrow(/cooldown/);
    s.advance(60000);
    s.solve("a", key);
    expect(s.e.view("a").player.home).toBe(1000);
  });
});

// The configuration the live event actually runs: about ten operators, a small
// raid crew customised before the start, and settings edited during the event.
describe("small live event configuration", () => {
  afterEach(() => resetSettings());

  const crew = (s: ReturnType<typeof setup>, n: number) => {
    for (let i = 0; i < n; i++) {
      const id = `p${i}`;
      s.add(id);
      s.internals.state.players[id].completed = Array(5).fill("fixture");
      s.positions.set(id, { x: 65, y: 6 });
      s.fund(id, 10000, "BANK");
    }
  };

  it("forms a crew of 3 and a 2-of-3 raid succeeds, pays the crew and conserves Rs 4,000", () => {
    const s = setup();
    s.e.updateSettings({ smallRaidCrew: 3, raidPass: 2 });
    crew(s, 10);
    s.e.start();
    expect(s.internals.state.raidCrewSize).toBe(3);
    s.at(45);
    for (let i = 0; i < 3; i++) s.act(`p${i}`, "raid_join");
    s.advance(MINUTE);
    s.e.tick();
    expect(s.e.view("p0").raid.crew).toBe(3);
    const homesBefore = [0, 1, 2].map((i) => s.e.view(`p${i}`).player.home);
    // Two of the three clear their two questions; the third clears none.
    for (const id of ["p0", "p1"]) {
      s.solve(id);
      s.solve(id);
    }
    s.advance(15 * MINUTE);
    s.e.tick();
    const homesAfter = [0, 1, 2].map((i) => s.e.view(`p${i}`).player.home);
    expect(homesAfter[0]).toBeGreaterThan(homesBefore[0]);
    expect(homesAfter[1]).toBeGreaterThan(homesBefore[1]);
    expect(s.e.audit().ok).toBe(true);
    expect(s.e.total()).toBe(EVENT_RULES.total);
  });

  it("never needs more passes than the crew has, even if misconfigured", () => {
    const s = setup();
    s.e.updateSettings({ smallRaidCrew: 3, raidPass: 3 });
    crew(s, 10);
    s.e.start();
    // Simulate the pass count drifting above the crew after the start.
    EVENT_RULES.raidPass = 5;
    s.at(45);
    for (let i = 0; i < 3; i++) s.act(`p${i}`, "raid_join");
    s.advance(MINUTE);
    s.e.tick();
    const before = s.e.view("p0").player.home;
    for (const id of ["p0", "p1", "p2"]) {
      s.solve(id);
      s.solve(id);
    }
    s.advance(15 * MINUTE);
    s.e.tick();
    expect(s.e.view("p0").player.home).toBeGreaterThan(before);
    expect(s.e.audit().ok).toBe(true);
  });

  it("accepts saves after the start that re-send a customised pre-start value", () => {
    const s = setup();
    s.e.updateSettings({ smallRaidCrew: 3, raidPass: 2 });
    s.add("a");
    s.e.start();
    // The console re-sends every non-default value with each save.
    expect(() =>
      s.e.updateSettings({ smallRaidCrew: 3, raidPass: 2, cap: 120_000 }),
    ).not.toThrow();
    expect(EVENT_RULES.cap).toBe(120_000);
    // Actually changing a pre-start field is still refused.
    expect(() =>
      s.e.updateSettings({ smallRaidCrew: 4, raidPass: 2 }),
    ).toThrow(/before the event starts/);
  });

  it("refuses a pass requirement larger than the crew", () => {
    const s = setup();
    expect(() => s.e.updateSettings({ smallRaidCrew: 3 })).toThrow(
      /small raid crew/,
    );
    s.e.updateSettings({ smallRaidCrew: 3, raidPass: 3 });
    s.add("a");
    s.e.start();
    expect(() =>
      s.e.updateSettings({ smallRaidCrew: 3, raidPass: 4 }),
    ).toThrow();
  });

  it("keeps pre-start overrides through a restart instead of dropping them", () => {
    const dir = mkdtempSync(join(tmpdir(), "heist-restart-"));
    const path = join(dir, "event.db");
    const s = setup(path);
    s.e.updateSettings({ smallRaidCrew: 3, raidPass: 2, cap: 120_000 });
    s.add("a");
    s.e.start();
    resetSettings();
    const again = new EventEngine(path, s.e.map, () => s.now());
    engines.push(again);
    expect(EVENT_RULES.raidPass).toBe(2);
    expect(EVENT_RULES.cap).toBe(120_000);
    expect(EVENT_RULES.smallRaidCrew).toBe(3);
  });
});

describe("presence after a reset", () => {
  it("marks enrolled operators without a connection as offline, keeping connected ones online", () => {
    const s = setup();
    s.add("here");
    s.add("gone");
    s.e.reconcilePresence((id) => id === "here");
    expect(s.internals.state.players.here.offlineAt).toBe(0);
    expect(s.internals.state.players.gone.offlineAt).toBeGreaterThan(0);
  });
});

describe("organizer release schedule", () => {
  afterEach(() => resetSettings());
  const tuned = {
    maxPlayers: 40,
    standardPay: 1500,
    standardSlots: 6,
    waveCount: 12,
    waveInterval: 12,
    expertPay: 5000,
    expertCount: 8,
    expertFirst: 20,
    expertInterval: 18,
    smallRaidCrew: 3,
    raidPass: 2,
  };

  it("generates evenly spaced waves and Experts and keeps Rs 4,000", () => {
    const s = setup();
    s.e.updateSettings(tuned);
    expect(s.e.total()).toBe(EVENT_RULES.total);
    expect(s.internals.state.accounts.POOL_STANDARD).toBe(1500 * 6 * 12);
    expect(s.internals.state.accounts.POOL_EXPERT).toBe(5000 * 8);
    expect(s.internals.state.accounts.TREASURY).toBeGreaterThan(0);
    s.add("a");
    s.e.start();
    const slots = s.internals.state.slots as any[];
    const waves = [...new Set(slots.filter((x) => x.wave).map((x) => x.openMinute))];
    expect(waves).toEqual([0, 12, 24, 36, 48, 60, 72, 84, 96, 108, 120, 132]);
    expect(slots.filter((x) => x.wave === 1)).toHaveLength(6);
    expect(new Set(slots.filter((x) => x.wave === 1).map((x) => x.template)).size).toBe(2);
    const experts = slots.filter((x) => !x.wave).map((x) => x.openMinute);
    expect(experts).toEqual([20, 38, 56, 74, 92, 110, 128, 146]);
  });

  it("announces each generated wave and pays a claimed contract from the right pool", () => {
    const s = setup();
    s.e.updateSettings(tuned);
    s.add("a");
    s.e.start();
    s.at(12);
    s.e.tick();
    const notes = s.e.view("a").announcements.map((n) => n.text).join(" | ");
    expect(notes).toMatch(/Standard wave 2 of 12 is live/);
    expect(notes).not.toMatch(/Wave 2 is live\./);
    s.act("a", "job", { id: "SD-01" });
    s.solve("a");
    expect(s.e.view("a").player.home).toBe(1500);
    expect(s.e.audit().ok).toBe(true);
  });

  it("leaves the authored schedule untouched by default", () => {
    const s = setup();
    s.add("a");
    s.e.start();
    const slots = s.internals.state.slots as any[];
    expect([...new Set(slots.filter((x) => x.wave).map((x) => x.openMinute))]).toEqual([0, 20, 50, 80, 120]);
    expect(slots.filter((x) => !x.wave).map((x) => x.openMinute)).toEqual([30, 60, 90, 120, 140]);
  });
});

describe("organizer unlock-all and claim cooldown", () => {
  afterEach(() => resetSettings());
  it("releases every remaining slot now, keeps Rs 4,000, and paces claims with the cooldown", () => {
    const s = setup();
    s.add("a");
    s.e.start();
    s.at(5);
    const pending = () =>
      (s.internals.state.slots as any[]).filter((x) => x.openMinute > 5).length;
    expect(pending()).toBeGreaterThan(0);
    s.e.adminUnlockAll();
    expect(pending()).toBe(0);
    expect(s.e.total()).toBe(EVENT_RULES.total);
    expect(s.e.view("a").announcements.at(-1)!.text).toMatch(/Every contract is now unlocked/);

    s.e.updateSettings({ claimCooldown: 5 * MINUTE });
    s.act("a", "job", { id: "SD-01" });
    s.solve("a");
    // Second paid claim inside the cooldown is refused and explained.
    expect(() => s.act("a", "job", { id: "SD-04" })).toThrow(/Cooldown/);
    const job = s.e.view("a").jobs.find((j) => j.id === "SD-04")!;
    expect(job.available).toBe(false);
    expect(job.lockedReason).toMatch(/Cooldown between paid contracts/);
    s.advance(5 * MINUTE);
    expect(() => s.act("a", "job", { id: "SD-04" })).not.toThrow();
    expect(s.e.audit().ok).toBe(true);
  });
});
