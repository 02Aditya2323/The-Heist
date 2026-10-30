import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { EVENT_TABLES, type EventPersistenceData, type StaffAudit } from './persistence-contract.js';
import {
  DIR,
  findPath,
  isWalkable,
  sceneAt,
  type EventRequest,
  type EventView,
  type GameMap,
} from "@heist/shared";
import {
  templates,
  legacyTemplates,
  generateChallenge,
  generateLegacyChallenge,
  validAnswer,
} from "./challenges.js";

import {
  MINUTE,
  EVENT_RULES,
  INITIAL_POOLS as initialPools,
  LEGACY_INITIAL_POOLS,
  validatePrizePlan,
} from "./rules.js";
import {
  applySettings,
  describeSettings,
  planSettings,
  resetSettings,
  type SettingsOverrides,
} from "./settings.js";
export { EVENT_RULES } from "./rules.js";
interface Player {
  id: string;
  name: string;
  homeId: string;
  completed: string[];
  training: string[];
  starter: boolean;
  waves: number[];
  capped: boolean;
  bountyPosted: boolean;
  bounty: boolean;
  jail: number;
  /** When this operator last claimed a paid Standard/Expert contract. */
  lastPaidClaim?: number;
  checkedOut: boolean;
  checkingOut: boolean;
  payout: number;
  offlineAt: number;
  insideHome?: boolean;
  trainingSerial?: number;
  transitDue: number;
  homeCooldown: number;
  thiefCooldown: Record<string, number>;
  messages: { at: number; text: string }[];
  reachedAt: number;
  lastBankFee?: number;
  wealthAlert?: boolean;
}
interface Attempt {
  key: string;
  player: string;
  template: string;
  variant: string;
  expires: number;
  solved: boolean;
  mode: "job" | "training" | "burglary" | "race" | "event" | "raid";
  slot?: string;
  target?: string;
  level?: number;
  lastAnswer: number;
  wrong: number;
  blockedUntil: number;
  catalogueVersion?: number;
  openedAt?: number;
  testRuns?: number;
  feedback?: string;
}
interface Slot {
  id: string;
  template: string;
  wave: number;
  openMinute: number;
  claimed: string;
  holder: string;
  expires: number;
  queue: string[];
  offerUntil: number;
}
interface Contest {
  id: string;
  start: number;
  end: number;
  entrants: string[];
  winners: string[];
  paid: boolean;
}
interface Raid {
  window: number;
  start: number;
  end: number;
  crew: string[];
  stand: Record<string, number>;
  sources: { account: string; amount: number }[];
  solved: Record<string, number>;
  finished: Record<string, number>;
  templates: Record<string, string[]>;
  settled: boolean;
}
interface State {
  generation?:string;
  schema: 1;
  rulesVersion?: number;
  /** Operator overrides on EVENT_RULES. Persisted so a restart keeps them. */
  settings?: Record<string, number>;
  /** The overrides in force at the moment the event started. */
  startSettings?: Record<string, number>;
  /**
   * Real timestamp at which the organizer paused, or 0/absent when running.
   * While set, the schedule clock is frozen, the scheduler does no work and
   * player actions are refused, so no deadline can quietly elapse.
   */
  pausedAt?: number;
  /** Total milliseconds this event has spent paused. Audit/reporting only. */
  pausedTotal?: number;
  initialPools?: Record<string, number>;
  raidCrewSize?: number;
  lastFeeMinute?: number;
  secret: string;
  startedAt: number;
  duration: number;
  phase: "lobby" | "live" | "frozen";
  accounts: Record<string, number>;
  players: Record<string, Player>;
  slots: Slot[];
  attempts: Record<string, Attempt>;
  contests: Contest[];
  raids: Raid[];
  notices: { at: number; text: string }[];
  fired: string[];
  homeLocks: Record<string, string>;
  cardClaims: Record<string, string>;
  cardSites?: { id: string; name: string; x: number; y: number }[];
  courierHolder: string;
  courierUntil: number;
}
export interface Position {
  x: number;
  y: number;
}
interface Transfer {
  from: string;
  to: string;
  amount: number;
  reason: string;
  actor: string;
}
export class EventEngine {
  private db: DatabaseSync;
  private ownsDatabase = true;
  authorityOwner?: string;
  private presenceUpdate: ReturnType<DatabaseSync["prepare"]>;
  private state: State;
  private transfers: Transfer[] = [];
  private auditTimer = 0;
  private closed = false;
  private auditedLedgerId = 0;
  private auditedHash = "GENESIS";
  private ledgerBalances: Record<string, number> = { ...initialPools };
  private ledgerValid = true;
  // Only immutable public puzzle data; never cache player timing, results or money.
  private presentations = new Map<
    string,
    Pick<
      ReturnType<typeof generateChallenge>,
      "prompt" | "client" | "objective" | "difficulty" | "workbench" | "brief"
    >
  >();
  public positionOf: (id: string) => Position | undefined = () => undefined;
  public connected: (id: string) => boolean = () => false;
  private observers = new Map<string,string>();
  addObserver(id:string,name:string){this.observers.set(id,name);}
  roster(){return Object.values(this.state.players).map(p=>({id:p.id,name:p.name}));}
  exportPersistence(since:Partial<Record<typeof EVENT_TABLES[number],number>> = {}):EventPersistenceData {
    return {data:JSON.stringify(this.state),tables:Object.fromEntries(EVENT_TABLES.map(t=>[t,this.db.prepare(`SELECT * FROM ${t} WHERE id>? ORDER BY id`).all(since[t]??0)])) as EventPersistenceData['tables']};
  }
  importPersistence(value:EventPersistenceData){
    this.db.exec('BEGIN IMMEDIATE');
    try{for(const table of EVENT_TABLES){if(this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n)throw new Error('Import requires an empty in-memory authority');const allowed=new Set(this.db.prepare(`PRAGMA table_info(${table})`).all().map(r=>String(r.name)));for(const row of value.tables[table]){const fields=Object.keys(row);if(fields.some(f=>!allowed.has(f)))throw new Error('Unexpected imported event column');this.db.prepare(`INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(()=>'?').join(',')})`).run(...fields.map(f=>row[f]));}}this.state=JSON.parse(value.data);this.state.generation??=randomBytes(16).toString('hex');this.save();this.db.exec('COMMIT');this.resetAuditCache();if(!this.audit().ok)throw new Error('Imported event audit failed');}catch(e){try{this.db.exec('ROLLBACK');}catch{}throw e;}
  }
  private resetAuditCache(){this.auditedLedgerId=0;this.auditedHash='GENESIS';this.ledgerValid=true;this.ledgerBalances={...(this.state.initialPools||initialPools)};this.auditTimer=0;this.presentations.clear();}
  /** Mongo staging keeps its SQL scratch transaction uncommitted until remote majority commit. */
  async stage<T>(operation:()=>T,persist:(data:EventPersistenceData)=>Promise<void>):Promise<T>{
    const auditSnapshot=()=>({id:this.auditedLedgerId,hash:this.auditedHash,valid:this.ledgerValid,balances:{...this.ledgerBalances},timer:this.auditTimer});
    const restoreAudit=(a:ReturnType<typeof auditSnapshot>)=>{this.auditedLedgerId=a.id;this.auditedHash=a.hash;this.ledgerValid=a.valid;this.ledgerBalances=a.balances;this.auditTimer=a.timer;};
    const beforeAudit=auditSnapshot();
    const before=JSON.stringify(this.state), cursor=Object.fromEntries(EVENT_TABLES.map(t=>[t,(this.db.prepare(`SELECT COALESCE(MAX(id),0) AS id FROM ${t}`).get() as {id:number}).id]));
    this.db.exec('BEGIN IMMEDIATE');
    try{const result=operation(), after=JSON.stringify(this.state), value=this.exportPersistence(cursor),afterAudit=auditSnapshot();this.state=JSON.parse(before);restoreAudit(beforeAudit);
      if(after!==before||EVENT_TABLES.some(t=>value.tables[t].length))await persist(value);
      this.db.exec('COMMIT');this.state=JSON.parse(after);restoreAudit(afterAudit);return result;
    }catch(e){this.db.exec('ROLLBACK');this.state=JSON.parse(before);restoreAudit(beforeAudit);throw e;}
  }
  constructor(
    path: string,
    public map: GameMap,
    public clock: () => number = Date.now,
    durationMinutes = 180,
    database?: DatabaseSync,
  ) {
    validatePrizePlan();
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = database ?? new DatabaseSync(path);
    this.ownsDatabase = !database;
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS event_state(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS event_ledger(id INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT NOT NULL,actor TEXT NOT NULL,time INTEGER NOT NULL,source TEXT NOT NULL,destination TEXT NOT NULL,paise INTEGER NOT NULL CHECK(paise>0),reason TEXT NOT NULL,previous_hash TEXT NOT NULL,hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS event_answers(id INTEGER PRIMARY KEY AUTOINCREMENT,time INTEGER NOT NULL,player TEXT NOT NULL,challenge TEXT NOT NULL,accepted INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS event_requests(id INTEGER PRIMARY KEY AUTOINCREMENT,time INTEGER NOT NULL,player TEXT NOT NULL,action TEXT NOT NULL,challenge TEXT NOT NULL,outcome TEXT NOT NULL,message TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS event_notices(id INTEGER PRIMARY KEY AUTOINCREMENT,time INTEGER NOT NULL,text TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS ledger_actor ON event_ledger(actor,id);
    CREATE INDEX IF NOT EXISTS ledger_source ON event_ledger(source,id);
    CREATE INDEX IF NOT EXISTS ledger_destination ON event_ledger(destination,id);
    CREATE INDEX IF NOT EXISTS answers_player ON event_answers(player,id);
    CREATE INDEX IF NOT EXISTS requests_player ON event_requests(player,id);
    CREATE TRIGGER IF NOT EXISTS immutable_ledger_update BEFORE UPDATE ON event_ledger BEGIN SELECT RAISE(ABORT,'Ledger is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS immutable_ledger_delete BEFORE DELETE ON event_ledger BEGIN SELECT RAISE(ABORT,'Ledger is append-only'); END;`);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT OR IGNORE INTO schema_migrations VALUES(1,datetime('now'));
      CREATE TABLE IF NOT EXISTS event_archives(
        generation TEXT PRIMARY KEY, archived_at INTEGER NOT NULL, snapshot TEXT NOT NULL CHECK(json_valid(snapshot))
      );
      CREATE TABLE IF NOT EXISTS staff_audit(
        id INTEGER PRIMARY KEY AUTOINCREMENT, generation TEXT NOT NULL, time INTEGER NOT NULL,
        actor TEXT NOT NULL, username TEXT NOT NULL, action TEXT NOT NULL, target TEXT
      );
      CREATE INDEX IF NOT EXISTS staff_audit_generation ON staff_audit(generation,id);
      CREATE TRIGGER IF NOT EXISTS immutable_archive_update BEFORE UPDATE ON event_archives BEGIN SELECT RAISE(ABORT,'Archives are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_archive_delete BEFORE DELETE ON event_archives BEGIN SELECT RAISE(ABORT,'Archives are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_staff_update BEFORE UPDATE ON staff_audit BEGIN SELECT RAISE(ABORT,'Staff audit is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_staff_delete BEFORE DELETE ON staff_audit BEGIN SELECT RAISE(ABORT,'Staff audit is append-only'); END;
      CREATE VIEW IF NOT EXISTS event_accounts AS SELECT j.key AS account,j.value AS paise FROM event_state,json_each(data,'$.accounts') j;
      CREATE VIEW IF NOT EXISTS event_players AS SELECT j.key AS player_id,json_extract(j.value,'$.homeId') AS home_id,j.value AS data FROM event_state,json_each(data,'$.players') j;
      CREATE VIEW IF NOT EXISTS event_contracts AS SELECT json_extract(j.value,'$.id') AS contract_id,json_extract(j.value,'$.holder') AS holder,j.value AS data FROM event_state,json_each(data,'$.slots') j;
      CREATE VIEW IF NOT EXISTS event_attempts AS SELECT j.key AS attempt_id,json_extract(j.value,'$.player') AS player_id,json_extract(j.value,'$.template') AS template,j.value AS data FROM event_state,json_each(data,'$.attempts') j;
    `);
    this.presenceUpdate = this.db.prepare(
      "UPDATE event_state SET data=json_patch(data,?) WHERE id=1",
    );
    const saved = this.db
      .prepare("SELECT data FROM event_state WHERE id=1")
      .get() as { data: string } | undefined;
    this.state = saved
      ? JSON.parse(saved.data)
      : {
          schema: 1,
          rulesVersion: 2,
          initialPools: { ...initialPools },
          lastFeeMinute: 10,
          secret: randomBytes(32).toString("hex"),
          startedAt: 0,
          duration: durationMinutes * MINUTE,
          phase: "lobby",
          accounts: { ...initialPools },
          players: {},
          slots: [],
          attempts: {},
          contests: [],
          raids: [],
          notices: [
            {
              at: this.clock(),
              text: "NEXUS // Veyra City awaits the Great Reset. Explore the city; paid contracts open when the event starts.",
            },
          ],
          fired: [],
          homeLocks: {},
          cardClaims: {},
          courierHolder: "",
          courierUntil: 0,
        };
    // Re-apply any persisted operator overrides before the ledger baseline is
    // taken, so a restart resumes under exactly the settings the event ran with.
    // A stored override set that no longer validates is dropped rather than
    // allowed to block startup: the documented defaults are always safe.
    if (this.state.settings && Object.keys(this.state.settings).length) {
      try {
        const plan = planSettings(this.state.settings, {
          started: !!this.state.startedAt,
          // Events started before startSettings existed are validated against
          // their own stored overrides, which is what they started with.
          locked: this.state.startSettings ?? this.state.settings,
        });
        applySettings(plan.values);
        if (!this.state.startedAt) this.state.initialPools = { ...plan.pools };
      } catch {
        this.state.settings = {};
        resetSettings();
      }
    } else resetSettings();
    this.ledgerBalances = {
      ...(this.state.initialPools ||
        (saved ? LEGACY_INITIAL_POOLS : initialPools)),
    };
    this.state.generation??=randomBytes(16).toString('hex');
    if (saved && !this.state.rulesVersion) {
      if (this.state.startedAt)
        throw new Error(
          "An active legacy event must finish under its old build. Use a new EVENT_DB_PATH for the final challenge-book rules.",
        );
      if (path !== ":memory:" && !existsSync(`${path}.before-final-book.db`))
        this.db.exec(
          `VACUUM INTO '${`${path}.before-final-book.db`.replace(/'/g, "''")}'`,
        );
      this.state.initialPools = { ...LEGACY_INITIAL_POOLS };
      this.transaction(() => {
        // Moves a legacy world's opening balances onto the current plan. The
        // deltas sum to zero, so this is expressible as transfers and the
        // Rs 4,000 total is never touched:
        //   POOL_STARTER   450 -> 600   (+150, funds 60 Starter slots)
        //   POOL_STANDARD  450 -> 800   (+350)
        //   TREASURY       600 -> 300   (-300)
        //   BANK_SEED_FINAL 700 -> 500  (-200)
        // These must land exactly on INITIAL_POOLS; the migration test asserts
        // it, so rebalancing the plan means rebalancing these transfers too.
        this.transfer(
          "TREASURY",
          "POOL_STANDARD",
          30000,
          "Final book plan migration",
          "ORGANIZER",
        );
        this.transfer(
          "BANK_SEED_FINAL",
          "POOL_STANDARD",
          5000,
          "Final book plan migration",
          "ORGANIZER",
        );
        this.transfer(
          "BANK_SEED_FINAL",
          "POOL_STARTER",
          15000,
          "Final book plan migration",
          "ORGANIZER",
        );
        this.state.accounts.BANK_FEE_VAULT = 0;
        this.state.rulesVersion = 2;
        this.state.lastFeeMinute = 10;
        if (
          this.state.phase === "frozen" &&
          this.state.notices.at(-1)?.text.includes("Economy audit failed")
        )
          this.state.phase = "lobby";
        this.notice(
          "NEXUS // Final challenge book installed. 60-player economy; all existing city artwork and Home addresses preserved.",
        );
      });
    }
    this.save();
    this.audit();
  }
  /** One worker command commits gameplay and its staff audit together. */
  runDurable<T>(operation: () => T, audit?: StaffAudit): T {
    const before = JSON.stringify(this.state), observers = new Map(this.observers);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (this.authorityOwner && !this.db.prepare('SELECT owner FROM runtime_lease WHERE id=1 AND owner=? AND expires_at>?').get(this.authorityOwner, Date.now())) throw new Error('SQLite world ownership expired');
      const value = operation();
      if (audit) this.db.prepare('INSERT INTO staff_audit(generation,time,actor,username,action,target) VALUES(?,?,?,?,?,?)')
        .run(this.eventKey(), this.clock(), audit.actor, audit.username, audit.action, audit.target ?? null);
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      this.state = JSON.parse(before);
      this.observers = observers;
      resetSettings();
      if (this.state.settings && Object.keys(this.state.settings).length)
        applySettings(planSettings(this.state.settings, { started: !!this.state.startedAt, locked: this.state.startSettings ?? this.state.settings }).values);
      this.resetAuditCache();
      throw error;
    }
  }

  /** Called inside runDurable: archive first, replace the round and positions atomically. */
  resetRound(expected: string, roster: {id: string; name: string}[], spawn: Position) {
    if (expected !== this.eventKey()) throw new Error('Reset confirmation is stale');
    const archived = this.exportPersistence();
    const fresh = new EventEngine(':memory:', this.map, this.clock, this.state.duration / MINUTE);
    try {
      for (const player of roster) fresh.ensurePlayer(player.id, player.name);
      fresh.markAllOffline();
      this.db.prepare('INSERT INTO event_archives(generation,archived_at,snapshot) VALUES(?,?,?)')
        .run(expected, this.clock(), JSON.stringify(archived));
      // The complete old ledger is now immutable in event_archives, in this same transaction.
      this.db.exec('DROP TRIGGER immutable_ledger_delete');
      for (const table of EVENT_TABLES) this.db.exec(`DELETE FROM ${table}`);
      this.db.exec("CREATE TRIGGER immutable_ledger_delete BEFORE DELETE ON event_ledger BEGIN SELECT RAISE(ABORT,'Ledger is append-only'); END");
      const next = fresh.exportPersistence();
      for (const table of EVENT_TABLES) for (const row of next.tables[table]) {
        const fields = Object.keys(row);
        this.db.prepare(`INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(()=>'?').join(',')})`).run(...fields.map(f=>row[f]));
      }
      this.state = JSON.parse(next.data);
      this.save();
      // Auth, sessions and positions share this database in the worker runtime.
      if (this.db.prepare("SELECT name FROM sqlite_master WHERE name='player_state'").get())
        this.db.prepare('UPDATE player_state SET x=?,y=?,dir=?,data=?,updated_at=?')
          .run(spawn.x, spawn.y, DIR.DOWN, JSON.stringify({mapVersion:this.map.version,eventGeneration:this.eventKey()}), new Date(this.clock()).toISOString());
      this.resetAuditCache();
      if (!this.audit().ok) throw new Error('New event audit failed');
    } finally { fresh.close(); }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.presentations.clear();
    if (this.ownsDatabase) this.db.close();
  }
  eventKey(){return this.state.generation!;}
  private save(data = JSON.stringify(this.state)) {
    this.db
      .prepare(
        "INSERT INTO event_state(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(data);
  }
  private transaction<T>(fn: () => T): T {
    // State is a JSON-persisted schema. Build its rollback snapshot once, and only
    // deserialize it on failure instead of eagerly deep-cloning every successful
    // tick, answer and reconnect. Account comparison still guards every transfer.
    const beforeJson = JSON.stringify(this.state);
    const beforeAccounts = { ...this.state.accounts };
    this.transfers = [];
    this.db.exec("SAVEPOINT event_action");
    try {
      const result = fn();
      if (this.total() !== EVENT_RULES.total)
        throw new Error("Economy invariant failed");
      const changes: Record<string, number> = {};
      for (const t of this.transfers) {
        changes[t.from] = (changes[t.from] || 0) - t.amount;
        changes[t.to] = (changes[t.to] || 0) + t.amount;
      }
      for (const key of new Set([
        ...Object.keys(beforeAccounts),
        ...Object.keys(this.state.accounts),
      ])) {
        if (
          (this.state.accounts[key] || 0) !==
          (beforeAccounts[key] || 0) + (changes[key] || 0)
        )
          throw new Error("An account changed without a ledger transfer");
      }
      let hash =
        (
          this.db
            .prepare("SELECT hash FROM event_ledger ORDER BY id DESC LIMIT 1")
            .get() as { hash: string } | undefined
        )?.hash || "GENESIS";
      const insert = this.db.prepare(
        "INSERT INTO event_ledger(event_id,actor,time,source,destination,paise,reason,previous_hash,hash) VALUES(?,?,?,?,?,?,?,?,?)",
      );
      for (const t of this.transfers) {
        const time = this.clock(),
          eventId = String(this.state.startedAt);
        const next = createHash("sha256")
          .update(
            JSON.stringify([
              hash,
              eventId,
              t.actor,
              time,
              t.from,
              t.to,
              t.amount,
              t.reason,
            ]),
          )
          .digest("hex");
        insert.run(
          eventId,
          t.actor,
          time,
          t.from,
          t.to,
          t.amount,
          t.reason,
          hash,
          next,
        );
        hash = next;
      }
      const afterJson = JSON.stringify(this.state);
      if (afterJson !== beforeJson) this.save(afterJson);
      this.db.exec("RELEASE event_action");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK TO event_action; RELEASE event_action");
      this.state = JSON.parse(beforeJson) as State;
      throw error;
    } finally {
      this.transfers = [];
    }
  }
  private transfer(
    from: string,
    to: string,
    amount: number,
    reason: string,
    actor = "NEXUS",
  ) {
    if (
      !Number.isSafeInteger(amount) ||
      amount < 0 ||
      amount > (this.state.accounts[from] || 0)
    )
      throw new Error("Invalid account transfer");
    if (!amount) return;
    this.state.accounts[from] -= amount;
    this.state.accounts[to] = (this.state.accounts[to] || 0) + amount;
    this.transfers.push({ from, to, amount, reason, actor });
  }
  total() {
    return Object.values(this.state.accounts).reduce((a, b) => a + b, 0);
  }
  audit() {
    const rows = this.db
      .prepare("SELECT * FROM event_ledger WHERE id>? ORDER BY id")
      .all(this.auditedLedgerId) as unknown as Array<{
      id: number;
      hash: string;
      previous_hash: string;
      event_id: string;
      actor: string;
      time: number;
      source: string;
      destination: string;
      paise: number;
      reason: string;
    }>;
    for (const row of rows) {
      const hash = createHash("sha256")
        .update(
          JSON.stringify([
            this.auditedHash,
            row.event_id,
            row.actor,
            row.time,
            row.source,
            row.destination,
            row.paise,
            row.reason,
          ]),
        )
        .digest("hex");
      if (row.previous_hash !== this.auditedHash || row.hash !== hash)
        this.ledgerValid = false;
      this.ledgerBalances[row.source] =
        (this.ledgerBalances[row.source] || 0) - row.paise;
      this.ledgerBalances[row.destination] =
        (this.ledgerBalances[row.destination] || 0) + row.paise;
      this.auditedHash = row.hash;
      this.auditedLedgerId = row.id;
    }
    const accounts = this.state.accounts,
      keys = new Set([
        ...Object.keys(accounts),
        ...Object.keys(this.ledgerBalances),
      ]),
      reconciled = [...keys].every(
        (key) => (accounts[key] || 0) === (this.ledgerBalances[key] || 0),
      );
    const ok =
      this.ledgerValid &&
      reconciled &&
      this.total() === EVENT_RULES.total &&
      Object.values(accounts).every((a) => Number.isSafeInteger(a) && a >= 0);
    if (!ok) {
      if (this.state.phase !== "frozen")
        this.notice(
          "NEXUS // Economy audit failed. Money movement is frozen for organizer review.",
        );
      this.state.phase = "frozen";
      this.save();
    }
    return {
      ok,
      total: this.total(),
      expected: EVENT_RULES.total,
      reconciled,
      ledgerValid: this.ledgerValid,
      ledgerRows: this.auditedLedgerId,
      accounts: { ...accounts },
    };
  }
  ledger(limit = 100) {
    return this.db
      .prepare("SELECT * FROM event_ledger ORDER BY id DESC LIMIT ?")
      .all(Math.min(500, Math.max(1, limit)));
  }
  history(id: string, before = Number.MAX_SAFE_INTEGER) {
    if (!this.state.players[id]) throw new Error("Unknown operator");
    const answers = this.db
      .prepare(
        "SELECT time,challenge,accepted FROM event_answers WHERE player=? ORDER BY id DESC LIMIT 100",
      )
      .all(id) as unknown as {
      time: number;
      challenge: string;
      accepted: number;
    }[];
    return {
      player: this.playerView(this.state.players[id]),
      ledger: this.db
        .prepare(
          "SELECT * FROM event_ledger WHERE id<? AND (actor=? OR source IN (?,?,?) OR destination IN (?,?,?)) ORDER BY id DESC LIMIT 100",
        )
        .all(
          before,
          id,
          this.account(id),
          this.account(id, "BANK"),
          this.account(id, "TRANSIT"),
          this.account(id),
          this.account(id, "BANK"),
          this.account(id, "TRANSIT"),
        ),
      requests: this.db
        .prepare(
          "SELECT time,action,challenge,outcome,message FROM event_requests WHERE player=? ORDER BY id DESC LIMIT 100",
        )
        .all(id),
      answers: answers.map((row) => {
        const a = this.state.attempts[row.challenge];
        return {
          ...row,
          openedAt: a ? this.availableAt(a) : null,
          elapsedMs: a ? row.time - this.availableAt(a) : null,
          mode: a?.mode || "unknown",
        };
      }),
    };
  }
  adminView() {
    return {
      eventKey:this.eventKey(),
      audit: this.audit(),
      phase: this.state.phase,
      paused: this.paused(),
      pausedAt: this.state.pausedAt || 0,
      pausedTotal: this.state.pausedTotal || 0,
      minute: this.minute(),
      serverTime: this.gameNow(),
      settings: this.settingsView(),
      accounts: { ...this.state.accounts },
      startedAt: this.state.startedAt,
      durationMs: this.state.duration,
      rulesVersion: this.state.rulesVersion,
      maxPlayers: EVENT_RULES.maxPlayers,
      raidCrewSize: this.state.raidCrewSize || 0,
      checkoutMinute: EVENT_RULES.checkoutOpen,
      players: Object.values(this.state.players).map((p) => {
        const now = this.gameNow();
        const active = Object.values(this.state.attempts).find(
          (a) => a.player === p.id && !a.solved && a.expires > now,
        );
        return {
          id: p.id,
          ...this.playerView(p),
          offline: !!p.offlineAt,
          wealth: this.wealth(p.id),
          activeContract: active ? active.template : "",
          activeMode: active ? active.mode : "",
          activeExpires: active ? active.expires : 0,
        };
      }),
      slots: this.state.slots,
      raids: this.state.raids,
      ledger: this.ledger(),
    };
  }
  /**
   * Aggregate view for the big-screen spectator board.
   *
   * Everything here is already visible to every player: the in-game HUD shows
   * the same leaderboard, the same announcements and the same clock. The board
   * therefore exposes nothing new, which is what makes it safe to serve without
   * authentication to a projector that nobody is logged in on.
   *
   * It deliberately contains no challenge content, no answers, no per-account
   * balances broken down by location, and no session or identity information.
   */
  boardView() {
    const players = Object.values(this.state.players);
    const standings = players
      .map((q) => ({
        name: q.name,
        score: q.checkedOut ? q.payout : this.wealth(q.id),
        completed: q.completed.length,
        capped: q.capped,
        checkedOut: q.checkedOut,
        reached: q.reachedAt,
      }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.completed - a.completed ||
          a.reached - b.reached,
      );
    return {
      phase: this.state.phase,
      paused: this.paused(),
      serverTime: this.gameNow(),
      startedAt: this.state.startedAt,
      durationMs: this.state.duration,
      minute: this.minute(),
      enrolled: players.length,
      online: players.filter((q) => !q.offlineAt && !q.checkedOut).length,
      checkedOut: players.filter((q) => q.checkedOut).length,
      solved: players.reduce((a, q) => a + q.completed.length, 0),
      /** Prize money still unclaimed in the five contract pools. */
      prizesRemaining: [
        "POOL_STARTER",
        "POOL_STANDARD",
        "POOL_EXPERT",
        "POOL_RACE",
        "POOL_EVENT",
      ].reduce((a, key) => a + (this.state.accounts[key] || 0), 0),
      paidOut: this.state.accounts.PAYOUT || 0,
      leaderboard: standings.slice(0, 15),
      announcements: this.state.notices.slice(-6),
    };
  }
  /** Public health reads must not scan or mutate the economy audit. */
  status() {
    return { phase: this.state.phase, paused: this.paused() };
  }
  private account(id: string, kind = "HOME") {
    return `${kind}:${id}`;
  }
  private balance(id: string, kind = "HOME") {
    return this.state.accounts[this.account(id, kind)] || 0;
  }
  private wealth(id: string) {
    return (
      this.balance(id) + this.balance(id, "BANK") + this.balance(id, "TRANSIT")
    );
  }
  private notice(text: string) {
    this.state.notices.push({ at: this.clock(), text });
    this.state.notices = this.state.notices.slice(-30);
    this.db
      .prepare("INSERT INTO event_notices(time,text) VALUES(?,?)")
      .run(this.clock(), text);
  }
  private message(p: Player, text: string) {
    p.messages.push({ at: this.clock(), text });
    p.messages = p.messages.slice(-20);
  }
  private checkCap(p: Player) {
    const wealth = this.wealth(p.id);
    p.reachedAt = this.clock();
    if (!p.wealthAlert && this.balance(p.id) >= 30000) {
      p.wealthAlert = true;
      this.notice(
        `WEALTH ALERT // ${p.name}'s Home has crossed ₹300. Protect your earnings.`,
      );
    }
    if (!p.capped && wealth >= EVENT_RULES.cap) {
      p.capped = true;
      this.notice(
        `${p.name} has reached ₹800. Their Home is exposed. NEXUS marks the richest operator.`,
      );
      if (!p.bountyPosted) {
        p.bountyPosted = true;
        if (this.state.accounts.TREASURY >= EVENT_RULES.bounty) p.bounty = true;
      }
    } else if (p.capped && wealth < EVENT_RULES.reactivate) p.capped = false;
  }
  private reward(p: Player, source: string, requested: number, reason: string) {
    if (p.capped || p.checkedOut) return 0;
    const amount = Math.min(
      requested,
      EVENT_RULES.cap - this.wealth(p.id),
      this.state.accounts[source] || 0,
    );
    this.transfer(source, this.account(p.id), amount, reason, p.id);
    if (amount) this.checkCap(p);
    return amount;
  }
  ensurePlayer(id: string, name: string) {
    const existing = this.state.players[id];
    if (existing) return existing;
    if (Object.keys(this.state.players).length >= EVENT_RULES.maxPlayers)
      throw new Error(
        `All ${EVENT_RULES.maxPlayers} operator places have been assigned.`,
      );
    if (this.state.phase !== "lobby" && this.minute() >= EVENT_RULES.lateJoin)
      throw new Error("Late registration has closed.");
    const used = new Set(
      Object.values(this.state.players).map((p) => p.homeId),
    );
    // The plot list is grouped in ward order (A 0-14, B 15-29, C 30-44, ...),
    // so taking the first free plot already clusters arrivals into A, then B,
    // then C. Wards D-F used to be excluded outright, which capped Homes at the
    // 45 plots in A-C: fine while maxPlayers was 40, but it would have refused
    // the 46th operator at 60 with a message claiming all 90 were taken. The
    // ordering gives the clustering, so later wards simply open as needed.
    const plot = this.map.homePlots?.find((h) => !used.has(h.id));
    if (!plot)
      throw new Error(
        `All ${this.map.homePlots?.length ?? 0} Home addresses have been assigned.`,
      );
    return this.transaction(() => {
      const p: Player = {
        id,
        name,
        homeId: plot.id,
        completed: [],
        training: [],
        starter: false,
        waves: [],
        capped: false,
        bountyPosted: false,
        bounty: false,
        jail: 0,
        checkedOut: false,
        checkingOut: false,
        payout: 0,
        offlineAt: 0,
        transitDue: 0,
        homeCooldown: 0,
        thiefCooldown: {},
        messages: [],
        reachedAt: this.clock(),
      };
      this.state.players[id] = p;
      for (const kind of ["HOME", "BANK", "TRANSIT"])
        this.state.accounts[this.account(id, kind)] = 0;
      this.message(
        p,
        `Your safehouse is ${plot.address}. Earn at Tech Quarter, Data Harbor or Black Grid. Bank your balance when deposits open.`,
      );
      return p;
    });
  }
  setOnline(id: string, online: boolean, disconnectedAt = this.clock()) {
    if (this.closed) return;
    const p = this.state.players[id];
    if (!p) return;
    const offlineAt = online ? 0 : disconnectedAt;
    if (p.offlineAt === offlineAt && (online || !p.insideHome)) return;
    // Presence cannot change money. One bound, atomic, FULL-durability SQLite
    // update avoids cloning/serializing every challenge during a reconnect storm.
    // Change memory only after the database commit succeeds.
    const patch = { offlineAt, ...(!online ? { insideHome: false } : {}) };
    const result = this.presenceUpdate.run(
      JSON.stringify({ players: { [id]: patch } }),
    );
    if (result.changes !== 1) throw new Error("Presence state unavailable");
    p.offlineAt = offlineAt;
    if (!online) p.insideHome = false;
  }
  /**
   * The clock the schedule and the client both read. While the organizer has
   * paused the event this is pinned to the instant of the pause, so countdowns
   * in the browser freeze in step with the server rather than drifting apart.
   */
  /**
   * The player-facing reason a paid contract cannot be claimed right now.
   * Mirrors the `available` rule in the job view, checked in the same order,
   * so the explanation can never disagree with the decision.
   */
  private jobLockedReason(t: { id: string; tier: string }, p: Player): string {
    if (this.state.phase === "lobby")
      return "Unlocks when the organizer starts the event. Explore the city until then.";
    if (this.state.phase !== "live")
      return "Paid contracts are closed because the event is not running.";
    if (p.capped)
      return "You have reached the wealth cap, so paid contracts are paused for you. They unlock again if your total wealth drops below the reactivation level.";
    if (t.tier === "ST")
      return "You have used your one Starter contract. Standard and Expert contracts are your next paid work.";
    const ready = this.claimReadyAt(p);
    if (ready > this.gameNow()) {
      const s = Math.ceil((ready - this.gameNow()) / 1000);
      return `Cooldown between paid contracts. Your next claim unlocks in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}.`;
    }
    const now = this.minute();
    const unclaimed = this.state.slots.filter(
      (s) => s.template === t.id && !s.claimed,
    );
    if (t.tier === "SD") {
      const usedWave = unclaimed.some(
        (s) => s.openMinute <= now && s.wave !== 0 && p.waves.includes(s.wave),
      );
      // The next wave this operator has not used yet, across all templates.
      const nextWave = this.state.slots
        .filter((s) => s.wave !== 0 && s.openMinute > now && !p.waves.includes(s.wave))
        .reduce((m, s) => Math.min(m, s.openMinute), Infinity);
      if (usedWave)
        return Number.isFinite(nextWave)
          ? `One Standard contract per wave, and you have taken this wave's. The next wave unlocks ${this.whenMinute(nextWave)} with new contracts.`
          : "One Standard contract per wave, and you have taken this wave's. That was the final wave; Expert contracts and events are still open.";
    }
    const next = unclaimed
      .filter((s) => s.openMinute > now)
      .reduce((m, s) => Math.min(m, s.openMinute), Infinity);
    if (Number.isFinite(next))
      return `Not released yet. Unlocks ${this.whenMinute(next)}.`;
    return "Every paid slot for this contract was claimed by other operators. It will not reopen; pick another contract.";
  }

  /**
   * "in about N min (when the clock reads H:MM:SS)" for an event minute.
   * The HUD clock counts down the real event duration, so the reading is the
   * remaining time at that minute, which players can watch for directly.
   */
  private whenMinute(minute: number): string {
    const now = this.minute();
    const msUntil = ((minute - now) / 180) * this.state.duration;
    const mins = Math.max(1, Math.ceil(msUntil / 60000));
    const remaining = Math.max(0, Math.round((this.state.duration * (1 - minute / 180)) / 1000));
    const h = Math.floor(remaining / 3600),
      m = Math.floor((remaining % 3600) / 60),
      s = remaining % 60;
    const clock = `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `in about ${mins} min (when the clock reads ${clock})`;
  }

  /** When this operator may next claim a paid Standard/Expert contract. */
  private claimReadyAt(p: Player) {
    return EVENT_RULES.claimCooldown && p.lastPaidClaim
      ? p.lastPaidClaim + EVENT_RULES.claimCooldown
      : 0;
  }

  /**
   * Organizer control: release every remaining Standard and Expert slot now.
   * The slots, prizes and pools are unchanged, so the Rs 4,000 plan is too;
   * only the release minute moves forward. Returns how many were released.
   */
  adminUnlockAll() {
    if (this.state.phase !== "live")
      throw new Error("Contracts can only be unlocked while the event is live.");
    return this.transaction(() => {
      const now = Math.floor(this.minute());
      let released = 0;
      for (const s of this.state.slots)
        if (!s.claimed && s.openMinute > now) {
          s.openMinute = now;
          released++;
        }
      this.notice(
        `NEXUS // Every contract is now unlocked. ${released} paid slots just opened${EVENT_RULES.claimCooldown ? `; there is a ${Math.round(EVENT_RULES.claimCooldown / 60000)}-minute cooldown between paid claims` : ""}. One Standard contract per wave still applies.`,
      );
      return released;
    });
  }

  private gameNow() {
    return this.state.pausedAt || this.clock();
  }
  paused() {
    return !!this.state.pausedAt;
  }
  minute() {
    return this.state.startedAt
      ? ((this.gameNow() - this.state.startedAt) / this.state.duration) * 180
      : 0;
  }
  private at(minute: number) {
    return this.state.startedAt + (minute / 180) * this.state.duration;
  }
  start() {
    if (this.state.phase !== "lobby")
      throw new Error("This event has already started.");
    this.transaction(() => {
      this.state.startedAt = this.clock();
      this.state.phase = "live";
      this.state.lastFeeMinute = 0;
      this.state.startSettings = { ...(this.state.settings || {}) };
      this.state.raidCrewSize =
        Object.keys(this.state.players).length < EVENT_RULES.smallRaidThreshold
          ? EVENT_RULES.smallRaidCrew
          : EVENT_RULES.raidCrew;
      const waveTimes = EVENT_RULES.waveTimes;
      for (let wave = 1; wave <= waveTimes.length; wave++)
        for (let i = 0; i < EVENT_RULES.standardSlots; i++)
          this.state.slots.push({
            id: `wave-${wave}-${i}`,
            template:
              EVENT_RULES.waveTemplates[wave - 1][
                Math.floor(
                  (i * EVENT_RULES.waveTemplates[wave - 1].length) /
                    EVENT_RULES.standardSlots,
                )
              ],
            wave,
            openMinute: waveTimes[wave - 1],
            claimed: "",
            holder: "",
            expires: 0,
            queue: [],
            offerUntil: 0,
          });
      EVENT_RULES.expertTimes.forEach((minute, i) =>
        this.state.slots.push({
          id: `expert-${i + 1}`,
          template: EVENT_RULES.expertTemplates[i],
          wave: 0,
          openMinute: minute,
          claimed: "",
          holder: "",
          expires: 0,
          queue: [],
          offerUntil: 0,
        }),
      );
      EVENT_RULES.raceTimes.forEach((m, i) =>
        this.state.contests.push({
          id: `RC-0${i + 1}`,
          start: this.at(m),
          end: this.at(m) + EVENT_RULES.raceDuration,
          entrants: [],
          winners: [],
          paid: false,
        }),
      );
      EVENT_RULES.goldenTimes.forEach((m, i) =>
        this.state.contests.push({
          id: `GH-0${i + 1}`,
          start: this.at(m),
          end: this.at(m) + EVENT_RULES.eventDurations[i],
          entrants: [],
          winners: [],
          paid: false,
        }),
      );
      for (const p of Object.values(this.state.players))
        if (p.offlineAt) p.offlineAt = this.clock();
      this.notice(
        `THE GREAT RESET // All operators begin at ₹0. Wave 1 is live. Raid crews require ${this.state.raidCrewSize} operators this event.`,
      );
    });
  }
  announce(text: string) {
    if (!text.trim() || text.length > 300)
      throw new Error("Announcement must be 1–300 characters.");
    this.transaction(() => this.notice(text));
  }
  private activeRaid() {
    return this.state.raids.find((r) => r.start && !r.settled);
  }
  canMove(id: string) {
    const p = this.state.players[id];
    return (
      !p ||
      (!p.checkedOut &&
        !p.checkingOut &&
        !p.insideHome &&
        p.jail <= this.clock())
    );
  }
  canTravel(id: string) {
    return this.canMove(id) && !this.activeRaid()?.crew.includes(id);
  }
  private requireLive(p: Player) {
    if (this.state.phase !== "live")
      throw new Error(
        this.state.phase === "lobby"
          ? "The event has not started. Paid activities open after the Great Reset."
          : "The event is frozen. Balances are final.",
      );
    if (p.checkedOut || p.checkingOut) throw new Error("You have checked out.");
    if (p.jail > this.clock())
      throw new Error("You are in jail. Wait for release.");
  }
  private near(id: string, target: Position, radius = 3) {
    const pos = this.positionOf(id);
    return (
      !!pos &&
      sceneAt(this.map, pos.x, pos.y)?.id ===
        sceneAt(this.map, target.x, target.y)?.id &&
      Math.abs(pos.x - target.x) + Math.abs(pos.y - target.y) <= radius
    );
  }
  private terminal(id: string, action: string, template?: string) {
    const t = templates.find((t) => t.id === template);
    return this.map.hotspots.some(
      (h) =>
        h.action === action &&
        (!t || sceneAt(this.map, h.x, h.y)?.id === t.district) &&
        (!t || !t.station || h.id === t.station || h.id?.endsWith("-jobs")) &&
        this.near(id, h),
    );
  }
  private attempt(
    p: Player,
    template: string,
    mode: Attempt["mode"],
    expires: number,
    variant: string,
    extra: Partial<Attempt> = {},
  ) {
    const key = `${p.id}:${mode}:${variant}:${template}`;
    const old = this.state.attempts[key];
    if (old) {
      if (!old.solved && old.expires <= this.clock()) old.expires = expires;
      return old;
    }
    const attempt: Attempt = {
      key,
      player: p.id,
      template,
      mode,
      expires,
      variant,
      solved: false,
      lastAnswer: 0,
      wrong: 0,
      blockedUntil: 0,
      catalogueVersion: 2,
      openedAt: this.clock(),
      testRuns: 0,
      ...extra,
    };
    this.state.attempts[key] = attempt;
    return attempt;
  }
  private held(p: Player) {
    return Object.values(this.state.attempts).find(
      (a) =>
        a.player === p.id &&
        !a.solved &&
        a.expires > this.clock() &&
        ((a.mode === "job" && !!a.slot) ||
          a.mode === "burglary" ||
          (a.mode === "event" && a.template === "GH-02")),
    );
  }
  private releaseSlot(slot: Slot) {
    slot.holder = "";
    slot.expires = 0;
    slot.offerUntil = 0;
    while (slot.queue.length) {
      const next = slot.queue.shift()!;
      const p = this.state.players[next];
      if (!p || p.checkedOut || p.checkingOut || this.held(p)) continue;
      slot.holder = next;
      slot.offerUntil = this.clock() + EVENT_RULES.queueAccept;
      slot.expires = slot.offerUntil;
      this.message(
        p,
        `${slot.template} is ready. Accept the queue offer within 30 seconds from your journal.`,
      );
      break;
    }
  }
  releaseLock(id: string) {
    this.transaction(() => {
      const s = this.state.slots.find((s) => s.id === id);
      if (!s || s.claimed) throw new Error("No active lock");
      for (const a of Object.values(this.state.attempts))
        if (a.slot === s.id && !a.solved) a.expires = this.clock();
      this.releaseSlot(s);
      this.notice(`NEXUS released a stuck lock: ${id}`);
    });
  }
  action(
    id: string,
    request: EventRequest,
  ): { type: "game_result"; message: string } {
    if (this.state.pausedAt && request.action !== "sync")
      throw new Error(
        "The organizer has paused the event. Nothing is lost - your contracts, holds and timers are frozen and resume exactly where they stopped.",
      );
    try {
      const result = this.dispatchAction(id, request);
      if (request.action !== "sync")
        this.logRequest(
          id,
          request,
          result.message.startsWith("Already")
            ? "already_resolved"
            : result.message.startsWith("Answer rejected") ||
                result.message.startsWith("Incorrect")
              ? "incorrect"
              : "accepted",
          result.message,
        );
      return result;
    } catch (error) {
      this.logRequest(
        id,
        request,
        "denied",
        error instanceof Error ? error.message : "Action denied",
      );
      throw error;
    }
  }
  private logRequest(
    id: string,
    request: EventRequest,
    outcome: string,
    message: string,
  ) {
    this.db
      .prepare(
        "INSERT INTO event_requests(time,player,action,challenge,outcome,message) VALUES(?,?,?,?,?,?)",
      )
      .run(
        this.clock(),
        id,
        String(request.action).slice(0, 40),
        String(request.id || "").slice(0, 200),
        outcome,
        message.slice(0, 300),
      );
  }
  private dispatchAction(
    id: string,
    request: EventRequest,
  ): { type: "game_result"; message: string } {
    const p = this.state.players[id];
    if (!p) throw new Error("Operator not enrolled");
    if (request.action === "sync") return { type: "game_result", message: "" };
    if (request.action === "probe")
      return this.transaction(() => ({
        type: "game_result",
        message: this.probe(p, request.id || "", request.input || ""),
      }));
    if (request.action === "answer")
      return this.transaction(() => ({
        type: "game_result",
        message: this.submit(p, request.id || "", request.answer || ""),
      }));
    return this.transaction(() => {
      let message = "";
      const now = this.clock();
      this.chargeBankFees(now);
      if (request.action === "job") {
        if (request.training) throw new Error('Player training is disabled. Accept an available paid contract instead.');
        this.requireLive(p);
        const t = templates.find((t) => t.id === request.id);
        if (!t || !["ST", "SD", "EX"].includes(t.tier))
          throw new Error("Invalid job");
        if (!this.terminal(id, "jobs", t.id))
          throw new Error("Walk to a job terminal in the correct district.");
        {
          this.requireLive(p);
          if (p.capped)
            throw new Error(
              "CAPPED operators cannot claim paid jobs.",
            );
          if (this.held(p))
            throw new Error("Finish or release your current lock first.");
          if (t.tier === "ST") {
            if (p.starter) throw new Error("Your Starter claim has been used.");
            this.attempt(p, t.id, "job", this.at(180), "starter");
          } else {
            const ready = this.claimReadyAt(p);
            if (ready > now)
              throw new Error(
                `Cooldown between paid contracts: your next claim unlocks in ${Math.ceil((ready - now) / 1000)} s.`,
              );
            const slots = this.state.slots.filter(
              (s) =>
                s.template === t.id &&
                !s.claimed &&
                s.openMinute <= this.minute() &&
                (s.wave === 0 || !p.waves.includes(s.wave)),
            );
            let s = slots.find((s) => !s.holder || s.holder === id) || slots[0];
            if (!s)
              throw new Error(
                "No eligible paid slot remains. Check another contract or wait for its release.",
              );
            if (s.holder && s.holder !== id) {
              if (s.queue.includes(id))
                throw new Error("You are already queued.");
              if (
                this.state.slots.filter((s) => s.queue.includes(id)).length >=
                EVENT_RULES.queueLimit
              )
                throw new Error("Maximum two queues.");
              s.queue.push(id);
              message = `Queued for ${t.id}. Place ${s.queue.length}.`;
            } else {
              s.holder = id;
              s.offerUntil = 0;
              p.lastPaidClaim = now;
              s.expires =
                now +
                (t.tier === "EX"
                  ? EVENT_RULES.expertLock
                  : EVENT_RULES.standardLock);
              this.attempt(p, t.id, "job", s.expires, s.id, { slot: s.id });
            }
          }
          if (!message)
            message =
              "Contract accepted. Your variant is ready in the journal.";
        }
      } else if (request.action === "accept_queue") {
        this.requireLive(p);
        const s = this.state.slots.find((s) => s.id === request.id);
        if (!s || s.holder !== id || !s.offerUntil || s.offerUntil < now)
          throw new Error("Queue offer expired");
        if (this.held(p)) throw new Error("You already hold a lock");
        s.offerUntil = 0;
        p.lastPaidClaim = now;
        s.expires =
          now + (s.wave ? EVENT_RULES.standardLock : EVENT_RULES.expertLock);
        this.attempt(p, s.template, "job", s.expires, s.id, { slot: s.id });
        message = "Queue offer accepted.";
      } else if (request.action === "abandon") {
        const a = this.state.attempts[request.id || ""];
        if (!a || a.player !== id) throw new Error("No matching contract");
        a.expires = now;
        if (a.slot) {
          const s = this.state.slots.find((s) => s.id === a.slot);
          if (s?.holder === id) this.releaseSlot(s);
        }
        if (a.target) delete this.state.homeLocks[a.target];
        if (a.mode === "burglary") this.failBurglary(p, a);
        message = "Contract released.";
      } else if (
        request.action === "enter_home" ||
        request.action === "leave_home"
      ) {
        if (p.checkedOut || p.jail > now)
          throw new Error("Safehouse unavailable");
        if (request.action === "enter_home") {
          const home = this.map.homePlots?.find((h) => h.id === p.homeId);
          if (!home || !this.near(id, home))
            throw new Error("Walk to your own Home.");
          p.insideHome = true;
          message =
            "Inside your safehouse. Your Home is protected unless you are CAPPED.";
        } else {
          p.insideHome = false;
          message = "You left your safehouse.";
        }
      } else if (
        request.action === "deposit" ||
        request.action === "withdraw"
      ) {
        this.requireLive(p);
        if (!this.terminal(id, "bank"))
          throw new Error("Use the Central Bank terminal.");
        if (this.activeRaid())
          throw new Error("The Bank is locked during the raid.");
        const amount = request.amount;
        if (!Number.isSafeInteger(amount) || !amount || amount <= 0)
          throw new Error("Enter a positive amount in whole paise.");
        if (request.action === "deposit") {
          if (this.minute() < EVENT_RULES.bankOpen)
            throw new Error("Deposits open at minute 10.");
          if (
            this.balance(id, "BANK") + this.balance(id, "TRANSIT") + amount >
            EVENT_RULES.bankMax
          )
            throw new Error(
              "Bank limit is ₹200 including withdrawals in transit.",
            );
          this.transfer(
            this.account(id),
            this.account(id, "BANK"),
            amount,
            "Bank deposit",
            id,
          );
          message = "Deposit settled. Your funds are protected from burglary.";
        } else {
          if (p.transitDue)
            throw new Error("A withdrawal is already in transit.");
          this.transfer(
            this.account(id, "BANK"),
            this.account(id, "TRANSIT"),
            amount,
            "Withdrawal requested",
            id,
          );
          p.transitDue = now + EVENT_RULES.withdrawal;
          message = "Withdrawal is in transit. Arrival in five minutes.";
        }
      } else if (request.action === "burglary") {
        this.requireLive(p);
        if (
          this.minute() < EVENT_RULES.burglaryOpen ||
          this.minute() >= EVENT_RULES.burglaryClose
        )
          throw new Error("Burglary opens at minute 40 and closes at 175.");
        if (this.held(p)) throw new Error("You already hold a challenge lock");
        if (p.capped) throw new Error("CAPPED operators cannot steal.");
        const target = Object.values(this.state.players).find(
          (t) => t.homeId === request.id,
        );
        if (
          !target ||
          target.id === id ||
          target.checkedOut ||
          target.checkingOut
        )
          throw new Error("Choose another active operator’s Home.");
        const plot = this.map.homePlots?.find((h) => h.id === target.homeId);
        if (!plot || !this.near(id, plot))
          throw new Error("Walk to the target Home.");
        const level = request.level || 1;
        if (
          ![1, 2, 3].includes(level) ||
          (level === 2 && p.completed.length < 5) ||
          (level === 3 && p.completed.length < 12)
        )
          throw new Error(
            "This burglary level requires more completed challenges.",
          );
        if (target.offlineAt)
          throw new Error("The Home is protected while its owner is offline.");
        if ((p.thiefCooldown[target.id] || 0) > now)
          throw new Error("Your 30-minute target cooldown is active.");
        if (
          !target.capped &&
          (this.balance(target.id) < EVENT_RULES.homeMinimum ||
            target.homeCooldown > now ||
            target.insideHome)
        )
          throw new Error("This Home is protected or has less than ₹20.");
        if (this.state.homeLocks[target.id])
          throw new Error("Another thief has locked this Home.");
        const a = this.attempt(
          p,
          `BG-0${level}`,
          "burglary",
          now + EVENT_RULES.burglaryLevels[level - 1].duration,
          `${target.id}:${now}`,
          { target: target.id, level },
        );
        this.state.homeLocks[target.id] = a.key;
        p.thiefCooldown[target.id] = now + EVENT_RULES.thiefCooldown;
        message =
          "Lock-pick started. Failure means a ₹3 fee and three minutes in jail.";
      } else if (request.action === "raid_join") {
        this.requireLive(p);
        if (!this.terminal(id, "raid"))
          throw new Error("Stand in the Bank raid circle.");
        const window = this.raidWindow();
        if (!window) throw new Error("No raid window is accepting a crew.");
        if (this.activeRaid()) throw new Error("A raid is already running.");
        if (p.completed.length < 5)
          throw new Error("Complete five challenges to join.");
        if (
          this.state.raids.some(
            (r) =>
              r.window === window - 1 && r.start > 0 && r.crew.includes(id),
          )
        )
          throw new Error(
            "Members of the previous raid cannot join this window.",
          );
        let r = this.state.raids.find((r) => r.window === window);
        if (!r) {
          r = {
            window,
            start: 0,
            end: 0,
            crew: [],
            stand: {},
            sources: [],
            solved: {},
            finished: {},
            templates: {},
            settled: false,
          };
          this.state.raids.push(r);
        }
        if (r.start || r.settled)
          throw new Error("This window’s raid has already been used.");
        r.stand[id] = r.stand[id] || now;
        message =
          "Hold the circle for 60 seconds. Leaving resets your qualification.";
      } else if (request.action === "race_enter") {
        this.requireLive(p);
        if (!this.terminal(id, "race"))
          throw new Error("Use the Race terminal.");
        const c = this.state.contests.find(
          (c) => c.id === request.id && c.id.startsWith("RC"),
        );
        if (!c || now < c.start - EVENT_RULES.raceNotice || now >= c.end)
          throw new Error("Race entry is closed");
        if (!c.entrants.includes(id)) c.entrants.push(id);
        this.attempt(p, c.id, "race", c.end, c.id);
        message =
          now < c.start
            ? "Entered. Your challenge unlocks at race start."
            : "Race challenge loaded. Time is running.";
      } else if (request.action === "event_enter") {
        this.requireLive(p);
        const c = this.state.contests.find((c) => c.id === request.id);
        if (!c || !c.id.startsWith("GH") || now < c.start || now >= c.end)
          throw new Error("Golden Hour is not active.");
        if (c.winners.includes(id))
          throw new Error("One Golden Hour claim per operator.");
        let variant = c.id;
        if (c.id === "GH-01") {
          const card = this.markers().find(
            (m) =>
              m.id.startsWith("card-") &&
              !this.state.cardClaims[m.id] &&
              this.near(id, m, 1),
          );
          if (!card)
            throw new Error("Find a hidden keycard and stand next to it.");
          variant = card.id;
        }
        if (c.id === "GH-02") {
          if (this.held(p))
            throw new Error("Release your current challenge lock first.");
          const courier = this.markers().find((m) => m.id === "courier");
          if (!courier || !this.near(id, courier, 1))
            throw new Error("Stand next to the moving courier.");
          if (
            this.state.courierHolder &&
            this.state.courierHolder !== id &&
            this.state.courierUntil > now
          )
            throw new Error("The courier’s challenge is locked.");
          this.state.courierHolder = id;
          this.state.courierUntil =
            now + EVENT_RULES.eventChallengeDurations[1];
        }
        if (
          c.id === "GH-03" &&
          !this.map.hotspots.some((h) => h.id === "golden" && this.near(id, h))
        )
          throw new Error("Walk to the Golden Hour or Event Terminal.");
        this.attempt(
          p,
          c.id,
          "event",
          Math.min(
            c.end,
            c.id === "GH-02"
              ? this.state.courierUntil
              : now +
                  EVENT_RULES.eventChallengeDurations[c.id === "GH-01" ? 0 : 2],
          ),
          variant,
        );
        message = "Golden Hour challenge acquired.";
      } else if (request.action === "checkout") {
        this.requireLive(p);
        if (this.minute() < EVENT_RULES.checkoutOpen)
          throw new Error("Voluntary Checkout opens at minute 150.");
        if (!request.confirm) throw new Error("Confirm permanent Checkout.");
        if (!this.terminal(id, "checkout"))
          throw new Error("Use the Checkout terminal.");
        if (this.activeRaid()?.crew.includes(id))
          throw new Error("Finish the raid before Checkout.");
        p.checkingOut = true;
        this.cancelPlayer(p);
        if (!p.transitDue) this.checkout(p);
        message = p.checkedOut
          ? "Checkout complete. Your final balance is recorded."
          : "Checkout requested. Waiting for your withdrawal to arrive.";
      } else throw new Error("Unknown game action");
      return { type: "game_result", message };
    });
  }
  private availableAt(a: Attempt) {
    return a.mode === "race"
      ? Math.max(
          a.openedAt || 0,
          this.state.contests.find((c) => c.id === a.template)?.start || 0,
        )
      : a.openedAt || 0;
  }
  private challenge(a: Attempt): ReturnType<typeof generateChallenge> {
    if (a.catalogueVersion === 2)
      return generateChallenge(
        this.state.secret,
        a.player,
        a.template,
        a.variant,
      );
    const legacy = generateLegacyChallenge(
      this.state.secret,
      a.mode === "race" || a.template === "GH-03" ? "COMMON" : a.player,
      a.template,
      a.variant,
    );
    return {
      ...legacy,
      client: "Legacy rehearsal",
      objective: "Submit the result from your original contract.",
      difficulty: 1,
      workbench: { kind: "code" as const },
      brief: {
        scenario: legacy.prompt,
        task: "Submit the result from your original contract.",
        answerFormat:
          "The same result your original contract asked for. Capitals and extra spaces are forgiven.",
      },
      validate: (input) => validAnswer(input, legacy.answer),
    };
  }
  private presentation(a: Attempt) {
    const key = JSON.stringify([
      a.catalogueVersion,
      a.player,
      a.template,
      a.variant,
      a.mode,
    ]);
    let value = this.presentations.get(key);
    if (!value) {
      const model = this.challenge(a);
      value = {
        prompt: model.prompt,
        client: model.client,
        objective: model.objective,
        difficulty: model.difficulty,
        workbench: model.workbench,
        brief: model.brief,
      };
      if (this.presentations.size >= 512)
        this.presentations.delete(this.presentations.keys().next().value!);
      this.presentations.set(key, value);
    }
    // A caller may mutate its view; it cannot corrupt the next operator's puzzle.
    return { ...value, workbench: structuredClone(value.workbench) };
  }
  private probe(p: Player, key: string, input: string) {
    const a = this.state.attempts[key];
    if (
      !a ||
      a.player !== p.id ||
      a.mode === 'training' ||
      a.solved ||
      a.expires <= this.clock() ||
      p.checkedOut ||
      p.checkingOut ||
      p.jail > this.clock() ||
      this.state.phase === "frozen"
    )
      throw new Error("Workbench is unavailable.");
    if (a.blockedUntil > this.clock())
      throw new Error("Answer cooldown is active.");
    const c = this.challenge(a);
    if (!("workbench" in c))
      throw new Error("Legacy contract has no interactive workbench.");
    if (c.runFixes) {
      a.feedback = c.runFixes(input);
      return `SIMULATION OUTPUT\n${a.feedback}`;
    }
    if (c.workbench.kind === "machine") {
      if ((a.testRuns || 0) >= 5)
        throw new Error("All five machine test runs have been used.");
      const n = Number(input);
      if (!input.trim() || !Number.isFinite(n) || Math.abs(n) > 1e9)
        throw new Error("Enter a finite number within ±1,000,000,000.");
      const result = (c.workbench.steps || []).reduce(
        (v, s) => (v * s.multiply + s.add) / s.divide,
        n,
      );
      a.testRuns = (a.testRuns || 0) + 1;
      a.feedback = `Run ${a.testRuns}/5: ${n} → ${result}`;
      return a.feedback;
    }
    throw new Error("This workbench does not accept a simulation request.");
  }
  private chargeBankFees(now: number) {
    if (this.state.phase !== "live" || now < this.at(EVENT_RULES.bankOpen))
      return;
    const due = Math.max(
      0,
      Math.floor((now - this.at(EVENT_RULES.bankOpen)) / MINUTE),
    );
    let last = this.state.lastFeeMinute || 0;
    while (last < due) {
      for (const p of Object.values(this.state.players)) {
        if (p.checkedOut) continue;
        const balance = this.balance(p.id, "BANK"),
          fee = Math.min(
            balance,
            Math.floor(
              (balance * EVENT_RULES.bankFeeNumerator +
                EVENT_RULES.bankFeeDenominator / 2) /
                EVENT_RULES.bankFeeDenominator,
            ),
          );
        this.transfer(
          this.account(p.id, "BANK"),
          "BANK_FEE_VAULT",
          fee,
          "Bank holding fee",
          p.id,
        );
        p.lastBankFee = fee;
        if (fee)
          p.reachedAt = this.at(EVENT_RULES.bankOpen) + (last + 1) * MINUTE;
      }
      last++;
    }
    this.state.lastFeeMinute = due;
  }
  private failBurglary(p: Player, a: Attempt) {
    const fee = Math.min(EVENT_RULES.burglaryFee, this.balance(p.id));
    this.transfer(this.account(p.id), "TREASURY", fee, "Failed burglary", p.id);
    p.jail = this.clock() + EVENT_RULES.jail;
    a.expires = this.clock();
    if (a.target) delete this.state.homeLocks[a.target];
    this.message(p, "Lock-pick failed. Three minutes in custody.");
  }
  private submit(p: Player, key: string, answer: string) {
    const a = this.state.attempts[key],
      now = this.clock();
    if (!a || a.player !== p.id) throw new Error("Contract not found");
    if (a.mode === 'training') throw new Error('Player training is disabled.');
    if (
      p.checkedOut ||
      p.checkingOut ||
      p.jail > now ||
      this.state.phase === "frozen"
    )
      throw new Error("Submissions are closed.");
    if (a.solved) return "Already resolved. No duplicate payment.";
    if (a.expires <= now) throw new Error("Challenge expired.");
    this.requireLive(p);
    if (
      a.catalogueVersion === 2 &&
      now - this.availableAt(a) < EVENT_RULES.minimumSolveMs
    )
      throw new Error(
        "Read the briefing first. Minimum solve time is five seconds.",
      );
    if (a.mode === "race") {
      const c = this.state.contests.find((c) => c.id === a.template)!;
      if (now < c.start) throw new Error("Wait for the race start.");
    }
    if (
      a.blockedUntil > now ||
      (a.lastAnswer && now - a.lastAnswer < EVENT_RULES.answerInterval)
    )
      throw new Error("Answer cooldown is active.");
    a.lastAnswer = now;
    const model = this.challenge(a);
    if (model.oracle) {
      if (
        a.template === "BG-01" &&
        (!/^\d{3}$/.test(answer) || new Set(answer).size !== 3)
      )
        throw new Error(
          "Enter exactly three different digits; a leading zero is allowed.",
        );
      if (
        a.template === "GH-02" &&
        (!/^\d+$/.test(answer) || Number(answer) < 1 || Number(answer) > 100)
      )
        throw new Error("Enter a whole number from 1 to 100.");
    }
    const correct = model.validate(answer);
    this.db
      .prepare(
        "INSERT INTO event_answers(time,player,challenge,accepted) VALUES(?,?,?,?)",
      )
      .run(now, p.id, a.key, correct ? 1 : 0);
    if (!correct) {
      a.wrong++;
      const oracle = "oracle" in model && !!model.oracle;
      if (oracle) {
        a.feedback = model.oracle!(answer);
        const limit = model.workbench.maxGuesses || 8;
        if (a.wrong < limit) return `Guess ${a.wrong}/${limit}: ${a.feedback}`;
      }
      if (!oracle && a.wrong % EVENT_RULES.wrongLimit === 0)
        a.blockedUntil = now + EVENT_RULES.wrongWait;
      if (a.mode === "burglary") {
        this.failBurglary(p, a);
        return "Incorrect lock-pick. ₹3 maximum fee; three minutes in jail.";
      }
      if (a.template === "GH-02") {
        a.expires = now;
        this.state.courierHolder = "";
        return "Eight guesses used. The courier lock is released for the next operator.";
      }
      return a.blockedUntil > now
        ? "Three incorrect answers. Wait 60 seconds."
        : "Answer rejected. Recheck the evidence and try again.";
    }
    let paid = 0;
    if (a.mode === "job") {
      const t = templates.find((t) => t.id === a.template)!;
      if (t.tier === "ST") {
        if (p.starter) throw new Error("Starter already claimed");
        p.starter = true;
      } else {
        const s = this.state.slots.find((s) => s.id === a.slot);
        if (!s || s.claimed || s.holder !== p.id || s.offerUntil)
          throw new Error("Already resolved");
        if (s.wave && p.waves.includes(s.wave))
          throw new Error("You already claimed this wave");
        s.claimed = p.id;
        s.holder = "";
        s.queue = [];
        if (s.wave) p.waves.push(s.wave);
      }
      paid = this.reward(
        p,
        `POOL_${t.tier === "ST" ? "STARTER" : t.tier === "SD" ? "STANDARD" : "EXPERT"}`,
        t.reward,
        `Job ${a.template} ${a.variant}`,
      );
      p.completed.push(a.key);
    }
    if (a.mode === "burglary") {
      const target = this.state.players[a.target!];
      if (!target || this.state.homeLocks[target.id] !== a.key)
        throw new Error("Home lock expired");
      if (target.offlineAt || target.checkedOut)
        throw new Error("The Home is now protected");
      const level = a.level!,
        shares = EVENT_RULES.burglaryLevels.map((l) => l.share),
        max = EVENT_RULES.burglaryLevels.map((l) => l.max);
      const amount = Math.max(
        0,
        Math.min(
          Math.floor((this.balance(target.id) * shares[level - 1]) / 100),
          max[level - 1],
          this.balance(target.id) - (target.capped ? 0 : EVENT_RULES.homeFloor),
        ),
      );
      paid = this.reward(
        p,
        this.account(target.id),
        amount,
        `Burglary level ${level}`,
      );
      if (paid) {
        target.homeCooldown = now + EVENT_RULES.homeCooldown;
        this.message(
          target,
          `${p.name} stole ₹${(paid / 100).toFixed(2)} from your Home at ${new Date(now).toISOString()}.`,
        );
        if (target.bounty) {
          const bounty = this.reward(
            p,
            "TREASURY",
            EVENT_RULES.bounty,
            `Cap bounty on ${target.name}`,
          );
          if (bounty) target.bounty = false;
          paid += bounty;
        }
        this.checkCap(target);
      }
      delete this.state.homeLocks[target.id];
      p.completed.push(a.key);
    }
    if (a.mode === "race" || a.mode === "event") {
      const c = this.state.contests.find((c) => c.id === a.template)!;
      if (c.winners.includes(p.id)) throw new Error("Already resolved");
      if (a.template === "GH-01") {
        if (this.state.cardClaims[a.variant])
          throw new Error("This card was already recovered");
        this.state.cardClaims[a.variant] = p.id;
      }
      if (a.template === "GH-02" && this.state.courierHolder !== p.id)
        throw new Error("Courier lock expired");
      c.winners.push(p.id);
      const rewards =
        a.mode === "race"
          ? EVENT_RULES.raceRewards
          : EVENT_RULES.eventRewards[
              a.template === "GH-01" ? 0 : a.template === "GH-02" ? 1 : 2
            ];
      paid = this.reward(
        p,
        a.mode === "race" ? "POOL_RACE" : "POOL_EVENT",
        rewards[c.winners.length - 1] || 0,
        `${a.template} place ${c.winners.length}`,
      );
      p.completed.push(a.key);
      this.notice(
        `${p.name} cleared ${a.template} in position ${c.winners.length}.`,
      );
      if (a.template === "GH-02") this.state.courierHolder = "";
    }
    if (a.mode === "raid") {
      const r = this.activeRaid();
      if (!r || !r.crew.includes(p.id)) throw new Error("Raid ended");
      r.solved[p.id] = (r.solved[p.id] || 0) + 1;
      r.finished[p.id] = now;
      p.completed.push(a.key);
    }
    a.solved = true;
    this.message(
      p,
      paid
        ? `${a.template} cleared. ₹${(paid / 100).toFixed(2)} moved to your Home.`
        : `${a.template} cleared.`,
    );
    const result = paid
      ? `Correct. ₹${(paid / 100).toFixed(2)} credited to Home.`
      : "Correct. Your completion is recorded.";
    if (model.success) this.message(p, model.success);
    return model.success ? `${result}\n${model.success}` : result;
  }
  private raidWindow() {
    const m = this.minute();
    return (
      EVENT_RULES.raidWindows.findIndex(
        (w) => m >= w.open && m < w.close && m <= w.crewDeadline,
      ) + 1
    );
  }
  private seed(window: number) {
    return window === 3 ? "BANK_SEED_FINAL" : `BANK_SEED_${window}`;
  }
  private beginRaid(r: Raid) {
    r.start = this.clock();
    r.end = r.start + EVENT_RULES.raidDuration;
    const deposits = Object.values(this.state.players)
      .flatMap((p) =>
        ["BANK", "TRANSIT"].map((kind) => ({
          account: this.account(p.id, kind),
          balance: this.balance(p.id, kind),
          amount: Math.floor(
            (this.balance(p.id, kind) * EVENT_RULES.raidDepositPercent) / 100,
          ),
        })),
      )
      .filter((s) => s.balance > 0);
    // Round the total 10% share down once; allocate the remaining whole paise by fractional remainder.
    let remainder =
      Math.floor(
        (deposits.reduce((sum, s) => sum + s.balance, 0) *
          EVENT_RULES.raidDepositPercent) /
          100,
      ) - deposits.reduce((sum, s) => sum + s.amount, 0);
    deposits.sort(
      (a, b) =>
        (b.balance % 10) - (a.balance % 10) ||
        a.account.localeCompare(b.account),
    );
    for (const source of deposits)
      if (remainder > 0) {
        source.amount++;
        remainder--;
      }
    r.sources = deposits
      .filter((s) => s.amount > 0)
      .map(({ account, amount }) => ({ account, amount }));
    if (this.state.accounts.BANK_FEE_VAULT)
      r.sources.push({
        account: "BANK_FEE_VAULT",
        amount: this.state.accounts.BANK_FEE_VAULT,
      });
    for (const id of r.crew) {
      const p = this.state.players[id];
      const shuffled = templates
        .filter((t) => t.tier === (r.window === 3 ? "BL" : "BR"))
        .map((t) => ({
          t,
          rank: createHash("sha256")
            .update(`${this.state.secret}:${id}:${r.window}:${t.id}`)
            .digest("hex"),
        }))
        .sort((a, b) => a.rank.localeCompare(b.rank));
      r.templates[id] =
        r.window === 3
          ? shuffled.slice(0, EVENT_RULES.raidQuestions).map((x) => x.t.id)
          : [
              ...shuffled.filter((x) => x.t.raidTier === "A").slice(0, 2),
              ...shuffled.filter((x) => x.t.raidTier === "B").slice(0, 2),
              ...shuffled.filter((x) => x.t.raidTier === "C").slice(0, 1),
            ].map((x) => x.t.id);
      for (const template of r.templates[id])
        this.attempt(p, template, "raid", r.end, `raid-${r.window}`);
    }
    this.notice(
      `BANK LOCKDOWN // Crew of ${r.crew.length} assembled. ${r.window === 3 ? "Black Ledger" : "Raid"} has begun. Each operator must clear ${EVENT_RULES.raidGate} questions; ${Math.min(EVENT_RULES.raidPass, r.crew.length)} must pass.`,
    );
  }
  private settleRaid(r: Raid) {
    const winners = r.crew.filter(
      (id) => (r.solved[id] || 0) >= EVENT_RULES.raidGate,
    );
    r.settled = true;
    const needed = Math.min(EVENT_RULES.raidPass, r.crew.length);
    if (winners.length < needed) {
      this.notice(
        `Raid ${r.window} failed. Only ${winners.length} operators passed. No depositor lost money.`,
      );
      return;
    }
    const sources = [
      ...r.sources,
      {
        account: this.seed(r.window),
        amount: this.state.accounts[this.seed(r.window)],
      },
    ];
    const prize = sources.reduce((sum, s) => sum + s.amount, 0),
      n = winners.reduce((sum, id) => sum + r.solved[id], 0),
      v = Math.min(EVENT_RULES.raidQuestionMax, Math.floor(prize / n));
    winners.sort(
      (a, b) =>
        r.solved[b] - r.solved[a] ||
        (r.finished[a] || r.end) - (r.finished[b] || r.end) ||
        a.localeCompare(b),
    );
    let remainder = v === EVENT_RULES.raidQuestionMax ? 0 : prize - v * n;
    for (const id of winners) {
      const p = this.state.players[id];
      let pay = p.capped
        ? 0
        : Math.min(
            v * r.solved[id] + (id === winners[0] ? remainder : 0),
            EVENT_RULES.cap - this.wealth(id),
          );
      const actual = pay;
      for (const source of sources) {
        if (!pay) break;
        const take = Math.min(
          pay,
          source.amount,
          this.state.accounts[source.account],
        );
        this.transfer(
          source.account,
          this.account(id),
          take,
          `Raid ${r.window} payout`,
          id,
        );
        source.amount -= take;
        pay -= take;
      }
      if (pay) throw new Error("Raid source shortage");
      if (actual) this.checkCap(p);
      this.message(
        p,
        `Raid ${r.window} succeeded. Your share: ₹${(actual / 100).toFixed(2)}.`,
      );
    }
    this.notice(
      `Raid ${r.window} succeeded. ${winners.length} operators passed; ${n} questions cleared.`,
    );
  }
  private cancelPlayer(p: Player) {
    for (const a of Object.values(this.state.attempts))
      if (a.player === p.id && !a.solved) {
        a.expires = this.clock();
        if (a.target) delete this.state.homeLocks[a.target];
      }
    for (const s of this.state.slots) {
      s.queue = s.queue.filter((id) => id !== p.id);
      if (s.holder === p.id) this.releaseSlot(s);
    }
  }
  /**
   * Mark every enrolled operator without a live connection as offline.
   *
   * A reset re-enrols the whole roster, and presence otherwise only changes
   * when a socket opens or closes, so accounts that never reconnected stayed
   * "online" for the rest of the event. That inflated the organizer's online
   * count and left those Homes unprotected from burglary while their owners
   * were away.
   */
  reconcilePresence(isConnected: (id: string) => boolean) {
    for (const p of Object.values(this.state.players))
      if (!p.checkedOut && !p.offlineAt && !isConnected(p.id))
        this.setOnline(p.id, false);
  }
  markAllOffline() {
    this.transaction(() => {
      for (const p of Object.values(this.state.players)) {
        p.insideHome = false;
        if (!p.checkedOut && !p.offlineAt) p.offlineAt = this.clock();
      }
    });
  }
  private checkout(p: Player) {
    this.cancelPlayer(p);
    for (const kind of ["HOME", "BANK", "TRANSIT"]) {
      const amount = this.balance(p.id, kind);
      this.transfer(
        this.account(p.id, kind),
        "PAYOUT",
        amount,
        "Checkout",
        p.id,
      );
      p.payout += amount;
    }
    p.transitDue = 0;
    p.checkedOut = true;
    p.checkingOut = false;
    this.message(
      p,
      `Final score ₹${(p.payout / 100).toFixed(2)}. You can follow the leaderboard.`,
    );
  }
  freeze() {
    this.transaction(() => {
      this.state.phase = "frozen";
      for (const r of this.state.raids) r.settled = true;
      for (const p of Object.values(this.state.players)) {
        this.cancelPlayer(p);
        if (!p.checkedOut) this.checkout(p);
      }
      this.notice(
        "ZERO HOUR // The ledger is sealed. Final rankings are confirmed.",
      );
    });
  }
  /**
   * Pause the event. The schedule clock stops, the scheduler stops, and player
   * actions are refused with an explanatory message. Nothing expires meanwhile:
   * every stored deadline is shifted forward by the paused duration on resume,
   * so a hold with four minutes left still has four minutes left afterwards.
   *
   * Deliberately distinct from `freeze`, which is final settlement.
   */
  pause() {
    if (this.state.phase !== "live")
      throw new Error("Only a live event can be paused.");
    if (this.state.pausedAt) throw new Error("The event is already paused.");
    this.transaction(() => {
      this.state.pausedAt = this.clock();
      this.notice(
        "NEXUS // The organizer paused the event. All timers, holds and contracts are frozen.",
      );
    });
  }
  resume() {
    if (!this.state.pausedAt) throw new Error("The event is not paused.");
    this.transaction(() => {
      const delta = this.clock() - this.state.pausedAt!;
      this.shiftDeadlines(delta);
      this.state.startedAt += delta;
      this.state.pausedTotal = (this.state.pausedTotal || 0) + delta;
      this.state.pausedAt = 0;
      this.notice(
        `NEXUS // The event resumed after ${Math.round(delta / 1000)} seconds. Every timer continues from where it stopped.`,
      );
    });
  }
  /**
   * Move every absolute timestamp stored in the event forward by `delta`.
   *
   * These are enumerated explicitly rather than discovered by walking the JSON,
   * because a generic numeric walk cannot tell a timestamp from a money amount
   * or a tile coordinate, and shifting either of those would corrupt the event.
   * Any new timestamp field added to `State` must be added here too.
   */
  private shiftDeadlines(delta: number) {
    const move = (value: number) => (value ? value + delta : value);
    for (const p of Object.values(this.state.players)) {
      p.jail = move(p.jail);
      if (p.lastPaidClaim) p.lastPaidClaim = move(p.lastPaidClaim);
      p.transitDue = move(p.transitDue);
      p.homeCooldown = move(p.homeCooldown);
      p.offlineAt = move(p.offlineAt);
      p.reachedAt = move(p.reachedAt);
      if (p.lastBankFee) p.lastBankFee = move(p.lastBankFee);
      for (const key of Object.keys(p.thiefCooldown))
        p.thiefCooldown[key] = move(p.thiefCooldown[key]);
      for (const m of p.messages) m.at = move(m.at);
    }
    for (const a of Object.values(this.state.attempts)) {
      a.expires = move(a.expires);
      a.lastAnswer = move(a.lastAnswer);
      a.blockedUntil = move(a.blockedUntil);
      if (a.openedAt) a.openedAt = move(a.openedAt);
    }
    for (const slot of this.state.slots) {
      slot.expires = move(slot.expires);
      slot.offerUntil = move(slot.offerUntil);
    }
    for (const c of this.state.contests) {
      c.start = move(c.start);
      c.end = move(c.end);
    }
    for (const r of this.state.raids) {
      r.start = move(r.start);
      r.end = move(r.end);
      for (const key of Object.keys(r.stand)) r.stand[key] = move(r.stand[key]);
    }
    for (const n of this.state.notices) n.at = move(n.at);
    this.state.courierUntil = move(this.state.courierUntil);
  }
  /** Current editable settings plus their metadata, for the operator console. */
  settingsView() {
    return {
      ...describeSettings(this.state.settings || {}),
      started: !!this.state.startedAt,
      phase: this.state.phase,
      paused: this.paused(),
    };
  }
  /**
   * Validate and apply operator setting overrides.
   *
   * Before the event starts the derived prize pools are rewritten too, which is
   * safe only because no money has moved yet. That precondition is checked
   * against the ledger rather than inferred from the phase, so a partially
   * started event cannot slip through.
   */
  updateSettings(overrides: SettingsOverrides) {
    const started = !!this.state.startedAt;
    const plan = planSettings(overrides, {
      started,
      locked: this.state.startSettings ?? this.state.settings ?? {},
      crewSize: started ? this.state.raidCrewSize : undefined,
    });
    if (!started) {
      // Redefining the opening balances is not a transfer, so it deliberately
      // happens outside `transaction`: that wrapper asserts every account delta
      // is backed by a ledger row, which is exactly the protection we want for
      // real money movement and exactly the wrong shape for rebasing a plan
      // that has not paid out anything yet.
      //
      // The precondition is checked against the ledger itself rather than
      // inferred from the phase, so a partially started event cannot slip past.
      const moved = this.db
        .prepare("SELECT COUNT(*) AS n FROM event_ledger")
        .get() as { n: number };
      if (moved.n)
        throw new Error(
          "Money has already moved in this event, so the prize pools can no longer be rewritten. Reset the event first.",
        );
      const sum = Object.values(plan.pools).reduce((a, b) => a + b, 0);
      if (sum !== EVENT_RULES.total)
        throw new Error(
          `Refusing to install a plan worth ${sum} paise; the world must always hold exactly ${EVENT_RULES.total}.`,
        );
      this.state.initialPools = { ...plan.pools };
      this.state.accounts = { ...plan.pools };
      this.ledgerBalances = { ...plan.pools };
      this.save();
    }
    return this.transaction(() => {
      applySettings(plan.values);
      this.state.settings = { ...overrides };
      this.notice("NEXUS // The organizer updated the event settings.");
      return this.settingsView();
    });
  }
  /** Restore every documented default. */
  clearSettings() {
    return this.updateSettings({});
  }
  /**
   * Adjust one operator spendable balance, as a ledgered transfer to or from the
   * Treasury. Money is never created: a grant is possible only while the
   * Treasury can fund it, and a deduction returns the money to the Treasury.
   */
  adminAdjustMoney(playerId: string, paise: number, reason: string) {
    return this.transaction(() => {
      const p = this.state.players[playerId];
      if (!p) throw new Error("No such operator.");
      if (!Number.isSafeInteger(paise) || !paise)
        throw new Error("Enter a non-zero whole number of paise.");
      if (p.checkedOut)
        throw new Error("This operator checked out and their score is sealed.");
      const note = reason.slice(0, 120) || "Organizer adjustment";
      if (paise > 0) {
        if ((this.state.accounts.TREASURY || 0) < paise)
          throw new Error(
            `The Treasury holds only Rs ${((this.state.accounts.TREASURY || 0) / 100).toFixed(2)}. Money cannot be created, so reduce the amount or take it from elsewhere first.`,
          );
        this.transfer("TREASURY", this.account(p.id), paise, note, "ORGANIZER");
      } else {
        const take = Math.min(-paise, this.balance(p.id));
        if (!take) throw new Error("This operator has nothing in hand to deduct.");
        this.transfer(this.account(p.id), "TREASURY", take, note, "ORGANIZER");
      }
      this.message(
        p,
        paise > 0
          ? `The organizer credited you Rs ${(paise / 100).toFixed(2)}.`
          : `The organizer adjusted your balance by Rs ${(paise / 100).toFixed(2)}.`,
      );
      return this.playerView(p);
    });
  }
  /** Clear a wrong-answer lockout and any jail time for one operator. */
  adminClearPenalties(playerId: string) {
    return this.transaction(() => {
      const p = this.state.players[playerId];
      if (!p) throw new Error("No such operator.");
      p.jail = 0;
      for (const a of Object.values(this.state.attempts))
        if (a.player === p.id) {
          a.blockedUntil = 0;
          a.wrong = 0;
        }
      this.message(p, "The organizer cleared your penalties.");
      this.notice(`NEXUS cleared penalties for ${p.name}.`);
      return this.playerView(p);
    });
  }
  /**
   * Release every contract this operator holds, returning the slots to the
   * queue. Used when somebody goes offline holding a scarce Expert slot.
   */
  adminReleaseHolds(playerId: string) {
    return this.transaction(() => {
      const p = this.state.players[playerId];
      if (!p) throw new Error("No such operator.");
      let released = 0;
      for (const slot of this.state.slots)
        if (slot.holder === p.id && !slot.claimed) {
          for (const a of Object.values(this.state.attempts))
            if (a.slot === slot.id && !a.solved) a.expires = this.clock();
          this.releaseSlot(slot);
          released++;
        }
      this.notice(`NEXUS released ${released} held contract(s) from ${p.name}.`);
      return { released, player: this.playerView(p) };
    });
  }
  markers() {
    const now = this.clock();
    const markers: Array<{ id: string; name: string; x: number; y: number }> =
      [];
    const gh1 = this.state.contests.find((c) => c.id === "GH-01");
    if (gh1 && now >= gh1.start && now < gh1.end)
      for (const site of this.state.cardSites || [])
        if (!this.state.cardClaims[site.id])
          markers.push({ ...site, name: "NEXUS keycard" });
    const gh2 = this.state.contests.find((c) => c.id === "GH-02");
    if (gh2 && now >= gh2.start && now < gh2.end && !gh2.winners.length) {
      const a = this.map.hotspots.find((h) => h.id === "golden"),
        b = this.map.hotspots.find((h) => h.id === "nexus-event");
      if (a && b) {
        const path = findPath(this.map, a.x, a.y, b.x, b.y);
        if (path?.length) {
          const index =
            Math.floor((now - gh2.start) / 1000) % (2 * path.length - 2 || 1);
          const point =
            path[index < path.length ? index : 2 * path.length - 2 - index];
          markers.push({
            id: "courier",
            name: "NEXUS courier",
            x: point.x,
            y: point.y,
          });
        }
      }
    }
    return markers;
  }
  tick() {
    const now = this.clock();
    if (now - this.auditTimer >= 5000) {
      this.auditTimer = now;
      this.audit();
    }
    if (this.state.phase !== "live") return;
    // A paused event must not advance the schedule, expire a hold, charge a bank
    // fee or settle a raid. Returning here is what makes the pause total.
    if (this.state.pausedAt) return;
    if (this.minute() >= 180) {
      this.freeze();
      return;
    }
    this.transaction(() => {
      const m = this.minute();
      this.chargeBankFees(now);
      const announcements: [[number, string], ...Array<[number, string]>] = [
        [0, "Wave 1: eight Standard contracts are open."],
        [10, "Central Bank deposits are now open."],
        [20, "Wave 2 is live."],
        [25, "Race 1 begins in five minutes at Central Exchange."],
        [30, "Race 1 and the first Expert contract are live."],
        [40, "Undercity locks are vulnerable. Burglary is now open."],
        [
          45,
          "Raid window 1 is open. Complete five challenges, then hold the Bank circle.",
        ],
        [50, "Wave 3 is live."],
        [60, "Expert contract 2 is live."],
        [
          68,
          "GOLDEN HOUR // Keycard hunt opens in two minutes on NEXUS Plaza.",
        ],
        [70, "GOLDEN HOUR // Five lost keycards are glowing on NEXUS Plaza."],
        [80, "Wave 4 is live."],
        [85, "Race 2 begins in five minutes."],
        [90, "Raid window 2, Race 2 and Expert contract 3 are live."],
        [
          115,
          "GOLDEN HOUR // A courier crosses NEXUS Plaza. Intercept the manifest.",
        ],
        [
          113,
          "GOLDEN HOUR // The courier arrives in two minutes at NEXUS Plaza.",
        ],
        [
          120,
          "Final Standard wave and Expert contract 4 are live. New registration is closed.",
        ],
        [130, "Race 3 begins in five minutes."],
        [135, "Race 3 is live. Raid window 2 is closed."],
        [140, "The final Expert contract is live."],
        [
          150,
          `BLACK LEDGER // Final raid window opens. Assemble all ${this.state.raidCrewSize || EVENT_RULES.raidCrew} by minute 160.`,
        ],
        [
          165,
          "GOLDEN HOUR // Server sprint begins. Top five operators share ₹100.",
        ],
        [
          163,
          "GOLDEN HOUR // Server Sprint opens in two minutes at the Golden Hour Terminal.",
        ],
        [175, "No new burglaries or raids. Five minutes to Zero Hour."],
      ];
      const custom =
        EVENT_RULES.waveInterval > 0 || EVENT_RULES.expertInterval > 0;
      if (custom) {
        const rewrite: Record<number, string | null> = {
          0: null,
          20: null,
          50: null,
          60: null,
          80: null,
          140: null,
          30: "Race 1 is live at Central Exchange.",
          90: "Raid window 2 and Race 2 are live.",
          120: "New registration is closed.",
        };
        for (let i = announcements.length - 1; i >= 0; i--) {
          const [minute] = announcements[i];
          if (!(minute in rewrite)) continue;
          if (rewrite[minute] === null) announcements.splice(i, 1);
          else announcements[i] = [minute, rewrite[minute]!];
        }
        EVENT_RULES.waveTimes.forEach((minute, i) => {
          const key = `wave-open-${i + 1}`;
          if (m >= minute && !this.state.fired.includes(key)) {
            this.state.fired.push(key);
            this.notice(
              `Standard wave ${i + 1} of ${EVENT_RULES.waveTimes.length} is live: ${EVENT_RULES.waveTemplates[i].join(" and ")}.` +
                (EVENT_RULES.waveTimes[i + 1] !== undefined
                  ? ` Next wave at minute ${EVENT_RULES.waveTimes[i + 1]}.`
                  : " That is the final Standard wave."),
            );
          }
        });
        EVENT_RULES.expertTimes.forEach((minute, i) => {
          const key = `expert-open-${i + 1}`;
          if (m >= minute && !this.state.fired.includes(key)) {
            this.state.fired.push(key);
            this.notice(
              `Expert contract ${i + 1} of ${EVENT_RULES.expertTimes.length} is live: ${EVENT_RULES.expertTemplates[i]}. First operator to claim it takes it.`,
            );
          }
        });
      }
      for (const [minute, text] of announcements.sort((a, b) => a[0] - b[0]))
        if (m >= minute && !this.state.fired.includes(`notice-${minute}`)) {
          this.state.fired.push(`notice-${minute}`);
          this.notice(
            minute === 70
              ? "GOLDEN HOUR // Five credentials are scattered on NEXUS Plaza. Follow each minute’s NEXUS clue."
              : text,
          );
        }
      for (const slot of this.state.slots)
        if (slot.holder && slot.expires <= now && !slot.claimed) {
          for (const a of Object.values(this.state.attempts))
            if (a.slot === slot.id && !a.solved) a.expires = now;
          this.releaseSlot(slot);
        }
      for (const a of Object.values(this.state.attempts))
        if (
          a.mode === "burglary" &&
          !a.solved &&
          a.expires <= now &&
          a.target &&
          this.state.homeLocks[a.target] === a.key
        )
          this.failBurglary(this.state.players[a.player], a);
      if (this.state.courierUntil <= now) this.state.courierHolder = "";
      for (const p of Object.values(this.state.players)) {
        if (p.checkedOut) continue;
        if (p.transitDue && p.transitDue <= now) {
          const reserved =
            this.activeRaid()?.sources.find(
              (s) => s.account === this.account(p.id, "TRANSIT"),
            )?.amount || 0;
          const amount = Math.max(0, this.balance(p.id, "TRANSIT") - reserved);
          this.transfer(
            this.account(p.id, "TRANSIT"),
            this.account(p.id),
            amount,
            "Withdrawal arrived",
            p.id,
          );
          if (!reserved) p.transitDue = 0;
        }
        if (p.checkingOut && !p.transitDue) this.checkout(p);
        if (
          p.offlineAt &&
          now - p.offlineAt >= EVENT_RULES.offline &&
          !this.activeRaid()?.crew.includes(p.id) &&
          p.jail <= now
        ) {
          p.checkingOut = true;
          this.cancelPlayer(p);
          if (!p.transitDue) this.checkout(p);
        }
      }
      const w = this.raidWindow();
      for (const r of this.state.raids) {
        if (r.start && !r.settled && now >= r.end) this.settleRaid(r);
        if (!r.start && !r.settled) {
          if (r.window !== w) {
            r.settled = true;
            r.stand = {};
            r.crew = [];
            continue;
          }
          for (const id of Object.keys(r.stand)) {
            const p = this.state.players[id];
            if (
              !this.terminal(id, "raid") ||
              !this.connected(id) ||
              !p ||
              p.jail > now
            ) {
              delete r.stand[id];
              r.crew = r.crew.filter((x) => x !== id);
            } else if (
              now - r.stand[id] >= EVENT_RULES.raidStand &&
              !r.crew.includes(id) &&
              r.crew.length < (this.state.raidCrewSize || EVENT_RULES.raidCrew)
            )
              r.crew.push(id);
          }
          if (
            r.crew.length === (this.state.raidCrewSize || EVENT_RULES.raidCrew)
          )
            this.beginRaid(r);
        }
      }
      for (const window of [1, 2])
        if (
          m >= [90, 135][window - 1] &&
          !this.state.fired.includes(`seed-${window}`) &&
          !this.activeRaid()
        ) {
          this.state.fired.push(`seed-${window}`);
          this.transfer(
            this.seed(window),
            this.seed(window + 1),
            this.state.accounts[this.seed(window)],
            `Unused seed carried from window ${window}`,
          );
        }
      const cardEvent = this.state.contests.find((c) => c.id === "GH-01");
      if (cardEvent && now >= cardEvent.start && now < cardEvent.end) {
        if (!this.state.cardSites) {
          this.state.cardSites = [];
          const hubs = this.map.hotspots.filter(
            (h) => sceneAt(this.map, h.x, h.y)?.id === "nexus",
          );
          const candidates = new Map<string, Position>();
          for (const hub of hubs)
            for (let dy = -3; dy <= 3; dy++)
              for (let dx = -3; dx <= 3; dx++)
                if (
                  Math.abs(dx) + Math.abs(dy) <= 3 &&
                  isWalkable(this.map, hub.x + dx, hub.y + dy) &&
                  sceneAt(this.map, hub.x + dx, hub.y + dy)?.id === "nexus"
                )
                  candidates.set(`${hub.x + dx},${hub.y + dy}`, {
                    x: hub.x + dx,
                    y: hub.y + dy,
                  });
          const available = [...candidates.values()];
          for (let i = 0; i < 5; i++) {
            const hash = createHash("sha256")
                .update(`${this.state.secret}:card:${i}`)
                .digest("hex"),
              pick = parseInt(hash.slice(0, 8), 16);
            if (!available.length) break;
            const point = available.splice(pick % available.length, 1)[0];
            const source = [...hubs].sort(
              (a, b) =>
                Math.abs(a.x - point.x) +
                Math.abs(a.y - point.y) -
                Math.abs(b.x - point.x) -
                Math.abs(b.y - point.y),
            )[0];
            if (point)
              this.state.cardSites.push({
                id: `card-${i + 1}`,
                name: source.name,
                ...point,
              });
          }
        }
        const clue = Math.floor((now - cardEvent.start) / MINUTE),
          key = `card-clue-${clue}`;
        if (!this.state.fired.includes(key)) {
          this.state.fired.push(key);
          const site = this.state.cardSites[clue % 5];
          if (site)
            this.notice(
              `KEYCARD CLUE ${clue + 1} // Search the streets beside ${site.name}.`,
            );
        }
      }
    });
  }
  private playerView(p: Player) {
    return {
      name: p.name,
      insideHome: !!p.insideHome,
      bankFeePerMinute: Math.floor((this.balance(p.id, "BANK") + 500) / 1000),
      lastBankFee: p.lastBankFee || 0,
      homeId: p.homeId,
      home: this.balance(p.id),
      bank: this.balance(p.id, "BANK"),
      transit: this.balance(p.id, "TRANSIT"),
      completed: p.completed.length,
      training: p.training.length,
      capped: p.capped,
      jailedUntil: p.jail,
      checkedOut: p.checkedOut,
      payout: p.payout,
    };
  }
  view(id: string): EventView {
    const p = this.state.players[id];
    if(!p&&this.observers.has(id)){const now=this.clock();return {type:'event_state',serverTime:now,startedAt:this.state.startedAt,durationMs:this.state.duration,phase:this.state.phase,player:{name:this.observers.get(id)!,homeId:'STAFF',home:0,bank:0,transit:0,completed:0,training:0,capped:false,jailedUntil:0,checkedOut:false,payout:0,insideHome:false},challenges:[],queues:[],jobs:[],announcements:this.state.notices.slice(-8),messages:[],leaderboard:[],homes:[],raid:{window:0,crew:0,required:0,standingSince:0,endsAt:0,joined:false,solved:0},activities:[],markers:[]};}
    if (!p) throw new Error("Unknown player");
    const now = this.clock(),
      r =
        this.activeRaid() ||
        this.state.raids.find(
          (r) => r.window === this.raidWindow() && !r.settled,
        );
    const attempts = Object.values(this.state.attempts).filter(
      (a) => a.player === id,
    );
    return {
      type: "event_state",
      serverTime: now,
      startedAt: this.state.startedAt,
      durationMs: this.state.duration,
      phase: this.state.phase,
      player: this.playerView(p),
      checkoutOpensAt: this.at(EVENT_RULES.checkoutOpen),
      completedChallenges: attempts.filter(a => a.solved).map(a => {
        const t = (a.catalogueVersion === 2 ? templates : legacyTemplates).find(t => t.id === a.template);
        const venueId = a.mode === 'raid' ? 'raid' : a.mode === 'race' ? 'race' : t?.station;
        const home = a.mode === 'burglary' ? this.map.homePlots?.find(h => h.id === this.state.players[a.target ?? '']?.homeId) : undefined;
        const venue = this.map.hotspots.find(h => h.id === venueId);
        const district = home?.sceneId ?? (venue ? sceneAt(this.map,venue.x,venue.y)?.id : t?.district);
        const scene = this.map.scenes?.find(s => s.id === district);
        return {id:a.key, template:a.template, title:`${a.template} · ${t?.title ?? 'Completed challenge'}`, mode:a.mode,
          completedAt:a.lastAnswer, station:home?.id ?? venue?.id, district,
          location:`${scene?.name ?? district ?? 'Veyra City'} · ${home ? `Home ${home.address}` : venue?.name ?? (a.mode === 'event' ? 'Golden Hour field operation' : 'Challenge station')}`};
      }).sort((a,b) => b.completedAt-a.completedAt || a.id.localeCompare(b.id)),
      // Ordered, not incidental. These came out of the attempts map in whatever
      // order the keys happened to sit in, so the sequence a player saw in the
      // journal, at a terminal and in the contract card could differ, and the
      // one the HUD features as the active contract was effectively arbitrary.
      // Live contracts lead, soonest to expire first, because that is the one
      // the operator needs to act on; recently solved ones follow, newest
      // first. Both tie-break on the key so the order is stable across frames.
      challenges: attempts
        .filter((a) => a.mode !== 'training' && !a.solved && a.expires > now)
        .sort((a, b) => a.expires - b.expires || a.key.localeCompare(b.key))
        .concat(
          attempts
            .filter((a) => a.mode !== 'training' && a.solved && now - a.lastAnswer < 5 * MINUTE)
            .sort((a, b) => b.lastAnswer - a.lastAnswer || a.key.localeCompare(b.key))
            .slice(0, 8),
        )
        .map((a) => {
          const t = (
            a.catalogueVersion === 2 ? templates : legacyTemplates
          ).find((t) => t.id === a.template)!;
          const model = this.presentation(a);
          const c = this.state.contests.find((c) => c.id === a.template),
            locked = a.mode === "race" && !!c && now < c.start;
          return {
            id: a.key,
            title: `${a.template} · ${t.title}`,
            topic: t.topic,
            prompt: locked
              ? "NEXUS is preparing your personal race variant. It unlocks for every entrant at race start."
              : model.prompt,
            reward: a.mode === "job" ? t.reward : 0,
            expiresAt: a.expires,
            solved: a.solved,
            ...(!locked && "workbench" in model
              ? {
                  client: model.client,
                  objective: model.objective,
                  difficulty: model.difficulty,
                  workbench: model.workbench,
                  brief: model.brief,
                }
              : {}),
            blockedUntil: a.blockedUntil,
            answerReadyAt: a.lastAnswer
              ? a.lastAnswer + EVENT_RULES.answerInterval
              : 0,
            openedAt: this.availableAt(a),
            minimumSolveMs: EVENT_RULES.minimumSolveMs,
            feedback: a.feedback,
            testRuns: a.testRuns,
          };
        }),
      queues: this.state.slots
        .filter(
          (s) => s.queue.includes(id) || (s.holder === id && !!s.offerUntil),
        )
        .map((s) => ({
          id: s.id,
          position: s.holder === id ? 0 : s.queue.indexOf(id) + 1,
          offerUntil: s.holder === id ? s.offerUntil : 0,
        })),
      jobs: templates
        .filter((t) => ["ST", "SD", "EX"].includes(t.tier))
        .map((t) => {
          const slots = this.state.slots.filter(
            (s) =>
              s.template === t.id &&
              !s.claimed &&
              s.openMinute <= this.minute() &&
              (s.wave === 0 || !p.waves.includes(s.wave)),
          );
          const available =
            this.state.phase === "live" &&
            !p.capped &&
            (t.tier === "ST"
              ? !p.starter
              : slots.length > 0 && this.claimReadyAt(p) <= this.gameNow());
          return {
            ...t,
            available,
            remaining: t.tier === "ST" ? (p.starter ? 0 : 1) : slots.length,
            lockedReason: available ? undefined : this.jobLockedReason(t, p),
          };
        }),
      announcements: this.state.notices.slice(-8),
      messages: p.messages.slice(-8),
      leaderboard: Object.values(this.state.players)
        .map((q) => ({
          name: q.name,
          score: q.checkedOut ? q.payout : this.wealth(q.id),
          completed: q.completed.length,
          capped: q.capped,
          reached: q.reachedAt,
        }))
        .sort(
          (a, b) =>
            b.score - a.score ||
            b.completed - a.completed ||
            a.reached - b.reached,
        )
        .slice(0, 90),
      homes: Object.values(this.state.players)
        .filter((q) => !q.checkedOut)
        .map((q) => ({
          id: q.homeId,
          owner: q.name,
          ownerId: q.id,
          capped: q.capped,
        })),
      raid: {
        window: r?.window || this.raidWindow(),
        crew: r?.crew.length || 0,
        required: this.state.raidCrewSize || EVENT_RULES.smallRaidCrew,
        standingSince: r?.stand[id] || 0,
        endsAt: r?.end || 0,
        joined: r?.crew.includes(id) || false,
        solved: r?.solved[id] || 0,
      },
      activities: this.state.contests
        .filter((c) => now < c.end)
        .map((c) => ({
          id: c.id,
          name: templates.find((t) => t.id === c.id)!.title,
          startsAt: c.start,
          endsAt: c.end,
          description: c.id.startsWith("RC")
            ? "Top three: ₹50 / ₹30 / ₹20"
            : c.id === "GH-01"
              ? "Five glowing keycards on open NEXUS Plaza tiles. One ₹20 claim per operator."
              : c.id === "GH-02"
                ? "Intercept the moving NEXUS courier. First correct answer earns ₹100."
                : "Top five: ₹40 / ₹25 / ₹15 / ₹10 / ₹10",
        })),
      stationStates: this.map.hotspots
        .filter((h) => h.action === "jobs")
        .map((h) => {
          const jobs = templates.filter(
            (t) =>
              t.station === h.id ||
              (h.id?.endsWith("-jobs") &&
                t.district === sceneAt(this.map, h.x, h.y)?.id),
          );
          const ids = new Set(jobs.map((j) => j.id)),
            slots = this.state.slots.filter(
              (s) =>
                ids.has(s.template) &&
                s.openMinute <= this.minute() &&
                !s.claimed,
            );
          const blocked = attempts.find(
            (a) => a.mode !== 'training' && ids.has(a.template) && a.blockedUntil > now,
          );
          const cleared =
            jobs.length > 0 &&
            jobs.every((j) =>
              attempts.some(
                (a) =>
                  a.template === j.id &&
                  a.solved &&
                  a.mode === "job" &&
                  a.catalogueVersion === 2,
              ),
            );
          const busy = slots.find((s) => s.holder),
            open =
              jobs.some((j) => j.tier === "ST" && !p.starter) ||
              slots.some((s) => !s.holder);
          return {
            id: h.id || "",
            type: jobs[0]?.topic || "Code",
            difficulty: jobs.some(
              (j) =>
                j.tier === "EX" &&
                this.state.slots.some(
                  (s) => s.template === j.id && s.openMinute <= this.minute(),
                ),
            )
              ? 3
              : 2,
            state: blocked
              ? ("locked" as const)
              : cleared
                ? ("cleared" as const)
                : busy
                  ? ("busy" as const)
                  : this.state.phase === "live" && open && !p.capped
                    ? ("open" as const)
                    : ("locked" as const),
            until: blocked?.blockedUntil || busy?.expires || 0,
          };
        })
        .concat(
          Object.entries(this.state.homeLocks).map(([owner, key]) => ({
            id: this.state.players[owner]?.homeId || "",
            type: "Puzzle",
            difficulty: 1,
            state: "busy" as const,
            until: this.state.attempts[key]?.expires || 0,
          })),
        ),
      markers: this.markers(),
    };
  }
}
