import { rewardFeedback } from './visual-feedback.js';
import { notify } from './notifications.js';
import { sceneAt, isStaff, type EventRequest } from "@heist/shared";
import type { GameStore } from "../game/store.js";
import { createWorkbench } from "./challenge-workbench.js";
import "./challenge-workbench.css";
import { challengeGate } from "./workbench-design.js";
import { renderChallengeBrief } from "./challenge-brief.js";
import {CompletedUI, completionList} from './completed-ui.js';
import {activeContracts, availableContracts, completedContracts} from './contracts-model.js';
import {
  contractHeader,
  metricCard,
  raidCard,
  raidProtocol,
  terminalIcon,
  updateRaidDecoration,
} from "./terminal-cards.js";
const money = (n: number) => `₹${(n / 100).toFixed(2)}`;
const duration = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 3600)
    .toString()
    .padStart(2, "0")}:${Math.floor((s % 3600) / 60)
    .toString()
    .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
};
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = "",
  cls = "",
) {
  const n = document.createElement(tag);
  n.textContent = text;
  if (cls) n.className = cls;
  return n;
}

/** HUD renders server state. All controls emit intent to the application controller. */
export class EventUI {
  private send: (request: EventRequest) => void = () => {};
  private terminal: { id: string; name: string; action: string } | null = null;
  private journal = false;
  private last = 0;
  private signature = "";
  private selectedChallengeId = "";
  private knownChallengeIds = new Set<string>();
  private audio: AudioContext | null = null;
  private audioOn = false;
  private lastNotice = "";
  private toastUntil = 0;
  private previousWealth?: {name:string;startedAt:number;total:number};
  private knownContracts = new Set<string>();
  private answerDrafts = new Map<string, string>();
  private draftPrompts = new Map<string, string>();
  private draftOwner = "";
  private panelConnection = "";
  private completedUI: CompletedUI;
  constructor(
    private store: GameStore,
    private pause: (value: boolean) => void,
  ) {
    this.completedUI = new CompletedUI(store,pause);
    document.getElementById("terminal-game")!.addEventListener("input", (e) => {
      const field = e.target;
      if (
        field instanceof HTMLInputElement &&
        (field.dataset.answer || field.dataset.bankAmount)
      ) {
        this.answerDrafts.set(
          field.dataset.answer || "bank-amount",
          field.value,
        );
        while (this.answerDrafts.size > 80)
          this.answerDrafts.delete(this.answerDrafts.keys().next().value!);
      }
    });
    document
      .getElementById("open-journal")!
      .addEventListener("click", () => this.openJournal());
    document
      .getElementById("toggle-audio")!
      .addEventListener("click", () => this.toggleAudio());
    document
      .getElementById("terminal-dialog")!
      .addEventListener("close", () => {
        if (this.store.event?.player.insideHome)
          this.send({ type: "game_action", action: "leave_home" });
      });
    window.addEventListener("keydown", (e) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      if (e.code === "KeyJ" && !e.repeat && !document.querySelector('dialog[open]:not(#terminal-dialog)')) {
        e.preventDefault();
        this.openJournal();
      }
    });
  }
  bind(send: (request: EventRequest) => void) {
    this.send = send;
  }
  showTerminal(message: Record<string, unknown>) {
    if (message.type === "interaction" || message.type === "action_error") {
      this.journal = false;
      this.terminal = {
        id: String(message.id),
        name: String(message.name),
        action:
          message.type === "action_error" ? "error" : String(message.action),
      };
      this.signature = "";
      document.getElementById("terminal-state")!.dataset.error = String(
        message.type === "action_error",
      );
      this.renderPanel();
    }
  }
  private openJournal() {
    if (!this.store.event) return;
    this.journal = true;
    this.terminal = null;
    this.signature = "";
    document.getElementById("terminal-title")!.textContent = "Operator journal";
    document.getElementById("terminal-copy")!.textContent =
      "Your contracts, city events and private NEXUS messages.";
    document.getElementById("terminal-state")!.textContent = "";
    document.getElementById("terminal-state")!.dataset.error = "false";
    const dialog = document.getElementById(
      "terminal-dialog",
    ) as HTMLDialogElement;
    if (!dialog.open) dialog.showModal();
    this.pause(true);
    this.renderPanel();
  }
  receive(payload: unknown) {
    if (!payload || typeof payload !== "object") return;
    const m = payload as Record<string, unknown>;
    if (m.type === "game_result" && m.message) {
      const status = document.getElementById("terminal-state")!;
      status.textContent = String(m.message);
      status.dataset.error = String(!!m.error);
      notify(String(m.message), m.error ? 'ACTION UNAVAILABLE' : 'OPERATOR UPDATE', !!m.error);
      if (!m.error) this.chime();
    }
    if (m.type === "event_state") {this.completedUI.update();this.renderPanel();}
  }
  update(now: number) {
    if (now - this.last < 250) return;
    this.last = now;
    if (now > this.toastUntil)
      document.getElementById("game-toast")!.hidden = true;
    const event = this.store.event;
    this.completedUI.update();
    document.getElementById("operator-hud")!.hidden =
      !event || !this.store.selfEntity;
    if (!event) return;
    if (
      (document.getElementById("terminal-dialog") as HTMLDialogElement).open
    ) {
      updateRaidDecoration(event);
      const connection = this.store.connectionStatus.state;
      if (this.panelConnection !== connection) {
        this.panelConnection = connection;
        this.signature = "";
        this.renderPanel();
      }
      document.getElementById("terminal-network")!.textContent =
        connection === "CONNECTED"
          ? "● VERIFIED UPLINK"
          : connection === "CONNECTING" || connection === "RECONNECTING"
            ? "○ RECONNECTING UPLINK"
            : "○ UPLINK OFFLINE";
    }
    const p = event.player, staff = isStaff(event.role),
      total = p.checkedOut ? p.payout : p.home + p.bank + p.transit;
    const set = (id: string, text: string) => {
      document.getElementById(id)!.textContent = text;
    };
    const prior = this.previousWealth;
    if (prior?.name === p.name && prior.startedAt === event.startedAt && total > prior.total)
      rewardFeedback(total - prior.total);
    this.previousWealth = {name:p.name,startedAt:event.startedAt,total};
    set("operator-name", p.name);
    set(
      "operator-status",
      staff ? (event.role === 'superadmin' ? 'SUPER ADMIN' : 'ADMIN OBSERVER') : p.checkedOut
        ? "CHECKED OUT"
        : p.jailedUntil > event.serverTime
          ? "IN CUSTODY"
          : p.insideHome
            ? "IN SAFEHOUSE"
            : p.capped
              ? "CAPPED / EXPOSED"
              : "ACTIVE",
    );
    document.getElementById("operator-status")!.dataset.exposed = String(
      p.capped,
    );
    set("wealth-total", money(total));
    set("home-money", money(p.home));
    set("bank-money", money(p.bank + p.transit));
    const fees = document.getElementById("bank-fee-ticker");
    if (fees)
      fees.textContent = `Fee ${money(p.bankFeePerMinute || 0)}/min · transit exempt`;
    const exposed = document.getElementById("home-exposure");
    if (exposed)
      exposed.textContent = staff ? 'STAFF / NO PRIZE HOME' : p.checkedOut
        ? "HOME RELEASED"
        : p.insideHome && !p.capped
          ? "● HOME PROTECTED"
          : "● HOME EXPOSED";
    const banner = document.getElementById("activity-banner"),
      live = event.activities.find(
        (a) => a.startsAt <= event.serverTime && a.endsAt > event.serverTime,
      );
    const upcoming = event.activities.find(
      (a) =>
        a.startsAt > event.serverTime &&
        a.startsAt - event.serverTime <= 5 * 60000,
    );
    if (banner)
      banner.textContent =
        event.raid.endsAt > event.serverTime
          ? `BANK LOCKDOWN · ${duration(event.raid.endsAt - event.serverTime)}`
          : event.raid.standingSince && !event.raid.joined
            ? `HOLD RAID CIRCLE · ${duration(Math.max(0, 60000 - (event.serverTime - event.raid.standingSince)))}`
            : live
              ? `${live.name.toUpperCase()} · ${duration(live.endsAt - event.serverTime)}`
              : upcoming
                ? `${upcoming.name.toUpperCase()} IN ${duration(upcoming.startsAt - event.serverTime)}`
                : "";
    set(
      "completion-count",
      `${p.completed} cleared${p.transit ? ` · ${money(p.transit)} in transit` : ""}`,
    );
    set("home-address", p.homeId.replace("home-", "").toUpperCase());
    (document.getElementById("wealth-progress") as HTMLProgressElement).value =
      total;
    set(
      "event-phase",
      event.phase === "lobby"
        ? "REHEARSAL / AWAITING RESET"
        : event.phase === "frozen"
          ? "LEDGER SEALED"
          : "LOCKDOWN / LIVE",
    );
    set(
      "event-clock",
      duration(
        event.phase === "lobby"
          ? event.durationMs
          : event.durationMs - (event.serverTime - event.startedAt),
      ),
    );
    const active = event.challenges.find((c) => !c.solved),
      activity = event.activities.find(
        (a) => a.startsAt <= event.serverTime && a.endsAt > event.serverTime,
      );
    set(
      "next-directive",
      staff ? 'Use the right-side staff button to review challenges and permitted controls. Reviews are unpaid.' : p.checkedOut
        ? "Your score is sealed. Follow the city leaderboard."
        : p.jailedUntil > event.serverTime
          ? `Custody release in ${duration(p.jailedUntil - event.serverTime)}.`
          : active
            ? `Finish ${active.title.split(" · ")[0]} · ${duration(active.expiresAt - event.serverTime)} remaining`
            : p.capped
              ? "Your Home is exposed. Check the city for eligible operations."
              : activity
                ? `${activity.name} is live. Check the journal for details.`
                : event.phase === "lobby"
                  ? "Explore the city. Paid contracts open when the organizer starts the event."
                  : p.completed < 5
                    ? "Build five completions to qualify for a Bank raid."
                    : `Choose your move: earn, protect your Home, or assemble a raid crew.`,
    );
    const notice = event.announcements.at(-1);
    document
      .querySelectorAll<HTMLElement>("[data-contract-deadline]")
      .forEach((n) => {
        const remaining = Number(n.dataset.contractDeadline) - event.serverTime;
        n.textContent = `Time remaining · ${duration(remaining)}`;
        n.dataset.urgent = String(remaining <= 30000);
      });
    document
      .querySelectorAll<HTMLElement>("[data-contract-lockout]")
      .forEach((n) => {
        n.textContent = `Guess lockout: ${duration(Number(n.dataset.contractLockout) - event.serverTime)} remaining. Your work is preserved.`;
      });
    document
      .querySelectorAll<HTMLElement>("[data-answer-ready]")
      .forEach((n) => {
        n.textContent = `Next answer in ${duration(Number(n.dataset.answerReady) - event.serverTime)}. Your work is preserved.`;
      });
    set("nexus-transmission", notice?.text || "NEXUS is watching the city.");
    document
      .getElementById("nexus-transmission")!
      .classList.toggle(
        "nexus-alert",
        !!notice?.text.startsWith("WEALTH ALERT"),
      );
    if (notice && String(notice.at) !== this.lastNotice) {
      if (this.lastNotice) { this.chime(); notify(notice.text); }
      this.lastNotice = String(notice.at);
    }
  }
  private button(text: string, request: EventRequest, disabled = false) {
    const b = el("button", text, "game-button");
    b.type = "button";
    b.disabled = disabled;
    b.addEventListener("click", () => this.send(request));
    return b;
  }
  private section(title: string) {
    const section = el("section", "", "game-section");
    section.append(el("h3", title));
    return section;
  }
  private renderPanel() {
    const event = this.store.event,
      dialog = document.getElementById("terminal-dialog") as HTMLDialogElement;
    if (!event || !dialog.open) return;
    const container = document.getElementById("terminal-game")!,
      p = event.player,
      action = this.terminal?.action || "journal";
    const fresh = event.challenges.filter(
      (c) => !this.knownChallengeIds.has(c.id) && !c.solved,
    );
    if (fresh.length) this.selectedChallengeId = fresh.at(-1)!.id;
    this.knownChallengeIds = new Set(event.challenges.map((c) => c.id));
    const active = activeContracts(event);
    if (!active.some((c) => c.id === this.selectedChallengeId))
      this.selectedChallengeId =
        active.at(-1)?.id || "";
    // Keep focused answer fields and scroll position intact on one-second server snapshots.
    const signature = JSON.stringify([
      action,
      this.store.connectionStatus.state,
      this.terminal?.id,
      p.name,
      p.homeId,
      this.selectedChallengeId,
      event.challenges.map((c) => [
        c.id,
        c.solved,
        c.prompt,
        c.feedback,
        c.testRuns,
        c.expiresAt <= event.serverTime,
        c.blockedUntil,
        (c.blockedUntil || 0) > event.serverTime,
        c.answerReadyAt,
        (c.answerReadyAt || 0) > event.serverTime,
        event.serverTime < (c.openedAt || 0) + (c.minimumSolveMs || 0),
      ]),
      event.jobs.map((j) => [j.id, j.available, j.remaining]),
      event.completedChallenges,
      event.queues,
      event.raid.crew,
      event.raid.joined,
      event.raid.required,
      event.raid.window,
      event.raid.standingSince,
      event.raid.endsAt,
      event.raid.endsAt > event.serverTime,
      event.raid.solved,
      event.homes,
      p.insideHome,
      p.home,
      p.bank,
      p.transit,
      p.completed,
      p.capped,
      p.checkedOut,
      event.phase,
      event.activities.map((a) => [a.id, a.startsAt <= event.serverTime]),
    ]);
    if (signature === this.signature) return;
    this.signature = signature;
    const tones: Record<string, string> = {
      raid: "BANK RAID PROTOCOL",
      bank: "SECURE ASSET TRANSFER",
      jobs: "CONTRACT ACQUISITION",
      home: "SAFEHOUSE ACCESS",
      homes: "RESIDENTIAL NETWORK",
      race: "COMPETITIVE OPERATIONS",
      events: "GOLDEN HOUR OPERATIONS",
      journal: "PRIVATE OPERATOR DOSSIER",
      checkout: "FINAL SCORE SETTLEMENT",
      leaderboard: "CITY PERFORMANCE INDEX",
      announcements: "NEXUS TRANSMISSIONS",
      error: "LOCATION VERIFICATION",
    };
    const hotspot = this.store.map?.hotspots.find(
      (h) => h.id === this.terminal?.id,
    );
    const scene =
      hotspot && this.store.map
        ? sceneAt(this.store.map, hotspot.x, hotspot.y)
        : this.store.selfEntity && this.store.map
          ? sceneAt(
              this.store.map,
              this.store.selfEntity.tileX,
              this.store.selfEntity.tileY,
            )
          : undefined;
    const tone =
      action === "jobs"
        ? event.stationStates?.find((s) => s.id === this.terminal?.id)?.type ||
          "jobs"
        : action;
    dialog.dataset.tone = tone;
    document.getElementById("terminal-category")!.textContent =
      tones[action] || "CITY OPERATIONS";
    document.getElementById("terminal-mode")!.textContent =
      event.phase === "lobby"
        ? "REHEARSAL"
        : event.phase === "frozen"
          ? "SEALED"
          : "LIVE OPERATION";
    document.getElementById("terminal-operator")!.textContent =
      p.name.toUpperCase();
    document.getElementById("terminal-address")!.textContent = p.homeId
      .replace(/^home-/, "")
      .toUpperCase();
    document
      .getElementById("terminal-emblem")!
      .replaceChildren(terminalIcon(tone));
    const hero = dialog.querySelector<HTMLElement>(".terminal-hero")!;
    hero.style.setProperty(
      "--terminal-art",
      scene
        ? `url(${JSON.stringify(scene.previewImage || scene.image)})`
        : "none",
    );
    const ownerChanged = this.draftOwner !== p.name + ":" + p.homeId;
    if (ownerChanged) {
      this.answerDrafts.clear();
      this.draftPrompts.clear();
      this.draftOwner = p.name + ":" + p.homeId;
    }
    const draft = this.answerDrafts;
    if (!ownerChanged)
      container
        .querySelectorAll<HTMLInputElement>(
          "input[data-answer], input[data-bank-amount]",
        )
        .forEach((n) => draft.set(n.dataset.answer || "bank-amount", n.value));
    while (draft.size > 80) draft.delete(draft.keys().next().value!);
    for (const c of event.challenges) {
      if (
        this.draftPrompts.has(c.id) &&
        this.draftPrompts.get(c.id) !== c.prompt
      )
        draft.delete(c.id);
      this.draftPrompts.set(c.id, c.prompt);
    }
    while (this.draftPrompts.size > 80) {
      const oldest = this.draftPrompts.keys().next().value!;
      this.draftPrompts.delete(oldest);
      draft.delete(oldest);
    }
    const activeInput =
      document.activeElement instanceof HTMLInputElement
        ? document.activeElement
        : null;
    const focusedKey =
      activeInput?.dataset.answer ||
      (activeInput?.dataset.bankAmount ? "bank-amount" : "");
    const selection =
      activeInput?.type === "text"
        ? [activeInput.selectionStart, activeInput.selectionEnd]
        : null;
    const scroll = dialog.scrollTop;
    const completedExpanded = container.querySelector<HTMLDetailsElement>('.completed-contracts')?.open ?? false;
    const focusedTool =
      document.activeElement instanceof HTMLElement &&
      container.contains(document.activeElement) &&
      document.activeElement.matches("input, select, textarea")
        ? document.activeElement.getAttribute("aria-label")
        : null;
    container.replaceChildren();
    if(event.role==='admin'||event.role==='superadmin'){
      container.append(el('p','Staff observer mode. Open the right-side Admin / Challenges panel to review any challenge. Staff do not occupy paid slots, earn prizes or enroll in raid crews.'));
      return;
    }
    if (action === "jobs") {
      const board = this.store.map?.hotspots.find(
          (h) => h.id === this.terminal?.id,
        ),
        district =
          board && this.store.map
            ? sceneAt(this.store.map, board.x, board.y)?.id
            : "";
      const station = this.terminal?.id || "";
      const section = this.section("AVAILABLE CONTRACTS");
      section.classList.add("job-grid");
      for (const j of availableContracts(event)
        .filter(
          (j) =>
            j.district === district &&
            (station.endsWith("-jobs") || j.station === station),
        )
        // Claimable contracts first, so a board never opens on a wall of
        // locked cards when there is paid work available on it.
        .sort((a, b) => Number(b.available) - Number(a.available))) {
        const row = el("article", "", "job-card");
        row.dataset.type = j.topic;
        row.dataset.available = String(j.available);
        row.append(
          contractHeader(
            j.id,
            j.title,
            j.topic,
            `${j.tier === "ST" ? "STARTER" : j.tier === "SD" ? "STANDARD" : "EXPERT"} · ${j.topic.toUpperCase()}`,
            money(j.reward),
          ),
          el(
            "p",
            j.available
              ? `${money(j.reward)} to Home · ${j.remaining} paid ${j.remaining === 1 ? "slot" : "slots"} open now`
              : j.lockedReason ??
                  (event.phase === "lobby"
                    ? "Opens when the organizer starts the event."
                    : "No paid slot is open for you right now."),
            j.available ? "" : "job-locked-reason",
          ),
          el(
            "div",
            j.available
              ? "PAID CLAIM AVAILABLE"
              : event.phase === "lobby"
                ? "AWAITING EVENT START"
                : "LOCKED FOR NOW",
            "job-availability",
          ),
        );
        const controls = el("div", "", "game-actions");
        controls.append(
          this.button(
            j.available ? "Take contract" : "🔒 Locked",
            { type: "game_action", action: "job", id: j.id },
            !j.available,
          ),
        );
        row.append(controls);
        section.append(row);
      }
      container.append(section);
      if(!section.children.length || section.children.length===1) section.append(el('p','No unfinished contracts at this station. Check your completed checklist or explore another centre.','active-contract-empty'));
    }
    if (action === "bank") {
      const metrics = el("div", "", "terminal-metrics");
      metrics.append(
        metricCard(
          p.checkedOut
            ? "HOME / RELEASED"
            : p.insideHome && !p.capped
              ? "HOME / PROTECTED"
              : "HOME / EXPOSED",
          money(p.home),
          "Earnings held at your address",
          "home",
        ),
        metricCard(
          "BANK / SECURED",
          money(p.bank),
          `Holding fee ${money(p.bankFeePerMinute || 0)} / min`,
          "bank",
        ),
        metricCard(
          "IN TRANSIT",
          money(p.transit),
          "Pending server settlement",
          "events",
        ),
      );
      container.append(metrics);
      const section = this.section("CENTRAL BANK");
      section.append(
        el(
          "p",
          `Home ${money(p.home)} · Bank ${money(p.bank)} · Transit ${money(p.transit)}. Deposit limit ₹200. Holding fee 0.1% per minute, rounded to the nearest paisa, feeds the next raid prize; transit is exempt. Withdrawals arrive after five minutes. During a raid, 10% remains reserved until the result; unused reserve returns when the raid ends. Bank requests pause while the crew is locked.`,
        ),
      );
      const form = el("form", "", "bank-form"),
        label = el("label", "Amount in rupees"),
        input = el("input");
      input.type = "number";
      input.min = ".01";
      input.step = ".01";
      input.max = "200";
      input.value = "5";
      input.dataset.bankAmount = "bank";
      input.value = draft.get("bank-amount") || "5";
      input.setAttribute("aria-label", "Bank amount in rupees");
      label.append(input);
      form.append(label);
      for (const a of ["deposit", "withdraw"]) {
        const b = el(
          "button",
          a === "deposit" ? "Deposit" : "Withdraw",
          "game-button",
        );
        b.type = "button";
        b.addEventListener("click", () =>
          this.send({
            type: "game_action",
            action: a,
            amount: Math.round(Number(input.value) * 100),
          }),
        );
        form.append(b);
      }
      container.append(section, form);
    }
    if (action === "home" || action === "homes") {
      const owner = event.homes.find((h) => h.id === this.terminal?.id);
      const section = this.section(
        owner
          ? `${owner.owner} / ${this.terminal?.id.replace("home-", "").toUpperCase()}`
          : "YOUR SAFEHOUSE",
      );
      section.classList.add("safehouse-panel");
      const badge = el("div", "", "safehouse-badge");
      badge.append(
        terminalIcon("home"),
        el(
          "strong",
          owner
            ? this.terminal!.id.replace("home-", "").toUpperCase()
            : p.homeId.replace("home-", "").toUpperCase(),
        ),
        el(
          "small",
          owner?.id === p.homeId
            ? p.insideHome && !p.capped
              ? "OPERATOR INSIDE / PROTECTED"
              : p.capped
                ? "CAPPED / EXPOSED"
                : "YOUR SAFEHOUSE"
            : owner
              ? "OWNER / " + owner.owner
              : "RESIDENTIAL NETWORK",
        ),
      );
      section.append(badge);
      section.append(
        el(
          "p",
          owner?.id === p.homeId
            ? "This is your Home. Earnings arrive here. Bank your money to protect it from thieves."
            : owner
              ? `${owner.capped ? "This capped Home is fully exposed." : "The server checks owner presence, protection and cooldowns."} Lock-picking failure costs up to ₹3 and three minutes in custody.`
              : `Your address is ${p.homeId.replace("home-", "").toUpperCase()}. Find the connected residential wards south of Undercity.`,
        ),
      );
      if (owner?.id === p.homeId)
        section.append(
          this.button(p.insideHome ? "Leave safehouse" : "Enter safehouse", {
            type: "game_action",
            action: p.insideHome ? "leave_home" : "enter_home",
          }),
          el(
            "p",
            p.capped
              ? "CAPPED Homes stay vulnerable even while you are inside."
              : "While inside, your Home is protected. Closing this menu returns you to the street.",
          ),
        );
      if (owner && owner.id !== p.homeId)
        for (const [i, text] of [
          "Level 1 · 5% / max ₹10",
          "Level 2 · 10% / max ₹25 / 5 clears",
          "Level 3 · 20% / max ₹50 / 12 clears",
        ].entries())
          section.append(
            this.button(
              text,
              {
                type: "game_action",
                action: "burglary",
                id: owner.id,
                level: i + 1,
              },
              p.capped ||
                (i === 1 && p.completed < 5) ||
                (i === 2 && p.completed < 12),
            ),
          );
      if (!owner && action === "home")
        section.append(el("p", "This Home site has no active owner."));
      container.append(section);
    }
    if (action === "raid") {
      container.append(
        raidCard(
          event,
          this.button(
            "Hold the raid circle",
            { type: "game_action", action: "raid_join" },
            p.completed < 5 ||
              !event.raid.window ||
              event.raid.joined ||
              event.raid.standingSince > 0 ||
              event.raid.endsAt > event.serverTime ||
              event.phase !== "live",
          ),
        ),
        raidProtocol(event),
      );
      const section = this.section("BREACH CONDITIONS");
      section.append(
        el(
          "p",
          "Each operator gets five private contracts. Two clears pass the personal gate; five passing operators make the raid succeed. The Bank fee vault and in-transit deposits contribute to the prize. All qualification and hold checks run on the server.",
        ),
      );
      container.append(section);
    }
    if (["race", "events", "announcements", "journal"].includes(action)) {
      const section = this.section("CITY OPERATIONS");
      for (const a of event.activities.filter(
        (a) => action !== "race" || a.id.startsWith("RC"),
      )) {
        const row = el("article", "", "activity-card");
        row.dataset.type = a.id.startsWith("RC") ? "Code" : "Puzzle";
        row.append(
          contractHeader(
            a.id,
            a.name,
            a.id.startsWith("RC") ? "race" : "events",
            a.id.startsWith("RC") ? "CITY RACE" : "GOLDEN HOUR",
            a.startsAt > event.serverTime ? "UPCOMING" : "LIVE",
          ),
          el("p", a.description),
          el(
            "small",
            a.startsAt > event.serverTime
              ? `Opens in ${duration(a.startsAt - event.serverTime)}`
              : `Ends in ${duration(a.endsAt - event.serverTime)}`,
          ),
        );
        const can = a.id.startsWith("RC")
          ? this.terminal?.action === "race"
          : a.id === "GH-03"
            ? !!this.store.map?.hotspots.some(
                (h) =>
                  h.id === "golden" &&
                  this.store.selfEntity &&
                  Math.abs(h.x - this.store.selfEntity.tileX) +
                    Math.abs(h.y - this.store.selfEntity.tileY) <=
                    3,
              )
            : event.markers.some(
                (m) =>
                  this.store.selfEntity &&
                  Math.abs(m.x - this.store.selfEntity.tileX) +
                    Math.abs(m.y - this.store.selfEntity.tileY) <=
                    1,
              );
        row.append(
          this.button(
            a.id.startsWith("RC")
              ? "Enter at Race terminal"
              : "Acquire event challenge",
            {
              type: "game_action",
              action: a.id.startsWith("RC") ? "race_enter" : "event_enter",
              id: a.id,
            },
            !can || (a.startsAt > event.serverTime && a.id.startsWith("GH")),
          ),
        );
        section.append(row);
      }
      if (!event.activities.length)
        section.append(
          el(
            "p",
            event.phase === "lobby"
              ? "NEXUS will publish the schedule when the Great Reset begins."
              : "No further events remain.",
          ),
        );
      container.append(section);
    }
    if (action === "checkout") {
      const section = this.section("PERMANENT CHECKOUT");
      section.append(
        el(
          "p",
          p.checkedOut
            ? `Your final score is sealed at ${money(p.payout)}. You can continue watching the leaderboard, but cannot re-enter this event.`
            : `Your current score is ${money(p.home + p.bank + p.transit)}. Checkout ends your participation permanently. Withdrawals must arrive first. Raid members and jailed operators cannot leave.`,
        ),
      );
      const confirm = el("label", "", "checkout-confirm"),
        checkbox = el("input");
      checkbox.type = "checkbox";
      confirm.append(
        checkbox,
        document.createTextNode(
          "I understand that I cannot return to this event.",
        ),
      );
      const b = this.button(
        "Seal my score",
        { type: "game_action", action: "checkout", confirm: true },
        true,
      );
      checkbox.addEventListener("change", () => {
        b.disabled = !checkbox.checked;
      });
      b.disabled =
        p.checkedOut ||
        event.phase === "lobby" ||
        (event.checkoutOpensAt || 0) > event.serverTime;
      checkbox.addEventListener(
        "change",
        () =>
          (b.disabled =
            !checkbox.checked ||
            event.phase === "lobby" ||
            (event.checkoutOpensAt || 0) > event.serverTime),
      );
      if (!p.checkedOut)
        section.append(
          el(
            "p",
            event.phase === "lobby"
              ? "Checkout opens at minute 150 of the live event."
              : (event.checkoutOpensAt || 0) > event.serverTime
                ? `Checkout opens in ${duration(event.checkoutOpensAt! - event.serverTime)}.`
                : "Voluntary Checkout is open.",
          ),
        );
      if (!p.checkedOut) section.append(confirm, b);
      container.append(section);
    }
    const contracts = this.section("ACTIVE CONTRACTS");
    if (active.length) {
      const tabs = el("nav", "", "contract-tabs");
      tabs.setAttribute("aria-label", "Choose a contract workbench");
      for (const c of active) {
        const b = el(
          "button",
          `${c.solved ? "✓ " : ""}${c.title}`,
          "bench-button",
        );
        b.type = "button";
        b.setAttribute(
          "aria-pressed",
          String(c.id === this.selectedChallengeId),
        );
        b.addEventListener("click", () => {
          this.selectedChallengeId = c.id;
          document.getElementById("terminal-state")!.textContent = "";
          this.signature = "";
          this.renderPanel();
          document
            .querySelector<HTMLElement>(".challenge-card")
            ?.scrollIntoView({ block: "start", behavior: "auto" });
        });
        tabs.append(b);
      }
      contracts.append(tabs);
    }
    for (const c of active.filter(
      (c) => c.id === this.selectedChallengeId,
    )) {
      const card = el("article", "", "challenge-card");
      card.dataset.type = c.topic;
      card.dataset.blackLedger = String(c.title.startsWith("BL-"));
      if (c.difficulty)
        card.append(
          el(
            "span",
            "●".repeat(c.difficulty) + "○".repeat(3 - c.difficulty),
            "challenge-stamp",
          ),
        );
      if (!c.solved) {
        const timer = el(
          "small",
          `Time remaining · ${duration(c.expiresAt - event.serverTime)}`,
          "contract-clock",
        );
        timer.dataset.contractDeadline = String(c.expiresAt);
        card.append(timer);
      }
      card.append(
        contractHeader(
          c.title.split(" · ")[0].split(" ")[0],
          c.title.replace(/^[A-Z]{2}-\d{2}\s*·\s*/, ""),
          c.topic,
          c.solved ? "SERVER VERIFIED" : c.topic.toUpperCase(),
          c.reward
            ? money(c.reward)
            : event.phase === "lobby" || c.minimumSolveMs === 0
              ? "PRACTICE"
              : c.title.startsWith("BR-") || c.title.startsWith("BL-")
                ? "CREW"
                : c.title.startsWith("RC-") || c.title.startsWith("GH-")
                  ? "EVENT"
                  : "PRACTICE",
        ),
      );
      // Shared with the staff preview; see challenge-brief.ts.
      card.append(renderChallengeBrief(c));
      if (!c.solved) {
        const form = el("form", "", "answer-form"),
          label = el("label", "Your answer"),
          input = el("input");
        input.type = "text";
        input.maxLength = 600;
        input.autocomplete = "off";
        input.dataset.answer = c.id;
        input.value = draft.get(c.id) || "";
        input.setAttribute("aria-label", `Answer for ${c.title}`);
        label.append(input);
        const submit = el("button", "Submit answer", "game-button");
        const actions = el("section", "", "challenge-actions");
        const gate = challengeGate(c, event.serverTime);
        const offline = this.store.connectionStatus.state !== "CONNECTED";
        const readOnly = event.phase === "frozen" || p.checkedOut || offline;
        const automatic =
          (c.workbench &&
            [
              "debug",
              "maze",
              "tree",
              "lights",
              "statements",
              "circuit",
              "order",
              "ring",
              "constraints",
              "portal",
            ].includes(c.workbench.kind)) ||
          !!(
            c.workbench?.kind === "deduction" &&
            c.workbench.candidates?.length &&
            c.workbench.candidates.every((value) => /^\d$/.test(value))
          );
        if (automatic) {
          label.hidden = true;
          submit.textContent =
            c.workbench?.kind === "debug"
              ? "Verify repair"
              : c.workbench?.kind === "maze"
                ? "Verify route"
                : "Verify solution";
        }
        if (c.workbench && ["oracle", "courier"].includes(c.workbench.kind))
          form.hidden = true;
        submit.type = "submit";
        if (gate !== "ready" || readOnly) {
          submit.disabled = true;
          submit.title = offline
            ? "Uplink offline. Reconnect before verifying."
            : readOnly
              ? "This operator or event has been settled; verification is closed."
              : gate === "reading"
                ? "Read the briefing. Verification opens after the minimum reading time."
                : gate === "locked"
                  ? "Wait for the server guess lockout to end."
                  : gate === "cooldown"
                    ? "Wait for the server answer timer to finish."
                    : "This contract has expired.";
        }
        const help = el(
          "p",
          offline
            ? "Uplink offline. Your local work is preserved; reconnect before verifying."
            : readOnly
              ? "This operator or event has been settled. Tools remain available for inspection; verification is closed."
              : gate === "reading"
                ? `Read the briefing first. Verification unlocks in ${duration((c.openedAt || 0) + (c.minimumSolveMs || 0) - event.serverTime)}.`
                : gate === "expired"
                  ? "This contract has expired. Release it and choose your next move."
                  : gate === "locked"
                    ? `Too many wrong answers. Verification unlocks in ${duration((c.blockedUntil || 0) - event.serverTime)}; your work is preserved.`
                    : gate === "cooldown"
                      ? `Next answer in ${duration((c.answerReadyAt || 0) - event.serverTime)}. Your work is preserved.`
                      : c.workbench &&
                          ["oracle", "courier"].includes(c.workbench.kind)
                        ? "Submit guesses using the tool above. There is no second answer form; each guess is checked by the server."
                        : automatic
                          ? "Your board selections are collected automatically. Verify when you are ready; the server checks the result."
                          : "Enter the answer requested in the briefing. Notes and local simulations do not submit a solution.",
          "challenge-action-help",
        );
        actions.append(help);
        if (gate === "cooldown")
          help.dataset.answerReady = String(c.answerReadyAt);
        form.append(label, submit);
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          if (submit.disabled) return;
          this.send({
            type: "game_action",
            action: "answer",
            id: c.id,
            answer: input.value,
          });
        });
        if (c.workbench)
          card.append(
            createWorkbench(
              c,
              (request) => this.send(request),
              (answer) => {
                input.value = answer;
                this.answerDrafts.set(c.id, answer);
              },
              event.serverTime,
              readOnly,
            ),
          );
        if (c.blockedUntil && c.blockedUntil > event.serverTime) {
          submit.disabled = true;
          const lockout = el(
            "p",
            `Guess lockout: ${duration(c.blockedUntil - event.serverTime)} remaining. Your work is preserved.`,
            "challenge-lockout",
          );
          lockout.dataset.contractLockout = String(c.blockedUntil);
          card.append(lockout);
        }
        const release = el("button", "Release contract", "game-button");
        release.type = "button";
        release.disabled = readOnly;
        release.addEventListener("click", () => {
          if (actions.querySelector(".abandon-confirm")) return;
          const confirm = el("div", "", "abandon-confirm");
          confirm.setAttribute("role", "group");
          confirm.setAttribute("aria-label", "Confirm contract release");
          const cancel = el("button", "Keep working", "game-button");
          cancel.type = "button";
          cancel.addEventListener("click", () => {
            confirm.remove();
            release.hidden = false;
            release.focus();
          });
          confirm.append(
            el(
              "p",
              "Release this contract? Its workbench will close. The server handles any reservation changes.",
            ),
            cancel,
            this.button("Confirm release", {
              type: "game_action",
              action: "abandon",
              id: c.id,
            }),
          );
          release.hidden = true;
          actions.append(confirm);
          cancel.focus();
        });
        actions.append(form, release);
        card.append(actions);
      }
      contracts.append(card);
    }
    if (!active.length) contracts.append(el('p','No active contracts. Completed operations are saved in your checklist.','active-contract-empty'));
    const challengeContext = this.journal || ["jobs", "raid"].includes(action);
    if (challengeContext && (active.length || this.journal)) container.append(contracts);
    else if (active.length) {
      const shortcut = el("aside", "", "terminal-contract-link");
      const open = el("button", "Open contract journal · J", "game-button");
      open.type = "button";
      open.addEventListener("click", () => this.openJournal());
      shortcut.append(
        el(
          "p",
          event.challenges.some((c) => !c.solved)
            ? `${event.challenges.filter((c) => !c.solved).length} active contracts. Continue your work in the private journal.`
            : "Review your completed contracts in the private journal.",
        ),
        open,
      );
      container.append(shortcut);
    }
    if(challengeContext){
      const board=this.store.map?.hotspots.find(h=>h.id===this.terminal?.id);
      const district=board&&this.store.map?sceneAt(this.store.map,board.x,board.y)?.id:undefined;
      const completed=completedContracts(event,this.store.map).filter(c=>action!=='jobs'||(this.terminal?.id.endsWith('-jobs')?c.district===district:c.station===this.terminal?.id));
      if(completed.length){const compact=el('details','','completed-contracts');compact.open=completedExpanded;compact.append(el('summary',`✓ Completed contracts · ${completed.length}`),completionList(completed));
        const all=el('button','Open full checklist','game-button');all.type='button';all.addEventListener('click',()=>this.completedUI.open());compact.append(all);container.append(compact);}
    }
    if (event.queues.length) {
      const section = this.section("EXPERT / STANDARD QUEUES");
      for (const q of event.queues) {
        section.append(
          el(
            "p",
            `${q.id} · ${q.offerUntil ? "Your offer is ready. Accept within 30 seconds." : `queue position ${q.position}`}`,
          ),
        );
        if (q.offerUntil)
          section.append(
            this.button("Accept offer", {
              type: "game_action",
              action: "accept_queue",
              id: q.id,
            }),
          );
      }
      container.append(section);
    }
    if (["leaderboard", "journal", "checkout"].includes(action)) {
      const section = this.section("CITY LEADERBOARD"),
        list = el("ol", "", "leaderboard-list");
      event.leaderboard.forEach((r, i) => {
        const row = el("li");
        row.dataset.self = String(r.name === p.name);
        row.append(
          el(
            "span",
            `${String(i + 1).padStart(2, "0")} ${r.name}${r.capped ? " / CAPPED" : ""}`,
          ),
          el("b", money(r.score)),
          el("small", `${r.completed} clears`),
        );
        list.append(row);
      });
      section.append(list);
      container.append(section);
    }
    if (this.journal || action === "announcements") {
      for (const [title, messages] of [
        ["NEXUS TRANSMISSIONS", event.announcements],
        ["PRIVATE MESSAGES", event.messages],
      ] as const) {
        const section = this.section(title);
        if (!messages.length)
          section.append(
            el("p", "No transmissions on this channel yet.", "channel-empty"),
          );
        messages
          .slice()
          .reverse()
          .forEach((m) => {
            const card = el("article", "", "transmission-card");
            const icon = el("span", "", "transmission-icon");
            icon.append(
              terminalIcon(
                title === "PRIVATE MESSAGES" ? "journal" : "announcements",
              ),
            );
            const body = el("div");
            body.append(
              el(
                "small",
                `${title === "PRIVATE MESSAGES" ? "PRIVATE CHANNEL" : "NEXUS BROADCAST"} / ${new Date(m.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`,
              ),
              el("p", m.text),
            );
            card.append(icon, body);
            section.append(card);
          });
        container.append(section);
      }
    }
    const acquired = event.challenges.find(
      (c) => !c.solved && !this.knownContracts.has(c.id),
    );
    this.knownContracts = new Set(event.challenges.map((c) => c.id));
    if (active.length && (this.journal || action === "jobs"))
      container.prepend(contracts);
    dialog.scrollTop = acquired ? 0 : scroll;
    if (focusedKey && !acquired) {
      const restored = Array.from(
        container.querySelectorAll<HTMLInputElement>(
          "input[data-answer], input[data-bank-amount]",
        ),
      ).find((n) => (n.dataset.answer || "bank-amount") === focusedKey);
      restored?.focus({ preventScroll: true });
      if (
        restored?.type === "text" &&
        selection?.[0] != null &&
        selection[1] != null
      )
        restored.setSelectionRange(selection[0], selection[1]);
    } else if (focusedTool && !acquired)
      Array.from(
        container.querySelectorAll<HTMLElement>("input, select, textarea"),
      )
        .find((field) => field.getAttribute("aria-label") === focusedTool)
        ?.focus({ preventScroll: true });
    else if (acquired)
      container
        .querySelector<HTMLInputElement>("input[data-answer]")
        ?.focus({ preventScroll: true });
  }
  private toggleAudio() {
    this.audioOn = !this.audioOn;
    const button = document.getElementById("toggle-audio")!;
    button.textContent = this.audioOn ? "Sound on" : "Sound off";
    button.setAttribute("aria-pressed", String(this.audioOn));
    if (this.audioOn) {
      this.audio ||= new AudioContext();
      void this.audio.resume();
      this.chime();
    }
  }
  private chime() {
    if (!this.audioOn || !this.audio) return;
    const ctx = this.audio;
    for (const [i, f] of [440, 660].entries()) {
      const oscillator = ctx.createOscillator(),
        gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = f;
      gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.08);
      gain.gain.linearRampToValueAtTime(
        0.035,
        ctx.currentTime + i * 0.08 + 0.015,
      );
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        ctx.currentTime + i * 0.08 + 0.3,
      );
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(ctx.currentTime + i * 0.08);
      oscillator.stop(ctx.currentTime + i * 0.08 + 0.3);
    }
  }
}
