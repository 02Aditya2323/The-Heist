import type { EventView } from "@heist/shared";

export type TerminalIcon =
  | "raid"
  | "bank"
  | "jobs"
  | "home"
  | "race"
  | "events"
  | "journal"
  | "checkout"
  | "leaderboard"
  | "announcements"
  | "error"
  | "Code"
  | "Debug"
  | "CTF"
  | "Puzzle";
const paths: Record<TerminalIcon, string[]> = {
  error: ["M12 3 2 21h20Z", "M12 9v5m0 3v1"],
  raid: [
    "M12 2v3m0 14v3M2 12h3m14 0h3",
    "M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z",
    "M12 8l4 4-4 4-4-4Z",
  ],
  bank: ["M3 9l9-6 9 6H3Z", "M5 11v7m5-7v7m4-7v7m5-7v7M3 21h18"],
  jobs: ["M8 7V4h8v3M3 7h18v14H3Z", "M3 12l9 4 9-4m-11 2h4"],
  home: ["M3 11l9-8 9 8M5 10v11h14V10", "M10 21v-7h4v7"],
  race: [
    "M9 2h6m-3 0v4m6 1 2-2",
    "M20 14a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5v5l3 2",
  ],
  events: ["M14 2L5 14h6l-1 8 9-12h-6Z"],
  journal: ["M5 3h14v18H5Zm3 5h8m-8 4h8m-8 4h5"],
  checkout: ["M10 3H4v18h6m5-14 5 5-5 5m-6-5h11"],
  leaderboard: [
    "M8 21H3v-7h5Zm8 0H8V7h8Zm5 0h-5V11h5ZM12 2l1 2h2l-2 1 .5 2L12 6l-1.5 1 .5-2-2-1h2Z",
  ],
  announcements: [
    "M9 9a4 4 0 0 1 6 0m-9-3a8 8 0 0 1 12 0M12 12v10m-5 0h10",
    "M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z",
  ],
  Code: ["M8 6l-6 6 6 6m8-12 6 6-6 6m-3-14-2 16"],
  Debug: [
    "M8 8h8v9a4 4 0 0 1-8 0V8Zm2 0V5h4v3m-9 2h3m8 0h3M4 15h4m8 0h4m-14 6 3-3m6 0 3 3M12 8v11",
  ],
  CTF: ["M12 2l8 3v6c0 5-8 11-8 11S4 16 4 11V5Z", "M9 12l2 2 4-4"],
  Puzzle: [
    "M3 3h7v3a2 2 0 1 0 4 0V3h7v7h-3a2 2 0 1 0 0 4h3v7h-7v-3a2 2 0 1 0-4 0v3H3Z",
  ],
};

export function terminalIcon(kind: string, className = ""): SVGSVGElement {
  if (kind === "homes") kind = "home";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  if (className) svg.setAttribute("class", className);
  for (const d of paths[kind as TerminalIcon] || paths.journal) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}
export function cardNode<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = "",
  className = "",
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}
export function metricCard(
  label: string,
  value: string,
  note: string,
  icon: string,
): HTMLElement {
  const card = cardNode("article", "", "terminal-metric");
  card.append(
    terminalIcon(icon),
    cardNode("small", label),
    cardNode("strong", value),
    cardNode("span", note),
  );
  return card;
}
export function contractHeader(
  id: string,
  title: string,
  topic: string,
  tag: string,
  value: string,
): HTMLElement {
  const header = cardNode("header", "", "mission-card-head"),
    icon = cardNode("span", "", "mission-card-icon");
  icon.append(terminalIcon(topic));
  const text = cardNode("div", "", "mission-card-heading");
  text.append(cardNode("small", `${id} / ${tag}`), cardNode("h4", title));
  const reward = cardNode("div", "", "mission-card-reward");
  reward.append(
    cardNode("strong", value),
    cardNode("small", value.startsWith("₹") ? "TO YOUR HOME" : "CONTRACT MODE"),
  );
  header.append(icon, text, reward);
  return header;
}

export function raidPresentation(event: EventView) {
  const r = event.raid,
    p = event.player,
    active = event.phase === "live" && r.endsAt > event.serverTime;
  const phase =
    event.phase === "frozen"
      ? "sealed"
      : active
        ? "active"
        : event.phase === "lobby" || !r.window
          ? "closed"
          : r.joined
            ? "joined"
            : p.completed < 5
              ? "qualify"
              : r.standingSince
                ? "holding"
                : "ready";
  const holdSeconds = r.joined
    ? 60
    : r.standingSince
      ? Math.max(
          0,
          Math.min(60, Math.floor((event.serverTime - r.standingSince) / 1000)),
        )
      : 0;
  const names = {
    sealed: [
      "LEDGER SEALED",
      "Operation concluded",
      "This event has ended. Check the journal for your final record.",
    ],
    active: [
      "BANK LOCKDOWN",
      r.joined ? "You’re on the crew." : "A crew is inside.",
      r.joined
        ? "Finish your private contracts. Two clears pass your gate; five passing operators complete the raid."
        : "The active crew has locked the Bank. Watch the journal for the result.",
    ],
    closed: [
      event.phase === "lobby" ? "REHEARSAL MODE" : "WINDOW CLOSED",
      "Assemble. Hold. Breach.",
      event.phase === "lobby"
        ? "Learn the protocol now. Crew formation unlocks during a live raid window."
        : "The raid window is closed. Build completions and return when NEXUS opens the next window.",
    ],
    joined: [
      "CREW CONFIRMED",
      "Your place is secured.",
      "You qualified and held the circle. Stay ready for your private contracts when the crew fills.",
    ],
    qualify: [
      "QUALIFICATION REQUIRED",
      "Earn your place.",
      `You need ${Math.max(0, 5 - p.completed)} more city completions before you can hold the circle.`,
    ],
    holding: [
      "HOLD IN PROGRESS",
      "Don’t leave the circle.",
      "Your 60-second hold is being checked by the server. Keep your operator inside the circle.",
    ],
    ready: [
      "FORMATION OPEN",
      "The crew needs you.",
      "You’re qualified. Start the hold, then stay inside the circle for 60 seconds.",
    ],
  } as const;
  return {
    phase,
    holdSeconds,
    progress: holdSeconds / 60,
    active,
    title: names[phase][1],
    status: names[phase][0],
    description: names[phase][2],
    crew: Math.min(r.required, Math.max(0, r.crew)),
    required: r.required,
  };
}

export function raidCard(
  event: EventView,
  button: HTMLButtonElement,
): HTMLElement {
  const model = raidPresentation(event),
    card = cardNode("section", "", "raid-operation");
  card.dataset.phase = model.phase;
  const brief = cardNode("div", "", "raid-brief");
  brief.append(
    cardNode("span", model.status, "operation-status"),
    cardNode("h3", model.title),
    cardNode("p", model.description),
  );
  const crewLabel = cardNode("div", "", "raid-crew-label");
  crewLabel.append(
    cardNode("small", "CREW MANIFEST"),
    cardNode("strong", `${model.crew} / ${model.required} OPERATORS`),
  );
  brief.append(crewLabel);
  const slots = cardNode("div", "", "raid-crew-slots");
  slots.style.setProperty("--crew-size", String(model.required));
  for (let i = 0; i < model.required; i++) {
    const slot = cardNode("span", "", "raid-crew-slot");
    slot.dataset.filled = String(i < model.crew);
    slot.setAttribute(
      "aria-label",
      `Crew slot ${i + 1}: ${i < model.crew ? "filled" : "empty"}`,
    );
    slot.append(
      cardNode("i", "", "crew-head"),
      cardNode("b", String(i + 1).padStart(2, "0")),
    );
    slots.append(slot);
  }
  brief.append(slots, button);
  button.classList.add("raid-primary");
  const reason = cardNode(
    "p",
    button.disabled
      ? model.phase === "sealed"
        ? "This event has ended; no new holds can begin."
        : model.active
          ? "Bank locked until the raid resolves."
          : model.phase === "joined"
            ? "Your crew place is already confirmed by the server."
            : model.phase === "holding"
              ? "Hold started. Keep your operator inside the circle."
              : !event.raid.window || event.phase === "lobby"
                ? "Available when a live raid window opens."
                : "Complete five city contracts to unlock this action."
      : "Stay in place. Leaving cancels your hold.",
    "action-help",
  );
  brief.append(reason);
  const radar = cardNode("div", "", "raid-radar"),
    ring = cardNode("div", "", "raid-hold-ring");
  ring.style.setProperty("--ring-progress", String(model.progress));
  ring.dataset.raidRing = "";
  ring.append(
    terminalIcon("raid"),
    cardNode(
      "strong",
      String(model.holdSeconds).padStart(2, "0"),
      "raid-hold-value",
    ),
    cardNode("small", "/ 60 SECOND HOLD"),
  );
  radar.append(
    cardNode(
      "small",
      model.active ? "BREACH IN PROGRESS" : "CIRCLE SYNCHRONIZATION",
      "radar-label",
    ),
    ring,
    cardNode(
      "span",
      event.raid.joined ? "SERVER CONFIRMED" : "HOLD TO QUALIFY",
      "radar-caption",
    ),
  );
  card.append(brief, radar);
  return card;
}

/** Refresh countdown decoration in place; never rebuild a focused workbench for a timer. */
export function updateRaidDecoration(event: EventView): void {
  const model = raidPresentation(event);
  document.querySelectorAll<HTMLElement>("[data-raid-ring]").forEach((ring) => {
    ring.style.setProperty("--ring-progress", String(model.progress));
    const value = ring.querySelector(".raid-hold-value");
    if (value) value.textContent = String(model.holdSeconds).padStart(2, "0");
  });
}

export function raidProtocol(event: EventView): HTMLElement {
  const steps = cardNode("div", "", "raid-protocol");
  const data = [
    [
      "01",
      "QUALIFY",
      `${Math.min(5, event.player.completed)} / 5 city completions`,
      event.player.completed >= 5,
    ],
    ["02", "SYNCHRONIZE", "Hold the circle for 60 seconds", event.raid.joined],
    [
      "03",
      "BREACH",
      `${Math.min(2, event.raid.solved)} / 2 private gate clears`,
      event.raid.solved >= 2,
    ],
  ] as const;
  for (const [number, title, text, complete] of data) {
    const step = cardNode("article", "", "protocol-step");
    step.dataset.complete = String(complete);
    step.append(
      cardNode("span", complete ? "✓" : number),
      cardNode("h4", title),
      cardNode("p", text),
    );
    steps.append(step);
  }
  return steps;
}

export function emptyContractCard(): HTMLElement {
  const card = cardNode("div", "", "terminal-empty"),
    icon = cardNode("span", "", "terminal-empty-icon");
  icon.append(terminalIcon("jobs"));
  const text = cardNode("div");
  text.append(
    cardNode("h4", "Your next move starts on the street."),
    cardNode(
      "p",
      "Approach a marked job terminal and press E to accept an eligible paid contract. Questions stay private until acquisition; player training is disabled.",
    ),
  );
  card.append(icon, text, cardNode("span", "E", "terminal-key"));
  return card;
}
