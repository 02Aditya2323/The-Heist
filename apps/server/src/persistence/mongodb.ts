import { MongoClient, type Db } from "mongodb";
import type {
  Database,
  PlayerRecord,
  PlayerStateRecord,
  SessionRecord,
} from "./interfaces.js";
import type { AccountRole } from "@heist/shared";

export class MongoDatabase implements Database {
  readonly client: MongoClient;
  readonly db: Db;
  players: Database["players"];
  sessions: Database["sessions"];
  state: Database["state"];
  constructor(uri: string, name: string) {
    this.client = new MongoClient(uri, {
      maxPoolSize: 12,
      minPoolSize: 1,
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      retryWrites: true,
    });
    this.db = this.client.db(name);
    const players = this.db.collection<any>("players"),
      sessions = this.db.collection<any>("sessions"),
      states = this.db.collection<any>("player_state");
    // Old disconnect/snapshot batches must never undo newer positions or a reset.
    const positionUpdate = (fields: Omit<PlayerStateRecord, 'playerId'>) => [{
      $replaceWith: {$cond: [
        {$gte: [fields.updatedAt, {$ifNull: ['$updatedAt', new Date(0)]}]},
        {$mergeObjects: ['$$ROOT', {$literal: fields}]}, '$$ROOT',
      ]},
    }];
    const player = (d: any): PlayerRecord | null =>
      d
        ? {
            id: d._id,
            username: d.username,
            passwordHash: d.passwordHash,
            createdAt: new Date(d.createdAt),
            role: d.role ?? "player",
            ...(d.profile ? { profile: d.profile } : {}),
          }
        : null;
    this.players = {
      createPlayer: async (
        id,
        username,
        passwordHash,
        role: AccountRole = "player",
        profile,
      ) => {
        await players.insertOne({
          _id: id,
          username,
          passwordHash,
          role,
          createdAt: new Date(),
          // Omitted entirely when empty, so existing documents and documents
          // from players who skipped the fields stay identical in shape.
          ...(profile && Object.keys(profile).length ? { profile } : {}),
        });
      },
      findByUsername: async (username) =>
        player(await players.findOne({ username })),
      findById: async (id) => player(await players.findOne({ _id: id })),
      // The projection excludes passwordHash rather than deleting it after the
      // fact, so a hash cannot reach the roster even by mistake.
      listPlayers: async () =>
        (
          await players
            .find({}, { projection: { passwordHash: 0 } })
            .sort({ createdAt: 1 })
            .toArray()
        ).map((d: any) => ({
          id: d._id,
          username: d.username,
          role: d.role ?? "player",
          createdAt: new Date(d.createdAt),
          ...(d.profile ? { profile: d.profile } : {}),
        })),
    };
    const session = (d: any): SessionRecord | null =>
      d
        ? {
            token: d._id,
            playerId: d.playerId,
            createdAt: new Date(d.createdAt),
            lastSeen: new Date(d.lastSeen),
          }
        : null;
    this.sessions = {
      createSession: async (token, playerId) => {
        await sessions.insertOne({
          _id: token,
          playerId,
          createdAt: new Date(),
          lastSeen: new Date(),
        });
      },
      findByToken: async (token) =>
        session(await sessions.findOne({ _id: token })),
      updateLastSeen: async (token) => {
        await sessions.updateOne(
          { _id: token },
          { $set: { lastSeen: new Date() } },
        );
      },
      deleteByPlayerId: async (playerId) => {
        await sessions.deleteMany({ playerId });
      },
    };
    this.state = {
      save: async (state) => {
        const { playerId, ...fields } = state;
        await states.updateOne(
          { _id: playerId },
          positionUpdate(fields),
          { upsert: true },
        );
      },
      saveBatch: async (items) => {
        if (items.length)
          await states.bulkWrite(
            items.map(({ playerId, ...fields }) => ({
              updateOne: {
                filter: { _id: playerId },
                update: positionUpdate(fields),
                upsert: true,
              },
            })),
          );
      },
      findByPlayerId: async (playerId) => {
        const d = await states.findOne({ _id: playerId });
        return d
          ? {
              playerId,
              x: d.x,
              y: d.y,
              dir: d.dir,
              data: d.data,
              updatedAt: new Date(d.updatedAt),
            }
          : null;
      },
    };
  }
  async initialize() {
    await this.client.connect();
    await this.db.command({ ping: 1 });
    await this.db
      .collection("players")
      .createIndex({ username: 1 }, { unique: true });
    await this.db.collection("sessions").createIndex({ playerId: 1 });
    await this.db
      .collection("event_records")
      .createIndex({ epoch: 1, table: 1, id: 1 }, { unique: true });
    await this.db.collection("staff_audit").createIndex({ time: -1 });
  }
  async close() {
    await this.client.close();
  }
}
