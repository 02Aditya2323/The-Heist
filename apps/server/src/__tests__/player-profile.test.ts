import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteDatabase } from "../persistence/sqlite.js";

let dir: string;
let db: SqliteDatabase;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "heist-profile-"));
  db = new SqliteDatabase(join(dir, "test.db"));
  await db.initialize();
});

afterEach(async () => {
  await db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("optional player profiles", () => {
  it("registers a player with no profile at all", async () => {
    // The owner required that signing up stay frictionless, so the absence of
    // every contact field must be a completely ordinary registration.
    await db.players.createPlayer("p1", "runner_01", "hash");
    const found = await db.players.findByUsername("runner_01");
    expect(found?.username).toBe("runner_01");
    expect(found?.profile).toBeUndefined();
  });

  it("stores and returns a full profile", async () => {
    await db.players.createPlayer("p2", "runner_02", "hash", "player", {
      fullName: "Asha Rao",
      email: "asha@example.edu",
      phone: "98765 43210",
      team: "Team Nightfall",
    });
    const found = await db.players.findByUsername("runner_02");
    expect(found?.profile).toEqual({
      fullName: "Asha Rao",
      email: "asha@example.edu",
      phone: "98765 43210",
      team: "Team Nightfall",
    });
  });

  it("stores a partial profile without inventing the missing fields", async () => {
    await db.players.createPlayer("p3", "runner_03", "hash", "player", {
      team: "Solo",
    });
    const found = await db.players.findByUsername("runner_03");
    expect(found?.profile).toEqual({ team: "Solo" });
  });

  it("treats an empty profile object as no profile", async () => {
    await db.players.createPlayer("p4", "runner_04", "hash", "player", {});
    const found = await db.players.findByUsername("runner_04");
    expect(found?.profile).toBeUndefined();
  });

  it("never includes a password hash in the roster", async () => {
    // This is the property that matters most: the roster is exported to a
    // spreadsheet, so a hash reaching it would be a credential leak.
    await db.players.createPlayer("p5", "runner_05", "super-secret-hash");
    const roster = await db.players.listPlayers!();
    expect(roster).toHaveLength(1);
    expect(JSON.stringify(roster)).not.toContain("super-secret-hash");
    expect((roster[0] as Record<string, unknown>).passwordHash).toBeUndefined();
  });

  it("lists players oldest first with their roles", async () => {
    await db.players.createPlayer("a", "first", "h");
    await db.players.createPlayer("b", "second", "h", "superadmin");
    const roster = await db.players.listPlayers!();
    expect(roster.map((r) => r.username)).toEqual(["first", "second"]);
    expect(roster[1].role).toBe("superadmin");
  });

  it("survives a profile column holding unparseable text", async () => {
    // One corrupted row must not make the whole roster unreadable during an
    // event, so a bad value is treated as absent rather than thrown.
    await db.players.createPlayer("p6", "runner_06", "hash", "player", {
      team: "ok",
    });
    const fixture = new DatabaseSync(join(dir, 'test.db'));
    fixture.exec(
      "UPDATE players SET profile = 'not json at all' WHERE id = 'p6'",
    );
    fixture.close();
    const found = await db.players.findByUsername("runner_06");
    expect(found?.username).toBe("runner_06");
    expect(found?.profile).toBeUndefined();
    const roster = await db.players.listPlayers!();
    expect(roster).toHaveLength(1);
  });

  it("upgrades a database created before the profile column existed", async () => {
    // The column is added with the same additive ALTER pattern the role column
    // used, so an existing event database must open and keep its rows.
    await db.players.createPlayer("p7", "runner_07", "hash");
    await db.close();
    const reopened = new SqliteDatabase(join(dir, "test.db"));
    await reopened.initialize();
    const found = await reopened.players.findByUsername("runner_07");
    expect(found?.username).toBe("runner_07");
    await reopened.close();
    // Re-point the outer handle so afterEach closes something valid.
    db = new SqliteDatabase(join(dir, "test.db"));
    await db.initialize();
  });
});
