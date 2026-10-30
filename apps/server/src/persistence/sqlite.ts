import type { Database, PlayerRepo, SessionRepo, StateRepo } from './interfaces.js';
import { DatabaseWorker } from './worker-client.js';

/** Async repositories backed by one SQLite-owning worker, never promise-wrapped main-thread SQL. */
export class SqliteDatabase implements Database {
  readonly worker: DatabaseWorker;
  readonly players: PlayerRepo;
  readonly sessions: SessionRepo;
  readonly state: StateRepo;
  constructor(path: string) {
    this.worker = new DatabaseWorker(path);
    const call = <T>(operation: string, args: unknown[]) => this.worker.request<T>(operation, args);
    this.players = {
      createPlayer: (...args) => call('players.createPlayer', args),
      findById: (...args) => call('players.findById', args),
      findByUsername: (...args) => call('players.findByUsername', args),
      listPlayers: () => call('players.listPlayers', []),
    };
    this.sessions = {
      createSession: (...args) => call('sessions.createSession', args),
      findByToken: (...args) => call('sessions.findByToken', args),
      updateLastSeen: (...args) => call('sessions.updateLastSeen', args),
      deleteByPlayerId: (...args) => call('sessions.deleteByPlayerId', args),
    };
    this.state = {
      save: (...args) => call('state.save', args),
      saveBatch: (...args) => call('state.saveBatch', args),
      findByPlayerId: (...args) => call('state.findByPlayerId', args),
    };
  }
  resetStaffPassword(username: string, passwordHash: string): Promise<{role:string;revoked:number}> {
    return this.worker.request('staff.resetPassword', [username,passwordHash]);
  }
  initialize(): Promise<void> { return this.worker.request('initialize'); }
  close(): Promise<void> { return this.worker.close(); }
  metrics() { return this.worker.metrics(); }
}
