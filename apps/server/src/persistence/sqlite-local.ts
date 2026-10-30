/**
 * apps/server/src/persistence/sqlite.ts
 *
 * SQLite implementation of PlayerRepo, SessionRepo, and StateRepo.
 * Uses Node's built-in `node:sqlite` (DatabaseSync) which is natively supported
 * in Node.js 22+ inside the database worker. Never import this adapter on the game thread.
 */

import { isMainThread } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  Database,
  PlayerRecord,
  PlayerRepo,
  PlayerStateRecord,
  SessionRecord,
  SessionRepo,
  StateRepo,
} from './interfaces.js';

interface RawPlayerRow {
  role: import('@heist/shared').AccountRole;
  id: string;
  username: string;
  password_hash: string;
  created_at: string;
  profile?: string | null;
}

interface RawSessionRow {
  token: string;
  player_id: string;
  created_at: string;
  last_seen: string;
}

interface RawStateRow {
  player_id: string;
  x: number;
  y: number;
  dir: number;
  data: string;
  updated_at: string;
}

export class LocalSqliteDatabase implements Database {
  private db: DatabaseSync;
  get connection() { return this.db; }
  public players: PlayerRepo;
  public sessions: SessionRepo;
  public state: StateRepo;

  constructor(dbPath: string) {
    if (isMainThread) throw new Error('LocalSqliteDatabase must run in a worker');
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);

    // Enable WAL mode for concurrent performance and foreign keys
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = FULL;');
    this.db.exec('PRAGMA foreign_keys = ON;');

    this.db.exec('BEGIN IMMEDIATE');
    try {
    this.createTables();
    const columns = this.db.prepare('PRAGMA table_info(players)').all() as {name:string}[];
    if (!columns.some(c=>c.name==='role')) this.db.exec("ALTER TABLE players ADD COLUMN role TEXT NOT NULL DEFAULT 'player' CHECK(role IN ('player','admin','superadmin'))");
    // Organizer contact details, stored as JSON in one additive column so an
    // existing database upgrades in place, exactly as the role column did.
    if (!columns.some(c=>c.name==='profile')) this.db.exec("ALTER TABLE players ADD COLUMN profile TEXT");
    this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); this.db.close(); throw error; }

    this.players = new SqlitePlayerRepo(this.db);
    this.sessions = new SqliteSessionRepo(this.db);
    this.state = new SqliteStateRepo(this.db);
  }

  async resetStaffPassword(username: string, passwordHash: string): Promise<{role:string;revoked:number}> {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const account = this.db.prepare('SELECT id,role FROM players WHERE username=?').get(username);
      if (!account || !['admin','superadmin'].includes(String(account.role))) throw new Error('Only an existing staff account can be reset');
      this.db.prepare('UPDATE players SET password_hash=? WHERE id=?').run(passwordHash, account.id);
      const revoked = this.db.prepare('DELETE FROM sessions WHERE player_id=?').run(account.id);
      this.db.exec('COMMIT');
      return {role:String(account.role),revoked:Number(revoked.changes)};
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        last_seen TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_player ON sessions(player_id);

      CREATE TABLE IF NOT EXISTS player_state (
        player_id TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
        x INTEGER NOT NULL,
        y INTEGER NOT NULL,
        dir INTEGER NOT NULL,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  async initialize(): Promise<void> {
    this.createTables();
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

class SqlitePlayerRepo implements PlayerRepo {
  private insertStmt: ReturnType<DatabaseSync['prepare']>;
  private findByUsernameStmt: ReturnType<DatabaseSync['prepare']>;
  private findByIdStmt: ReturnType<DatabaseSync['prepare']>;

  private listStmt: ReturnType<DatabaseSync['prepare']>;

  constructor(private db: DatabaseSync) {
    this.insertStmt = this.db.prepare(
      'INSERT INTO players (id, username, password_hash, created_at, role, profile) VALUES (?, ?, ?, ?, ?, ?)'
    );
    this.findByUsernameStmt = this.db.prepare(
      'SELECT id, username, password_hash, created_at, role, profile FROM players WHERE username = ?'
    );
    this.findByIdStmt = this.db.prepare(
      'SELECT id, username, password_hash, created_at, role, profile FROM players WHERE id = ?'
    );
    // password_hash is deliberately absent from this statement.
    this.listStmt = this.db.prepare(
      'SELECT id, username, created_at, role, profile FROM players ORDER BY created_at ASC'
    );
  }

  async createPlayer(id: string, username: string, passwordHash: string, role: import('@heist/shared').AccountRole = 'player', profile?: import('./interfaces.js').PlayerProfile): Promise<void> {
    this.insertStmt.run(
      id,
      username,
      passwordHash,
      new Date().toISOString(),
      role,
      profile && Object.keys(profile).length ? JSON.stringify(profile) : null,
    );
  }

  /**
   * A stored profile that will not parse is treated as absent rather than
   * thrown, so one malformed row cannot make the whole roster unreadable
   * during an event.
   */
  private parseProfile(raw: string | null | undefined) {
    if (!raw) return undefined;
    try {
      const value = JSON.parse(raw);
      return value && typeof value === 'object' ? value : undefined;
    } catch {
      return undefined;
    }
  }

  async listPlayers(): Promise<Omit<PlayerRecord, 'passwordHash'>[]> {
    return (this.listStmt.all() as unknown as RawPlayerRow[]).map((row) => ({
      id: row.id,
      username: row.username,
      role: row.role || 'player',
      createdAt: new Date(row.created_at),
      ...(this.parseProfile(row.profile) ? { profile: this.parseProfile(row.profile) } : {}),
    }));
  }

  async findByUsername(username: string): Promise<PlayerRecord | null> {
    const row = this.findByUsernameStmt.get(username) as RawPlayerRow | undefined;
    if (!row) return null;
    const profile = this.parseProfile(row.profile);
    return {
      id: row.id,
      role: row.role || 'player',
      username: row.username,
      passwordHash: row.password_hash,
      createdAt: new Date(row.created_at),
      ...(profile ? { profile } : {}),
    };
  }

  async findById(id: string): Promise<PlayerRecord | null> {
    const row = this.findByIdStmt.get(id) as RawPlayerRow | undefined;
    if (!row) return null;
    return {
      id: row.id,
      role: row.role || 'player',
      username: row.username,
      passwordHash: row.password_hash,
      createdAt: new Date(row.created_at),
      ...(this.parseProfile(row.profile) ? { profile: this.parseProfile(row.profile) } : {}),
    };
  }
}

class SqliteSessionRepo implements SessionRepo {
  private insertStmt: ReturnType<DatabaseSync['prepare']>;
  private findByTokenStmt: ReturnType<DatabaseSync['prepare']>;
  private updateLastSeenStmt: ReturnType<DatabaseSync['prepare']>;
  private deleteByPlayerStmt: ReturnType<DatabaseSync['prepare']>;

  constructor(private db: DatabaseSync) {
    this.insertStmt = this.db.prepare(
      'INSERT INTO sessions (token, player_id, created_at, last_seen) VALUES (?, ?, ?, ?)'
    );
    this.findByTokenStmt = this.db.prepare(
      'SELECT token, player_id, created_at, last_seen FROM sessions WHERE token = ?'
    );
    this.updateLastSeenStmt = this.db.prepare(
      'UPDATE sessions SET last_seen = ? WHERE token = ?'
    );
    this.deleteByPlayerStmt = this.db.prepare(
      'DELETE FROM sessions WHERE player_id = ?'
    );
  }

  async createSession(token: string, playerId: string): Promise<void> {
    const now = new Date().toISOString();
    this.insertStmt.run(token, playerId, now, now);
  }

  async findByToken(token: string): Promise<SessionRecord | null> {
    const row = this.findByTokenStmt.get(token) as RawSessionRow | undefined;
    if (!row) return null;
    return {
      token: row.token,
      playerId: row.player_id,
      createdAt: new Date(row.created_at),
      lastSeen: new Date(row.last_seen),
    };
  }

  async updateLastSeen(token: string): Promise<void> {
    this.updateLastSeenStmt.run(new Date().toISOString(), token);
  }

  async deleteByPlayerId(playerId: string): Promise<void> {
    this.deleteByPlayerStmt.run(playerId);
  }
}

class SqliteStateRepo implements StateRepo {
  private upsertStmt: ReturnType<DatabaseSync['prepare']>;
  private findByPlayerStmt: ReturnType<DatabaseSync['prepare']>;

  constructor(private db: DatabaseSync) {
    this.upsertStmt = this.db.prepare(`
      INSERT INTO player_state (player_id, x, y, dir, data, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(player_id) DO UPDATE SET
        x = excluded.x,
        y = excluded.y,
        dir = excluded.dir,
        data = excluded.data,
        updated_at = excluded.updated_at
    `);
    this.findByPlayerStmt = this.db.prepare(
      'SELECT player_id, x, y, dir, data, updated_at FROM player_state WHERE player_id = ?'
    );
  }

  async save(state: PlayerStateRecord): Promise<void> {
    this.upsertStmt.run(
      state.playerId,
      state.x,
      state.y,
      state.dir,
      state.data,
      state.updatedAt.toISOString()
    );
  }

  async saveBatch(states: PlayerStateRecord[]): Promise<void> {
    if (states.length === 0) return;
    this.db.exec('BEGIN TRANSACTION');
    try {
      for (const s of states) {
        this.upsertStmt.run(
          s.playerId,
          s.x,
          s.y,
          s.dir,
          s.data,
          s.updatedAt.toISOString()
        );
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async findByPlayerId(playerId: string): Promise<PlayerStateRecord | null> {
    const row = this.findByPlayerStmt.get(playerId) as RawStateRow | undefined;
    if (!row) return null;
    return {
      playerId: row.player_id,
      x: row.x,
      y: row.y,
      dir: row.dir,
      data: row.data,
      updatedAt: new Date(row.updated_at),
    };
  }
}
