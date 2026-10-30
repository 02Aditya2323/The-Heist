import type { EventRequest } from "@heist/shared";
/** Authenticated HTTP service. UI renders results; it never reads a socket or submits packets. */
export class StaffApi {
  constructor(private token: () => string | null) {}
  async request(path: string, body?: object) {
    const token = this.token();
    if (!token) throw new Error("Sign in first");
    const response = await fetch(path, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error ?? "Staff request failed");
    return value;
  }
  catalogue() {
    return this.request("/api/staff/challenges");
  }
  dashboard() {
    return this.request("/api/admin/event");
  }
  open(template: string) {
    return this.request("/api/staff/challenges/open", { template });
  }
  challenge(request: EventRequest) {
    return this.request("/api/staff/challenges/action", request);
  }
  control(body: object) {
    return this.request("/api/admin/event", body);
  }
  /** Editable settings with their server-supplied metadata and bounds. */
  settings() {
    return this.request("/api/admin/settings");
  }
  saveSettings(overrides: Record<string, number>) {
    return this.request("/api/admin/settings", { overrides });
  }
  restoreSettings() {
    return this.request("/api/admin/settings", { reset: true });
  }
  /** Per-operator organizer action: adjust, clear-penalties, release-holds. */
  player(body: {
    action: string;
    id: string;
    paise?: number;
    reason?: string;
  }) {
    return this.request("/api/admin/player", body);
  }
  /** Registered accounts with the contact details collected at signup. */
  roster() {
    return this.request("/api/admin/roster");
  }
  /**
   * Fetch the roster as CSV text. Returned rather than downloaded here so the
   * caller owns how it is saved, and so the auth header is still applied -- a
   * plain link to this route would be unauthenticated.
   */
  async rosterCsv(): Promise<string> {
    const token = this.token();
    if (!token) throw new Error("Sign in first");
    const response = await fetch("/api/admin/roster?format=csv", {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error(
        (await response.json().catch(() => ({})))?.error ??
          "Roster export failed",
      );
    return response.text();
  }
  history(id: string) {
    return this.request(`/api/admin/history/${encodeURIComponent(id)}`);
  }
}
