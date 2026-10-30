import type { EventEngine } from './event-engine.js';
import type { ClientConnection } from '../net/connection.js';
import type { EventRequest, AccountRole } from '@heist/shared';
import type { StaffAudit } from './persistence-contract.js';

/** Named operations cross the worker boundary; closures and SQL never do. */
export const EVENT_METHODS = [
  'status', 'eventKey', 'adminView', 'boardView', 'history', 'settingsView',
  'clearSettings', 'updateSettings', 'start', 'freeze', 'pause', 'resume',
  'announce', 'releaseLock', 'adminUnlockAll', 'adminAdjustMoney',
  'adminClearPenalties', 'adminReleaseHolds', 'view', 'action', 'tick',
  'audit', 'total', 'ledger', 'setOnline', 'markAllOffline',
] as const;
export type EventMethod = typeof EVENT_METHODS[number];
export interface RuntimePort {
  invoke<K extends EventMethod>(method: K, args: Parameters<EventEngine[K]>, audit?: StaffAudit): Promise<ReturnType<EventEngine[K]>>;
  admit(id: string, name: string, role?: AccountRole): Promise<void>;
  offline(id: string, at?: number): Promise<void>;
  canMove(id: string): boolean;
  canTravel(id: string): boolean;
  status(): ReturnType<EventEngine['status']> | undefined;
  eventKey(): string | undefined;
  sendState(conn: ClientConnection): void;
  handle(conn: ClientConnection, request: EventRequest): Promise<void>;
  reset(expected: string, audit?: StaffAudit): Promise<void>;
  start(): void;
  stop(): void | Promise<void>;
}

export interface WorldContext {
  positions: { id: string; x: number; y: number }[];
  connected: string[];
}
export interface EventSnapshot {
  status: ReturnType<EventEngine['status']>;
  key: string;
  permissions: Record<string, { move: boolean; travel: boolean }>;
}
