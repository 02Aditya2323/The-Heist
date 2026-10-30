import {
  isStaff,
  type AccountRole,
  type ChallengeView,
  type EventRequest,
} from "@heist/shared";
import { createWorkbench } from "./challenge-workbench.js";
import { renderChallengeBrief } from "./challenge-brief.js";
import "./staff.css";
type Actions = {
  catalogue: () => Promise<any[]>;
  dashboard: () => Promise<any>;
  open: (id: string) => Promise<any>;
  challenge: (r: EventRequest) => Promise<any>;
  control: (body: object) => Promise<any>;
};
const element = (tag: string, text = "", className = "") => {
  const e = document.createElement(tag);
  e.textContent = text;
  e.className = className;
  return e;
};
/** Staff controls are a view with controller callbacks, never network or economy authority. */
export class StaffUI {
  private role: AccountRole = "player";
  private bound?: Actions;
  private catalogue: any[] = [];
  private current?: ChallengeView;
  private answer = "";
  private dashboard: any;
  private busy = false;
  private dock = document.createElement("button");
  private dialog = document.createElement("dialog");
  private content = element("div", "", "staff-content");
  private status = element("p", "", "staff-status");
  constructor(private pause: (value: boolean) => void) {
    this.dock.id = "staff-controls";
    this.dock.className = "staff-dock";
    this.dock.type = "button";
    this.dock.hidden = true;
    this.dock.textContent = "STAFF / CHALLENGES";
    document.body.append(this.dock);
    this.dialog.id = "staff-dialog";
    this.dialog.className = "staff-dialog";
    this.dialog.setAttribute("aria-label", "Staff control centre");
    const header = element("header", "", "staff-header"),
      title = element("h2", "VEYRA / STAFF CONTROL"),
      close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close · Esc";
    close.addEventListener("click", () => this.dialog.close());
    header.append(title, close);
    this.dialog.append(header, this.status, this.content);
    document.body.append(this.dialog);
    this.dock.addEventListener("click", () => void this.open());
    this.dialog.addEventListener("close", () => this.pause(false));
  }
  bind(actions: Actions) {
    this.bound = actions;
  }
  setRole(role: AccountRole) {
    this.role = role;
    this.dock.hidden = !isStaff(role);
    this.dock.textContent =
      role === "superadmin" ? "SUPER ADMIN / CONTROL" : "ADMIN / CHALLENGES";
    if (!isStaff(role) && this.dialog.open) this.dialog.close();
  }
  private button(text: string, fn: () => void) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    b.addEventListener("click", fn);
    return b;
  }
  private async task(fn: () => Promise<void>) {
    if (this.busy) return;
    this.busy = true;
    this.status.dataset.error = "false";
    this.status.textContent = "Secure server request…";
    try {
      await fn();
    } catch (e) {
      this.status.dataset.error = "true";
      this.status.textContent =
        e instanceof Error ? e.message : "Request failed";
    } finally {
      this.busy = false;
    }
  }
  async open() {
    if (!this.bound || !isStaff(this.role)) return;
    this.pause(true);
    if (!this.dialog.open) this.dialog.showModal();
    await this.task(async () => {
      this.catalogue = await this.bound!.catalogue();
      if (this.role === "superadmin")
        this.dashboard = await this.bound!.dashboard();
      this.status.textContent =
        "Authenticated staff access · all previews are unpaid";
      this.renderHome();
    });
  }
  private renderHome() {
    this.current = undefined;
    this.content.replaceChildren();
    this.dialog.scrollTop = 0;
    const summary = element("section", "", "staff-summary");
    summary.append(
      element(
        "small",
        this.role === "superadmin" ? "WORLD AUTHORITY" : "CHALLENGE OPERATIONS",
      ),
      element("h3", "The entire challenge vault."),
      element(
        "p",
        "All 42 challenges. Every district, every workbench. Open a private review copy without changing prizes or player progression.",
      ),
    );
    this.content.append(summary);
    if (this.role === "superadmin") this.renderControls();
    const label = element("label", "Search challenge, topic or station"),
      search = document.createElement("input");
    search.type = "search";
    search.setAttribute("aria-label", "Search all challenges");
    label.append(search);
    this.content.append(label);
    const grid = element("div", "", "staff-challenge-grid");
    this.content.append(grid);
    const draw = () => {
      grid.replaceChildren();
      for (const item of this.catalogue.filter((c) =>
        `${c.id} ${c.title} ${c.type} ${c.station}`
          .toLowerCase()
          .includes(search.value.toLowerCase()),
      )) {
        const card = element("article", "", "staff-challenge-card");
        card.append(
          element("small", `${item.id} / ${item.group}`),
          element("h4", item.title),
          element("p", `${item.type} · ${item.station}`),
          element("span", item.workbench),
          this.button(
            "Open challenge",
            () =>
              void this.task(async () => {
                const result = await this.bound!.open(item.id);
                this.current = result.challenge;
                this.answer = "";
                this.status.textContent = result.scope;
                this.renderChallenge(result.serverTime);
                this.dialog.scrollTop = 0;
              }),
          ),
        );
        grid.append(card);
      }
    };
    search.addEventListener("input", draw);
    draw();
  }
  private renderControls() {
    const state = this.dashboard,
      box = element("section", "", "staff-world-controls");
    box.append(
      element("h3", "Super-admin / World authority"),
      element(
        "p",
        `${state.phase.toUpperCase()} · ${state.players.length}/${state.maxPlayers ?? state.players.length} operators · Ledger ${state.audit.ok ? "balanced" : "FAILED"}`,
      ),
    );
    const run = (body: object) =>
      void this.task(async () => {
        this.dashboard = await this.bound!.control(body);
        this.status.textContent = "Organizer action recorded by the server";
        this.renderHome();
      });
    if (state.phase === "lobby")
      box.append(
        this.button("Start Great Reset", () => {
          if (
            window.confirm("Start the normal live event clock for all players?")
          )
            run({ action: "start" });
        }),
      );
    if (state.phase === "live")
      box.append(
        this.button("Freeze and settle", () => {
          if (
            window.confirm(
              "Freeze the event and settle all balances? This ends the current round.",
            )
          )
            run({ action: "freeze" });
        }),
      );
    const announcement = document.createElement("input");
    announcement.maxLength = 300;
    announcement.setAttribute("aria-label", "Announcement");
    announcement.placeholder = "City-wide announcement";
    box.append(
      announcement,
      this.button("Broadcast", () =>
        run({ action: "announce", text: announcement.value }),
      ),
    );
    const locks = document.createElement("select");
    locks.setAttribute("aria-label", "Occupied paid lock");
    for (const slot of state.slots.filter((s: any) => s.holder && !s.claimed)) {
      const option = document.createElement("option");
      option.value = slot.id;
      option.textContent = `${slot.id} / ${slot.template}`;
      locks.append(option);
    }
    const release = this.button("Release selected lock", () => run({ action: "release", id: locks.value }));
    release.disabled = locks.options.length === 0;
    locks.disabled = locks.options.length === 0;
    if (locks.options.length) box.append(locks, release);
    else box.append(element('p', 'No occupied paid locks to release.'));
    const reset = element("div", "", "staff-danger");
    reset.append(
      element("h4", "Reset the entire event"),
      element(
        "p",
        "Archives the old round and immutable ledger, resets scores/locks/timers, returns operators to spawn and keeps accounts. Type RESET to confirm.",
      ),
    );
    const confirm = document.createElement("input");
    confirm.autocomplete = "off";
    confirm.setAttribute("aria-label", "Reset confirmation");
    confirm.placeholder = "Type RESET";
    const resetButton = this.button("Archive & reset game", () => {
      if (
        confirm.value === "RESET" &&
        window.confirm(
          "Reset now for every connected operator? The previous event will be archived.",
        )
      )
        run({ action: "reset", confirm: "RESET", eventKey: state.eventKey });
    });
    resetButton.disabled = true;
    confirm.addEventListener("input", () => {
      resetButton.disabled = confirm.value !== "RESET";
    });
    reset.append(confirm, resetButton);
    box.append(reset);
    const roster = element("details");
    roster.append(element("summary", "Operators and final scores"));
    for (const p of state.players)
      roster.append(
        element(
          "p",
          `${p.name} / ${p.homeId} · ${p.completed} clears · ₹${((p.home + p.bank + p.transit + p.payout) / 100).toFixed(2)}`,
        ),
      );
    box.append(roster);
    this.content.append(box);
  }
  private renderChallenge(serverTime: number) {
    const c = this.current!;
    this.content.replaceChildren(
      this.button("← All challenges", () => {
        void this.task(async () => {
          if (this.current)
            await this.bound!.challenge({
              type: "game_action",
              action: "abandon",
              id: this.current.id,
            });
          this.renderHome();
          this.status.textContent =
            "All challenge previews · unpaid staff sandbox";
        });
      }),
      element("h3", c.title),
      renderChallengeBrief(c),
    );
    const update = (answer: string) => {
      this.answer = answer;
      const input = this.content.querySelector<HTMLInputElement>(
        "[data-staff-answer]",
      );
      if (input) input.value = answer;
    };
    const send = (request: EventRequest) =>
      void this.task(async () => {
        const result = await this.bound!.challenge(request);
        if (result.challenge) this.current = result.challenge;
        this.status.textContent = result.message;
        this.status.dataset.error = String(result.correct === false);
        this.renderChallenge(result.serverTime ?? Date.now());
      });
    this.content.append(createWorkbench(c, send, update, serverTime, c.solved));
    const field = document.createElement("input");
    field.dataset.staffAnswer = "true";
    field.value = this.answer;
    field.setAttribute("aria-label", "Staff challenge answer");
    field.addEventListener("input", () => {
      this.answer = field.value;
    });
    const verify = this.button(
      c.solved ? "✓ Server verified" : "Verify staff solution",
      () =>
        send({
          type: "game_action",
          action: "answer",
          id: c.id,
          answer: this.answer,
        }),
    );
    verify.disabled = c.solved;
    this.content.append(
      field,
      verify,
      element(
        "p",
        "This review copy never pays a reward or counts toward raids.",
      ),
    );
  }
}
