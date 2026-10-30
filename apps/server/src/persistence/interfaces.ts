/**
 * apps/server/src/persistence/interfaces.ts
 *
 * Repository interfaces for DB access.
 * Spec: "PlayerRepo, SessionRepo, StateRepo. The world and net layers know only these interfaces."
 *
 * Production SQLite uses a dedicated worker. Repository promises resolve after SQL completes.
 */

// ── Player Repository ─────────────────────────────────────────────────

/**
 * Optional contact details collected at registration so the organizer can
 * identify and reach participants, award prizes and keep a roster.
 *
 * Every field is optional by design. The owner was explicit that signing up
 * must stay trivial, so a missing field never blocks registration and nothing
 * here gates play. These are records for the organizer, not credentials.
 */
export interface PlayerProfile {
  fullName?: string;
  email?: string;
  phone?: string;
  team?: string;
}
export interface PlayerRecord {
  role?: import('@heist/shared').AccountRole;
  id: string;
  username: string;
  passwordHash: string;
  createdAt: Date;
  profile?: PlayerProfile;
}

export interface PlayerRepo {
  createPlayer(id: string, username: string, passwordHash: string, role?: import('@heist/shared').AccountRole, profile?: PlayerProfile): Promise<void>;
  /** Roster for the organizer. Never includes password hashes. */
  listPlayers?(): Promise<Omit<PlayerRecord, 'passwordHash'>[]>;
  findByUsername(username: string): Promise<PlayerRecord | null>;
  findById(id: string): Promise<PlayerRecord | null>;
}

// ── Session Repository ────────────────────────────────────────────────

export interface SessionRecord {
  token: string;
  playerId: string;
  createdAt: Date;
  lastSeen: Date;
}

export interface SessionRepo {
  createSession(token: string, playerId: string): Promise<void>;
  findByToken(token: string): Promise<SessionRecord | null>;
  updateLastSeen(token: string): Promise<void>;
  deleteByPlayerId(playerId: string): Promise<void>;
}

// ── State Repository ──────────────────────────────────────────────────

export interface PlayerStateRecord {
  playerId: string;
  x: number;
  y: number;
  dir: number;
  data: string; // JSON string, empty '{}' for now
  updatedAt: Date;
}

export interface StateRepo {
  save(state: PlayerStateRecord): Promise<void>;
  saveBatch(states: PlayerStateRecord[]): Promise<void>;
  findByPlayerId(playerId: string): Promise<PlayerStateRecord | null>;
}

// ── Combined DB interface ─────────────────────────────────────────────

export interface Database {
  metrics?(): Record<string, unknown>;
  players: PlayerRepo;
  sessions: SessionRepo;
  state: StateRepo;
  close(): Promise<void>;
  /** Run schema migrations if needed */
  initialize(): Promise<void>;
}
