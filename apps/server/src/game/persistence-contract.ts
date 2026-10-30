export const EVENT_TABLES = [
  "event_ledger",
  "event_answers",
  "event_requests",
  "event_notices",
] as const;
export type EventTable = (typeof EVENT_TABLES)[number];
export interface EventPersistenceData {
  data: string;
  tables: Record<EventTable, Record<string, any>[]>;
}
export interface EventPersistence {
  run<T>(operation: () => T, audit?: StaffAudit): Promise<T>;
  reset(
    roster: { id: string; name: string }[],
    expected: string,
    audit?: StaffAudit,
  ): Promise<import("./event-engine.js").EventEngine>;
  close?(): Promise<void>;
}
export interface StaffAudit { actor: string; username: string; action: string; target?: string }
