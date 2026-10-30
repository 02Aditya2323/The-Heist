import { randomBytes } from "node:crypto";
import { EventEngine } from "./event-engine.js";
import {
  EVENT_TABLES,
  type EventPersistenceData,
  type EventPersistence,
  type StaffAudit,
} from "./persistence-contract.js";
import type { MongoDatabase } from "../persistence/mongodb.js";
import { DIR, type GameMap } from "@heist/shared";

/** Single-writer Mongo authority; SQL is a non-persistent transactional scratch simulator only. */
export class MongoAuthority implements EventPersistence {
  private tail: Promise<unknown> = Promise.resolve();
  private revision = 0;
  private epoch = "";
  private owner = randomBytes(24).toString("hex");
  private renewal?: NodeJS.Timeout;
  private healthy = true;
  engine!: EventEngine;
  constructor(
    private database: MongoDatabase,
    private map: GameMap,
    private durationMinutes = 180,
  ) {}
  async initialize() {
    const leases = this.database.db.collection<any>("runtime_leases");
    try {
      await leases.findOneAndUpdate(
        {
          _id: "world",
          $or: [{ expiresAt: { $lt: new Date() } }, { owner: this.owner }],
        },
        {
          $set: { owner: this.owner, expiresAt: new Date(Date.now() + 30000) },
        },
        { upsert: true },
      );
    } catch {
      throw new Error("Another game server currently owns this MongoDB world");
    }
    const current = this.database.db.collection<any>("event_current");
    let doc = await current.findOne({ _id: "world" });
    this.engine = new EventEngine(
      ":memory:",
      this.map,
      Date.now,
      this.durationMinutes,
    );
    if (!doc) {
      this.epoch = randomBytes(16).toString("hex");
      const initial = this.engine.exportPersistence();
      await current.insertOne({
        _id: "world",
        epoch: this.epoch,
        revision: 0,
        data: initial.data,
        owner: this.owner,
      });
      doc = await current.findOne({ _id: "world" });
    }
    this.revision = doc!.revision;
    this.epoch = doc!.epoch;
    await current.updateOne(
      { _id: "world", revision: this.revision },
      { $set: { owner: this.owner } },
    );
    const rows = await this.database.db
      .collection<any>("event_records")
      .find({ epoch: this.epoch })
      .sort({ id: 1 })
      .toArray();
    const tables = Object.fromEntries(
      EVENT_TABLES.map((t) => [
        t,
        rows
          .filter((r) => r.table === t)
          .map(({ _id, epoch, table, ...row }) => row),
      ]),
    ) as EventPersistenceData["tables"];
    this.engine.importPersistence({ data: doc!.data, tables });
    this.renewal = setInterval(() => {
      void leases
        .updateOne(
          { _id: "world", owner: this.owner },
          { $set: { expiresAt: new Date(Date.now() + 30000) } },
        )
        .then((r) => {
          if (r.matchedCount !== 1) this.healthy = false;
        })
        .catch(() => {
          this.healthy = false;
        });
    }, 10000);
    this.renewal.unref();
  }
  /**
   * Group commit.
   *
   * Every operation used to be its own MongoDB transaction that rewrote the
   * whole event state. Atlas sits ~225 ms away from the VM and a commit is
   * several sequential round trips, so the queue could save only about one
   * operation per second. Seventeen players plus the scheduler tick produced
   * more than that, the queue grew without bound, and actions, the board and
   * even the organizer's Pause waited 30-60 s.
   *
   * Operations now queue, and each drain applies every waiting unaudited
   * operation inside one engine stage and persists them in one transaction.
   * Throughput grows with load instead of collapsing. Each operation keeps
   * its own success or error: engine actions are individually atomic (state
   * snapshot plus SQLite savepoint inside `transaction`), so one failing
   * operation cannot corrupt the others in its batch. Audited staff actions
   * are committed alone, because the audit row is written with the commit.
   */
  private queue: {
    operation: () => unknown;
    audit?: StaffAudit;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
  }[] = [];
  private draining = false;
  run<T>(operation: () => T, audit?: StaffAudit): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        operation,
        audit,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.drain();
    });
  }
  private drain() {
    if (this.draining) return;
    this.draining = true;
    const work = this.tail.then(async () => {
      while (this.queue.length) {
        const first = this.queue[0];
        let size = 1;
        if (!first.audit)
          while (
            size < this.queue.length &&
            size < 64 &&
            !this.queue[size].audit
          )
            size++;
        const batch = this.queue.splice(0, size);
        if (!this.healthy) {
          const error = new Error(
            "Database authority unavailable; actions are paused",
          );
          for (const item of batch) item.reject(error);
          continue;
        }
        try {
          const outcomes = await this.engine.stage(
            () =>
              batch.map((item) => {
                try {
                  return { ok: true as const, value: item.operation() };
                } catch (error) {
                  return { ok: false as const, error };
                }
              }),
            (data) => this.commit(data, this.epoch, false, first.audit),
          );
          outcomes.forEach((outcome, i) =>
            outcome.ok
              ? batch[i].resolve(outcome.value)
              : batch[i].reject(outcome.error),
          );
        } catch (error) {
          for (const item of batch) item.reject(error);
        }
      }
    });
    this.tail = work
      .catch(() => {})
      .finally(() => {
        this.draining = false;
        if (this.queue.length) this.drain();
      });
  }
  private async commit(
    value: EventPersistenceData,
    nextEpoch = this.epoch,
    archive = false,
    audit?: StaffAudit,
  ) {
    const session = this.database.client.startSession(),
      operation = randomBytes(16).toString("hex");
    try {
      await session.withTransaction(
        async () => {
          const lease = await this.database.db
            .collection<any>("runtime_leases")
            .findOne(
              {
                _id: "world",
                owner: this.owner,
                expiresAt: { $gt: new Date() },
              },
              { session },
            );
          if (!lease) throw new Error("Server lease expired");
          const current = this.database.db.collection<any>("event_current");
          const old = archive
            ? await current.findOne(
                { _id: "world", revision: this.revision, owner: this.owner },
                { session },
              )
            : null;
          if (archive && !old)
            throw new Error("World revision changed; refusing stale writer");
          if (audit) await this.database.db.collection<any>('staff_audit').insertOne({
            _id: operation, ...audit, epoch: this.epoch, nextEpoch,
            revision: this.revision + 1, time: new Date(),
          }, {session});
          if (archive)
            await this.database.db
              .collection<any>("event_archives")
              .insertOne(
                {
                  _id: this.epoch,
                  epoch: this.epoch,
                  revision: this.revision,
                  data: old!.data,
                  archivedAt: new Date(),
                },
                { session },
              );
          if (archive) {
            const spawn = this.map.spawns[0];
            await this.database.db
              .collection("player_state")
              .updateMany(
                {},
                {
                  $set: {
                    x: spawn.x,
                    y: spawn.y,
                    dir: DIR.DOWN,
                    data: JSON.stringify({ mapVersion: this.map.version }),
                    updatedAt: new Date(),
                  },
                },
                { session },
              );
          }
          const rows = EVENT_TABLES.flatMap((table) =>
            value.tables[table].map((row) => ({
              ...row,
              _id: `${nextEpoch}:${table}:${row.id}`,
              epoch: nextEpoch,
              table,
            })),
          );
          if (rows.length)
            await this.database.db
              .collection<any>("event_records")
              .insertMany(rows, { session, ordered: true });
          const result = await current.updateOne(
            { _id: "world", revision: this.revision, owner: this.owner },
            {
              $set: {
                data: value.data,
                epoch: nextEpoch,
                lastCommit: operation,
              },
              $inc: { revision: 1 },
            },
            { session },
          );
          if (result.matchedCount !== 1)
            throw new Error("Concurrent world commit refused");
        },
        {
          writeConcern: { w: "majority" },
          readConcern: { level: "snapshot" },
          maxCommitTimeMS: 10000,
        },
      );
    } catch (error) {
      const committed = await this.database.db
        .collection<any>("event_current")
        .findOne({ _id: "world", lastCommit: operation, owner: this.owner });
      if (!committed) {
        throw error;
      }
    } finally {
      await session.endSession();
    }
    this.revision++;
    this.epoch = nextEpoch;
  }
  reset(
    roster: { id: string; name: string }[],
    expected: string,
    audit?: StaffAudit,
  ): Promise<EventEngine> {
    const next = this.tail.then(async () => {
      if (!this.healthy) throw new Error("Authority unavailable");
      if (expected !== this.engine.eventKey())
        throw new Error("Reset confirmation is stale");
      const fresh = new EventEngine(
        ":memory:",
        this.map,
        Date.now,
        this.durationMinutes,
      );
      try {
        for (const p of roster) fresh.ensurePlayer(p.id, p.name);
        const epoch = randomBytes(16).toString("hex");
        await this.commit(fresh.exportPersistence(), epoch, true, audit);
        const previous = this.engine;
        this.engine = fresh;
        previous.close();
        return fresh;
      } catch (e) {
        fresh.close();
        throw e;
      }
    });
    this.tail = next.catch(() => {});
    return next;
  }
  async close() {
    if (this.renewal) clearInterval(this.renewal);
    await this.tail;
    await this.database.db
      .collection<any>("runtime_leases")
      .updateOne(
        { _id: "world", owner: this.owner },
        { $set: { expiresAt: new Date(0) } },
      );
  }
}
