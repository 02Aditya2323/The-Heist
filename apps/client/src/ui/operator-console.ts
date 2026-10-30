/**
 * The super-admin operator console.
 *
 * Built for someone running the event who is not a developer: every control
 * states what it does, every destructive action explains its consequence before
 * it happens, and the money figures are shown in rupees even though the server
 * speaks paise.
 *
 * It is a view with controller callbacks, exactly like the rest of the UI. It
 * holds no socket, decides no balances and validates no answers. The settings
 * form is rendered entirely from server-supplied field metadata, so the bounds
 * and help text shown here are the same ones the server enforces and there is
 * no second copy of the rules to drift.
 */
import "./operator-console.css";

type Actions = {
  dashboard: () => Promise<any>;
  control: (body: object) => Promise<any>;
  settings: () => Promise<any>;
  saveSettings: (overrides: Record<string, number>) => Promise<any>;
  restoreSettings: () => Promise<any>;
  player: (body: {
    action: string;
    id: string;
    paise?: number;
    reason?: string;
  }) => Promise<any>;
  roster: () => Promise<any>;
  rosterCsv: () => Promise<string>;
};

type Field = {
  key: string;
  label: string;
  group: string;
  unit: "paise" | "minutes" | "ms" | "count" | "permille";
  phase: "live" | "preStart";
  min: number;
  max: number;
  help: string;
  value: number;
  default: number;
};

type Tab = "monitor" | "overview" | "settings" | "operators" | "clock" | "ledger";

const el = (tag: string, text = "", className = "") => {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
};

const rupees = (paise: number) =>
  `Rs ${(paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/** Present a stored value in the unit an operator thinks in. */
const toDisplay = (field: Field, value: number) =>
  field.unit === "paise"
    ? value / 100
    : field.unit === "ms"
      ? value / 1000
      : value;

/** Convert what the operator typed back into the unit the server stores. */
const toStored = (field: Field, display: number) =>
  field.unit === "paise"
    ? Math.round(display * 100)
    : field.unit === "ms"
      ? Math.round(display * 1000)
      : Math.round(display);

const unitLabel = (field: Field) =>
  field.unit === "paise"
    ? "rupees"
    : field.unit === "ms"
      ? "seconds"
      : field.unit === "minutes"
        ? "event minutes"
        : field.unit === "permille"
          ? "tenths of a percent"
          : "";

export class OperatorConsole {
  private bound?: Actions;
  private dashboard: any;
  private settings: any;
  private roster: any;
  private tab: Tab = "monitor";
  private busy = false;
  /** Pending edits, keyed by setting. Only these are sent on save. */
  private draft = new Map<string, number>();
  private filter = "";

  private dialog = document.createElement("dialog");
  private status = el("p", "", "oc-status");
  private body = el("div", "", "oc-body");
  private tabsBar = el("nav", "", "oc-tabs");
  private refreshTimer: number | null = null;
  private refreshTick = 0;

  constructor(private pause: (value: boolean) => void) {
    this.dialog.className = "oc-dialog";
    this.dialog.setAttribute("aria-label", "Event operator console");

    const header = el("header", "", "oc-header");
    const titles = el("div", "", "oc-titles");
    titles.append(
      el("small", "VEYRA CITY // NEXUS AUTHORITY", "oc-eyebrow"),
      el("h2", "Event Control Room"),
    );
    const close = el("button", "Close") as HTMLButtonElement;
    close.type = "button";
    close.className = "oc-close";
    close.addEventListener("click", () => this.dialog.close());
    header.append(titles, close);

    this.dialog.append(header, this.tabsBar, this.status, this.body);
    document.body.append(this.dialog);
    this.dialog.addEventListener("close", () => {
      this.pause(false);
      this.stopRefresh();
    });
  }

  bind(actions: Actions) {
    this.bound = actions;
  }

  async open() {
    if (!this.bound) return;
    this.pause(true);
    if (!this.dialog.open) this.dialog.showModal();
    await this.run(async () => {
      await this.load();
      this.say("Connected. Every action here is recorded against your account.");
      this.render();
    });
    this.startRefresh();
  }

  private async load() {
    const [dashboard, settings] = await Promise.all([
      this.bound!.dashboard(),
      this.bound!.settings(),
    ]);
    this.dashboard = dashboard;
    this.settings = settings;
  }

  /**
   * Keep the overview honest while it is on screen. Only the read-only tabs
   * refresh: reloading under a half-filled settings form would discard typing.
   */
  private startRefresh() {
    this.stopRefresh();
    this.refreshTimer = window.setInterval(() => {
      if (this.busy || !this.dialog.open) return;
      if (this.tab !== "overview" && this.tab !== "operators" && this.tab !== "monitor")
        return;
      // The live monitor refreshes every tick of this timer; the other
      // read-only tabs every other tick, as before.
      this.refreshTick = (this.refreshTick + 1) % 2;
      if (this.tab !== "monitor" && this.refreshTick) return;
      void this.run(async () => {
        this.dashboard = await this.bound!.dashboard();
        this.render();
      }, true);
    }, 2500);
  }

  private stopRefresh() {
    if (this.refreshTimer !== null) window.clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }

  private say(text: string, error = false) {
    this.status.textContent = text;
    this.status.dataset.error = String(error);
  }

  private async run(fn: () => Promise<void>, quiet = false) {
    if (this.busy) return;
    this.busy = true;
    if (!quiet) this.say("Working…");
    try {
      await fn();
    } catch (error) {
      this.say(
        error instanceof Error ? error.message : "The request failed.",
        true,
      );
    } finally {
      this.busy = false;
    }
  }

  private button(
    text: string,
    fn: () => void,
    className = "",
  ): HTMLButtonElement {
    const b = el("button", text, className) as HTMLButtonElement;
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }

  /** A control whose consequence the operator must acknowledge first. */
  private guarded(text: string, warning: string, fn: () => void, cls = "") {
    return this.button(
      text,
      () => {
        if (window.confirm(warning)) fn();
      },
      cls,
    );
  }

  private act(body: object, note: string) {
    void this.run(async () => {
      this.dashboard = await this.bound!.control(body);
      this.settings = await this.bound!.settings();
      this.say(note);
      this.render();
    });
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  private render() {
    this.renderTabs();
    this.body.replaceChildren();
    if (!this.dashboard) return;
    if (this.tab === "monitor") this.renderMonitor();
    else if (this.tab === "overview") this.renderOverview();
    else if (this.tab === "settings") this.renderSettings();
    else if (this.tab === "operators") this.renderOperators();
    else if (this.tab === "clock") this.renderClock();
    else this.renderLedger();
  }

  private renderTabs() {
    const tabs: [Tab, string][] = [
      ["monitor", "● Live monitor"],
      ["overview", "Overview"],
      ["clock", "Run the event"],
      ["settings", "Game settings"],
      ["operators", "Operators"],
      ["ledger", "Money trail"],
    ];
    this.tabsBar.replaceChildren();
    for (const [id, label] of tabs) {
      const b = this.button(label, () => {
        if (
          this.tab === "settings" &&
          this.draft.size &&
          !window.confirm("Leave the settings tab and discard your unsaved changes?")
        )
          return;
        if (this.tab === "settings") this.draft.clear();
        this.tab = id;
        this.render();
      });
      b.className = this.tab === id ? "oc-tab is-active" : "oc-tab";
      this.tabsBar.append(b);
    }
  }

  private stat(label: string, value: string, tone = "") {
    const card = el("div", "", `oc-stat ${tone}`);
    card.append(el("small", label), el("strong", value));
    return card;
  }

  /**
   * Live monitor: everything an organizer needs to watch the event run
   * itself, on one screen that refreshes every 2.5 seconds. Read-only; every
   * control stays on the other tabs.
   */
  private renderMonitor() {
    const d = this.dashboard;
    const players = (d.players ?? []) as any[];
    const now = Number(d.serverTime ?? Date.now());
    const minute = Number(d.minute ?? 0);
    const left = d.startedAt
      ? Math.max(0, Number(d.startedAt) + Number(d.durationMs) + Number(d.pausedTotal ?? 0) - now)
      : Number(d.durationMs ?? 0);
    const clock = (ms: number) => {
      const s = Math.round(ms / 1000);
      return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
    };
    const online = players.filter((p) => !p.offline && !p.checkedOut).length;
    const working = players.filter((p) => p.activeContract).length;
    const solves = players.reduce((a, p) => a + Number(p.completed ?? 0), 0);
    const jailed = players.filter((p) => Number(p.jailedUntil ?? 0) > now).length;

    const head = el("p", "", "oc-hint");
    head.textContent =
      d.phase === "lobby"
        ? "Waiting for the event to start. Once started it runs on its own and seals itself at 0:00:00."
        : d.phase === "frozen"
          ? "Event sealed. Every player now sees their final report and the leaderboard."
          : d.paused
            ? "PAUSED. Nothing advances until you resume on the Run the event tab."
            : "Running on its own. Waves, races, raids and the final seal are all scheduled by the server.";
    this.body.append(head);

    const grid = el("section", "", "oc-stats");
    grid.append(
      this.stat(
        "Phase",
        d.paused ? "PAUSED" : String(d.phase).toUpperCase(),
        d.paused ? "is-warn" : d.phase === "live" ? "is-good" : "",
      ),
      this.stat("Time left", d.phase === "frozen" ? "0:00:00" : clock(left)),
      this.stat("Minute", `${Math.floor(minute)} / 180`),
      this.stat("Online now", `${online} / ${players.length}`),
      this.stat("Working a contract", String(working)),
      this.stat("Solves", String(solves)),
      this.stat("In custody", String(jailed), jailed ? "is-warn" : ""),
      this.stat("Ledger", d.audit?.ok ? "Balanced" : "FAILED", d.audit?.ok ? "is-good" : "is-bad"),
    );
    this.body.append(grid);

    // Wave release status, from the same slots the server schedules.
    const slots = (d.slots ?? []) as any[];
    const waves = el("section", "", "oc-panel");
    waves.append(el("h3", "Contract releases"));
    const wt = el("table", "", "oc-table");
    const wb = el("tbody");
    const groups = new Map<string, any[]>();
    for (const s of slots) {
      const key = s.wave ? `Wave ${s.wave} · Standard` : `Expert · ${s.template}`;
      groups.set(key, [...(groups.get(key) ?? []), s]);
    }
    for (const [name, list] of groups) {
      const open = Number(list[0].openMinute ?? 0);
      const claimed = list.filter((s) => s.claimed).length;
      const tr = el("tr");
      tr.append(
        el("td", name),
        el("td", [...new Set(list.map((s) => s.template))].join(", ")),
        el("td", minute >= open ? "released" : `releases in ${Math.ceil(open - minute)} min`, minute >= open ? "is-good" : ""),
        el("td", `${claimed} / ${list.length} claimed`),
      );
      wb.append(tr);
    }
    wt.append(wb);
    waves.append(wt);
    this.body.append(waves);

    // Every operator, richest first.
    const ops = el("section", "", "oc-panel");
    ops.append(el("h3", `Operators (${players.length})`));
    const scroll = el("div", "", "oc-scroll");
    const table = el("table", "", "oc-table");
    const thead = el("thead"),
      hr = el("tr");
    for (const h of ["#", "Operator", "Status", "Working on", "Solved", "Home", "Bank", "Wealth"])
      hr.append(el("th", h));
    thead.append(hr);
    const tbody = el("tbody");
    [...players]
      .sort((a, b) => Number(b.checkedOut ? b.payout : b.wealth ?? 0) - Number(a.checkedOut ? a.payout : a.wealth ?? 0))
      .forEach((p, i) => {
        const status = p.checkedOut
          ? "checked out"
          : Number(p.jailedUntil ?? 0) > now
            ? "in custody"
            : p.offline
              ? "offline"
              : p.capped
                ? "online · capped"
                : "online";
        const tr = el("tr");
        tr.append(
          el("td", String(i + 1)),
          el("td", String(p.name ?? p.id)),
          el("td", status, status.startsWith("online") ? "is-good" : status === "offline" ? "" : "is-warn"),
          el(
            "td",
            p.activeContract
              ? `${p.activeContract} (${p.activeMode}) · ${clock(Math.max(0, Number(p.activeExpires) - now))} left`
              : "—",
          ),
          el("td", String(p.completed ?? 0)),
          el("td", rupees(Number(p.home ?? 0))),
          el("td", rupees(Number(p.bank ?? 0))),
          el("td", rupees(Number(p.checkedOut ? p.payout : p.wealth ?? 0))),
        );
        tbody.append(tr);
      });
    table.append(thead, tbody);
    scroll.append(table);
    ops.append(scroll);
    if (!players.length) ops.append(el("p", "No operators have entered the city yet.", "oc-hint"));
    this.body.append(ops);

    // Latest money movements.
    const recent = ((d.ledger ?? []) as any[]).slice(0, 12);
    const feed = el("section", "", "oc-panel");
    feed.append(el("h3", "Latest money movements"));
    if (!recent.length) feed.append(el("p", "No money has moved yet.", "oc-hint"));
    else {
      const ft = el("table", "", "oc-table");
      const fb = el("tbody");
      for (const r of recent) {
        const tr = el("tr");
        tr.append(
          el("td", String(r.reason ?? "")),
          el("td", `${String(r.source ?? "").replace(/_/g, " ").toLowerCase()} → ${String(r.destination ?? "").replace(/_/g, " ").toLowerCase()}`),
          el("td", rupees(Number(r.paise ?? 0))),
        );
        fb.append(tr);
      }
      ft.append(fb);
      feed.append(ft);
    }
    this.body.append(feed);
  }

  private renderOverview() {
    const d = this.dashboard;
    const phase: string = d.paused ? "PAUSED" : String(d.phase).toUpperCase();
    const enrolled = d.players?.length ?? 0;
    const online = (d.players ?? []).filter(
      (p: any) => !p.offline && !p.checkedOut,
    ).length;
    const checkedOut = (d.players ?? []).filter((p: any) => p.checkedOut).length;

    const grid = el("section", "", "oc-stats");
    grid.append(
      this.stat(
        "Phase",
        phase,
        d.paused ? "is-warn" : d.phase === "live" ? "is-good" : "",
      ),
      this.stat("Event minute", `${Math.floor(d.minute ?? 0)} / 180`),
      this.stat("Enrolled", `${enrolled} / ${d.maxPlayers ?? "?"}`),
      this.stat("Currently online", String(online)),
      this.stat("Checked out", String(checkedOut)),
      this.stat(
        "Ledger",
        d.audit?.ok ? "Balanced" : "FAILED",
        d.audit?.ok ? "is-good" : "is-bad",
      ),
    );
    this.body.append(grid);

    // The conserved total is the single most important number on this screen:
    // if it ever drifts from Rs 4,000 the economy has a bug, not a surprise.
    const accounts = d.accounts ?? {};
    const net = Object.values(accounts).reduce(
      (a: number, b: any) => a + Number(b || 0),
      0,
    ) as number;
    const money = el("section", "", "oc-panel");
    money.append(el("h3", "Where the money is"));
    const netRow = el("p", "", "oc-net");
    netRow.append(
      el("span", "World total: "),
      el(
        "strong",
        rupees(net),
        net === (this.settings?.totalPaise ?? 400000) ? "is-good" : "is-bad",
      ),
      el(
        "span",
        net === (this.settings?.totalPaise ?? 400000)
          ? "  (conserved, as it must always be)"
          : "  (UNEXPECTED - this should always be Rs 4,000.00)",
      ),
    );
    money.append(netRow);
    const table = el("table", "", "oc-table");
    const tbody = el("tbody");
    for (const [name, value] of Object.entries(accounts)
      .filter(([k]) => !k.includes(":"))
      .sort((a, b) => Number(b[1]) - Number(a[1]))) {
      const tr = el("tr");
      tr.append(
        el("td", name.replace(/_/g, " ").toLowerCase()),
        el("td", rupees(Number(value))),
      );
      tbody.append(tr);
    }
    table.append(tbody);
    money.append(table);
    this.body.append(money);

    const leaderboard = (d.players ?? [])
      .slice()
      .sort((a: any, b: any) => (b.home ?? 0) - (a.home ?? 0))
      .slice(0, 10);
    if (leaderboard.length) {
      const panel = el("section", "", "oc-panel");
      panel.append(el("h3", "Leading operators"));
      const t = el("table", "", "oc-table"),
        tb = el("tbody");
      for (const p of leaderboard) {
        const tr = el("tr");
        tr.append(
          el("td", p.name ?? p.id),
          el("td", `${p.completed ?? 0} solved`),
          el("td", rupees(p.home ?? 0)),
        );
        tb.append(tr);
      }
      t.append(tb);
      panel.append(t);
      this.body.append(panel);
    }
  }

  private renderClock() {
    const d = this.dashboard;
    const panel = el("section", "", "oc-panel");
    panel.append(
      el("h3", "Run the event"),
      el(
        "p",
        "These four controls are the whole event. Read the description before pressing one; two of them cannot be undone.",
        "oc-hint",
      ),
    );

    const row = el("div", "", "oc-actions");
    if (d.phase === "lobby")
      row.append(
        this.guarded(
          "Start the event",
          "Start the live event clock for everyone?\n\nThis fixes the raid crew size and begins the schedule. It cannot be undone except by a full reset.",
          () => this.act({ action: "start" }, "The event has started."),
          "oc-primary",
        ),
      );

    // Pause and Resume are both always offered while the event is live. They
    // used to depend on this view's paused flag, so a stale view (for example
    // one loaded while the server was busy) could leave the organizer with no
    // Resume button. The server ignores a pause while paused and vice versa.
    if (d.phase === "live")
      row.append(
        this.guarded(
          "Pause the event",
          "Pause the event?\n\nThe clock stops, no new contracts open, and nothing expires. Players cannot act until you resume. Everybody keeps exactly the time they had left.",
          () => this.act({ action: "pause" }, "The event is paused."),
          "oc-warn",
        ),
      );

    if (d.phase === "live")
      row.append(
        this.guarded(
          "Unlock all contracts now",
          "Release every remaining Standard and Expert contract immediately?\n\nThe prize money does not change. Players can still take one Standard contract per wave, so set a cooldown between paid claims in Game settings to pace them.",
          () => this.act({ action: "unlock_all" }, "Every contract is unlocked."),
          "oc-primary",
        ),
      );

    if (d.phase === "live" || d.paused)
      row.append(
        this.guarded(
          "Resume the event",
          "Resume the event?\n\nEvery timer continues from where it stopped.",
          () => this.act({ action: "resume" }, "The event has resumed."),
          "oc-primary",
        ),
      );

    if (d.phase === "live")
      row.append(
        this.guarded(
          "Freeze and settle",
          "Freeze the event and settle every balance?\n\nThis is FINAL. It seals the ledger, checks everybody out and ends the round. It is not a pause - use Pause if you only need to stop for a moment.",
          () => this.act({ action: "freeze" }, "The event is settled."),
          "oc-danger",
        ),
      );
    panel.append(row);

    if (d.paused)
      panel.append(
        el(
          "p",
          "The event is paused. Players see an explanation that their contracts and timers are frozen, not lost.",
          "oc-banner is-warn",
        ),
      );
    this.body.append(panel);

    // Announcements
    const announce = el("section", "", "oc-panel");
    announce.append(
      el("h3", "Announce to the whole city"),
      el("p", "Appears in every player's HUD immediately.", "oc-hint"),
    );
    const input = el("input") as HTMLInputElement;
    input.maxLength = 300;
    input.placeholder = "e.g. Expert contracts open in two minutes";
    input.className = "oc-input";
    const send = this.button(
      "Send announcement",
      () => {
        const text = input.value.trim();
        if (!text) return this.say("Type an announcement first.", true);
        this.act({ action: "announce", text }, "Announcement delivered.");
        input.value = "";
      },
      "oc-primary",
    );
    const announceRow = el("div", "", "oc-row");
    announceRow.append(input, send);
    announce.append(announceRow);
    this.body.append(announce);

    // Reset, deliberately last and visually separated.
    const danger = el("section", "", "oc-panel is-danger");
    danger.append(
      el("h3", "Start a brand new round"),
      el(
        "p",
        "Archives the current round's history, keeps every login, and clears all balances, progress and holds. Players return to the spawn point and reconnect automatically. Use this between rounds, never as a way to restart the server.",
        "oc-hint",
      ),
    );
    danger.append(
      this.guarded(
        "Reset the event",
        "Reset the entire event?\n\nAll balances, progress, contracts and holds are cleared and archived. Logins are kept. This cannot be undone.\n\nPress OK to confirm, then type RESET when asked.",
        () => {
          const typed = window.prompt(
            "Type RESET in capitals to confirm you want a brand new round.",
          );
          if (typed !== "RESET")
            return this.say("Reset cancelled - confirmation did not match.", true);
          this.act(
            {
              action: "reset",
              confirm: "RESET",
              eventKey: this.dashboard.eventKey,
            },
            "A new round has started.",
          );
        },
        "oc-danger",
      ),
    );
    this.body.append(danger);
  }

  private renderSettings() {
    const s = this.settings;
    if (!s) return;
    const intro = el("section", "", "oc-panel");
    intro.append(
      el("h3", "Game settings"),
      el(
        "p",
        `Change any number in the game. The world always holds exactly ${rupees(s.totalPaise)} - the Treasury absorbs the difference whenever you change a prize, and a change that would need more money than exists is refused with an explanation.`,
        "oc-hint",
      ),
    );
    if (s.started)
      intro.append(
        el(
          "p",
          "The event has started, so settings that decide how much money exists are locked. Everything else can still be changed live.",
          "oc-banner is-warn",
        ),
      );
    const search = el("input") as HTMLInputElement;
    search.type = "search";
    search.className = "oc-input";
    search.placeholder = "Search settings, e.g. cap, bank, raid";
    search.value = this.filter;
    search.addEventListener("input", () => {
      this.filter = search.value;
      this.renderSettingsGroups(groups);
    });
    intro.append(search);
    this.body.append(intro);

    const groups = el("div", "", "oc-groups");
    this.body.append(groups);
    this.renderSettingsGroups(groups);

    const bar = el("section", "", "oc-savebar");
    const count = el("span", "", "oc-draftcount");
    const update = () => {
      count.textContent = this.draft.size
        ? `${this.draft.size} unsaved change${this.draft.size === 1 ? "" : "s"}`
        : "No unsaved changes";
    };
    update();
    bar.append(
      count,
      this.button(
        "Save changes",
        () => {
          if (!this.draft.size) return this.say("Nothing to save.", true);
          // Overrides are cumulative on the server, so merge the stored current
          // values with this draft rather than sending the draft alone.
          const overrides: Record<string, number> = {};
          for (const f of s.fields as Field[])
            if (f.value !== f.default) overrides[f.key] = f.value;
          for (const [key, value] of this.draft) overrides[key] = value;
          void this.run(async () => {
            this.settings = await this.bound!.saveSettings(overrides);
            this.draft.clear();
            this.dashboard = await this.bound!.dashboard();
            this.say("Settings saved and applied immediately.");
            this.render();
          });
        },
        "oc-primary",
      ),
      this.button("Discard", () => {
        this.draft.clear();
        this.render();
      }),
      this.guarded(
        "Restore all defaults",
        "Restore every setting to the documented default plan?",
        () =>
          void this.run(async () => {
            this.settings = await this.bound!.restoreSettings();
            this.draft.clear();
            this.dashboard = await this.bound!.dashboard();
            this.say("All settings restored to their defaults.");
            this.render();
          }),
      ),
    );
    this.body.append(bar);
  }

  private renderSettingsGroups(host: HTMLElement) {
    const s = this.settings;
    const term = this.filter.trim().toLowerCase();
    host.replaceChildren();
    for (const group of s.groups as string[]) {
      const fields = (s.fields as Field[]).filter(
        (f) =>
          f.group === group &&
          (!term ||
            `${f.label} ${f.key} ${f.help}`.toLowerCase().includes(term)),
      );
      if (!fields.length) continue;
      const panel = el("section", "", "oc-panel");
      panel.append(el("h3", group));
      for (const field of fields) panel.append(this.settingRow(field, host));
      host.append(panel);
    }
    if (!host.childElementCount)
      host.append(el("p", "No settings match that search.", "oc-hint"));
  }

  private settingRow(field: Field, host: HTMLElement) {
    const locked = this.settings.started && field.phase === "preStart";
    const row = el("div", "", "oc-field");
    const head = el("div", "", "oc-field-head");
    const label = el("label", field.label, "oc-field-label");
    const input = el("input") as HTMLInputElement;
    const id = `oc-set-${field.key}`;
    input.id = id;
    label.setAttribute("for", id);
    input.type = "number";
    input.className = "oc-number";
    input.disabled = locked;
    input.min = String(toDisplay(field, field.min));
    input.max = String(toDisplay(field, field.max));
    if (field.unit === "paise" || field.unit === "ms") input.step = "any";
    const current = this.draft.has(field.key)
      ? this.draft.get(field.key)!
      : field.value;
    input.value = String(toDisplay(field, current));

    const unit = el("span", unitLabel(field), "oc-unit");
    head.append(label, input, unit);

    const reset = this.button("Default", () => {
      this.draft.set(field.key, field.default);
      this.renderSettingsGroups(host);
    });
    reset.className = "oc-mini";
    reset.disabled = locked;
    head.append(reset);
    row.append(head);

    const note = el("p", field.help, "oc-field-help");
    if (locked)
      note.textContent = `${field.help}  (locked: the event has already started)`;
    row.append(note);

    const changed = current !== field.default;
    if (changed)
      row.append(
        el(
          "p",
          `Changed from the default of ${toDisplay(field, field.default)} ${unitLabel(field)}.`,
          "oc-field-changed",
        ),
      );
    if (this.draft.has(field.key)) row.dataset.dirty = "true";

    input.addEventListener("change", () => {
      const typed = Number(input.value);
      if (!Number.isFinite(typed)) return;
      const stored = toStored(field, typed);
      if (stored < field.min || stored > field.max) {
        this.say(
          `${field.label} must be between ${toDisplay(field, field.min)} and ${toDisplay(field, field.max)} ${unitLabel(field)}.`,
          true,
        );
        input.value = String(toDisplay(field, current));
        return;
      }
      this.draft.set(field.key, stored);
      this.say(`${field.label} will change when you press Save.`);
      this.renderSettingsGroups(host);
    });
    return row;
  }

  /**
   * Everyone who has an account, with the details they gave at signup.
   *
   * This is deliberately separate from the enrolled-operator list below it:
   * somebody can register and never enrol, and on the day the organizer needs
   * to see both "who signed up" and "who is actually playing".
   */
  private renderRosterPanel() {
    const panel = el("section", "", "oc-panel");
    panel.append(
      el("h3", "Registered accounts"),
      el(
        "p",
        "Everyone who has created an account, with the contact details they chose to give. All of those fields are optional, so blanks are normal and not an error.",
        "oc-hint",
      ),
    );

    const actions = el("div", "", "oc-actions");
    actions.append(
      this.button(
        "Load roster",
        () =>
          void this.run(async () => {
            this.roster = await this.bound!.roster();
            this.say(
              `Loaded ${this.roster?.players?.length ?? 0} registered account(s).`,
            );
            this.render();
          }),
        "oc-primary",
      ),
      this.button("Download CSV", () =>
        void this.run(async () => {
          const csv = await this.bound!.rosterCsv();
          // Built as a blob so the authenticated fetch above is what retrieves
          // the data; a plain link to the route would be unauthenticated.
          const url = URL.createObjectURL(
            new Blob([csv], { type: "text/csv;charset=utf-8" }),
          );
          const link = document.createElement("a");
          link.href = url;
          link.download = "heist-roster.csv";
          document.body.append(link);
          link.click();
          link.remove();
          URL.revokeObjectURL(url);
          this.say("Roster downloaded as heist-roster.csv.");
        }),
      ),
    );
    panel.append(actions);

    const rows = (this.roster?.players ?? []) as any[];
    if (!rows.length) {
      panel.append(
        el(
          "p",
          this.roster
            ? "No accounts have been created yet."
            : "Press Load roster to read the account list.",
          "oc-hint",
        ),
      );
      return panel;
    }
    const table = el("table", "", "oc-table");
    const thead = el("thead"),
      hr = el("tr");
    for (const h of ["Operator", "Name", "Email", "Phone", "Team", "Role"])
      hr.append(el("th", h));
    thead.append(hr);
    const tb = el("tbody");
    for (const r of rows) {
      const tr = el("tr");
      tr.append(
        el("td", r.username ?? ""),
        el("td", r.fullName || "\u2014"),
        el("td", r.email || "\u2014"),
        el("td", r.phone || "\u2014"),
        el("td", r.team || "\u2014"),
        el("td", r.role ?? "player"),
      );
      tb.append(tr);
    }
    table.append(thead, tb);
    const scroll = el("div", "", "oc-scroll");
    scroll.append(table);
    panel.append(scroll);
    return panel;
  }

  private renderOperators() {
    this.body.append(this.renderRosterPanel());
    const players = (this.dashboard.players ?? []) as any[];
    const panel = el("section", "", "oc-panel");
    panel.append(
      el("h3", `Operators (${players.length})`),
      el(
        "p",
        "Credit or deduct money, clear a lockout, or release a contract somebody is stuck holding. Every action is recorded against your account and money is only ever moved, never created.",
        "oc-hint",
      ),
    );
    const search = el("input") as HTMLInputElement;
    search.type = "search";
    search.className = "oc-input";
    search.placeholder = "Search operator by name";
    panel.append(search);
    const list = el("div", "", "oc-operators");
    panel.append(list);

    const draw = () => {
      const term = search.value.trim().toLowerCase();
      list.replaceChildren();
      const shown = players.filter(
        (p) => !term || String(p.name ?? p.id).toLowerCase().includes(term),
      );
      if (!shown.length) {
        list.append(
          el(
            "p",
            players.length
              ? "No operator matches that search."
              : "Nobody has enrolled yet.",
            "oc-hint",
          ),
        );
        return;
      }
      for (const p of shown) list.append(this.operatorCard(p));
    };
    search.addEventListener("input", draw);
    draw();
    this.body.append(panel);
  }

  private operatorCard(p: any) {
    const card = el("article", "", "oc-operator");
    const head = el("div", "", "oc-operator-head");
    head.append(
      el("strong", p.name ?? p.id),
      el(
        "span",
        [
          p.homeId && p.homeId !== "STAFF" ? p.homeId : null,
          `${p.completed ?? 0} solved`,
          p.checkedOut ? "checked out" : null,
          p.capped ? "at wealth cap" : null,
          p.jailedUntil && p.jailedUntil > Date.now() ? "jailed" : null,
        ]
          .filter(Boolean)
          .join(" · "),
        "oc-operator-meta",
      ),
    );
    card.append(head);

    // If the roster has been loaded, show who this operator actually is. The
    // event state knows only their in-game name.
    const identity = (this.roster?.players ?? []).find(
      (r: any) => r.username === p.name,
    );
    if (identity) {
      const detail = [identity.fullName, identity.team, identity.email]
        .filter(Boolean)
        .join(" \u00b7 ");
      if (detail) card.append(el("p", detail, "oc-operator-identity"));
    }

    const money = el("div", "", "oc-operator-money");
    money.append(
      el("span", `In hand ${rupees(p.home ?? 0)}`),
      el("span", `Bank ${rupees(p.bank ?? 0)}`),
      el("span", `In transit ${rupees(p.transit ?? 0)}`),
    );
    card.append(money);

    const amount = el("input") as HTMLInputElement;
    amount.type = "number";
    amount.className = "oc-number";
    amount.placeholder = "rupees";
    amount.step = "any";
    const reason = el("input") as HTMLInputElement;
    reason.className = "oc-input";
    reason.placeholder = "Reason (recorded in the ledger)";

    const adjust = (sign: number) => {
      const typed = Number(amount.value);
      if (!Number.isFinite(typed) || typed <= 0)
        return this.say("Enter an amount in rupees first.", true);
      const paise = Math.round(typed * 100) * sign;
      const note = reason.value.trim() || "Organizer adjustment";
      if (
        !window.confirm(
          `${sign > 0 ? "Credit" : "Deduct"} ${rupees(Math.abs(paise))} ${
            sign > 0 ? "to" : "from"
          } ${p.name ?? p.id}?\n\nReason: ${note}`,
        )
      )
        return;
      void this.run(async () => {
        await this.bound!.player({
          action: "adjust",
          id: p.id,
          paise,
          reason: note,
        });
        this.dashboard = await this.bound!.dashboard();
        this.say(`${p.name ?? p.id}: balance adjusted.`);
        this.render();
      });
    };

    const controls = el("div", "", "oc-operator-actions");
    controls.append(
      amount,
      reason,
      this.button("Credit", () => adjust(1), "oc-primary"),
      this.button("Deduct", () => adjust(-1)),
      this.button("Clear penalties", () =>
        void this.run(async () => {
          await this.bound!.player({ action: "clear-penalties", id: p.id });
          this.dashboard = await this.bound!.dashboard();
          this.say(`${p.name ?? p.id}: lockout and jail time cleared.`);
          this.render();
        }),
      ),
      this.button("Release holds", () =>
        void this.run(async () => {
          const r = await this.bound!.player({
            action: "release-holds",
            id: p.id,
          });
          this.dashboard = await this.bound!.dashboard();
          this.say(
            `${p.name ?? p.id}: released ${r?.released ?? 0} held contract(s).`,
          );
          this.render();
        }),
      ),
    );
    card.append(controls);
    return card;
  }

  private renderLedger() {
    const rows = (this.dashboard.ledger ?? []) as any[];
    const panel = el("section", "", "oc-panel");
    panel.append(
      el("h3", "Money trail"),
      el(
        "p",
        "Every movement of money, newest first. The ledger is append-only and hash-chained, so it cannot be edited after the fact.",
        "oc-hint",
      ),
    );
    if (!rows.length) {
      panel.append(el("p", "No money has moved yet.", "oc-hint"));
      this.body.append(panel);
      return;
    }
    const table = el("table", "", "oc-table");
    const thead = el("thead"),
      hr = el("tr");
    for (const h of ["From", "To", "Amount", "Reason"]) hr.append(el("th", h));
    thead.append(hr);
    const tb = el("tbody");
    for (const r of rows.slice().reverse().slice(0, 150)) {
      const tr = el("tr");
      tr.append(
        el("td", String(r.source ?? "").replace(/_/g, " ").toLowerCase()),
        el("td", String(r.destination ?? "").replace(/_/g, " ").toLowerCase()),
        el("td", rupees(Number(r.paise ?? 0))),
        el("td", String(r.reason ?? "")),
      );
      tb.append(tr);
    }
    table.append(thead, tb);
    panel.append(table);
    this.body.append(panel);
  }
}
