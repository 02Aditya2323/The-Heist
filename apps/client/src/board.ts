/**
 * Big-screen spectator board.
 *
 * Read-only by construction: it polls the public `/api/board` feed and renders
 * it. There is no session, no socket and no way to send a command from here, so
 * leaving it open on a projector all day cannot affect the event.
 *
 * Written for a screen read from across a room, which drives most of the
 * decisions: very large type, few figures, high contrast, and no information
 * that needs to be read twice to be understood.
 */
import "./board.css";

type Standing = {
  name: string;
  score: number;
  completed: number;
  capped: boolean;
  checkedOut: boolean;
};

type Board = {
  phase: string;
  paused: boolean;
  serverTime: number;
  startedAt: number;
  durationMs: number;
  minute: number;
  enrolled: number;
  online: number;
  checkedOut: number;
  solved: number;
  prizesRemaining: number;
  paidOut: number;
  leaderboard: Standing[];
  announcements: { at: number; text: string }[];
};

const byId = (id: string) => document.getElementById(id)!;

const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/** Remaining wall-clock time, formatted for a glance. */
const countdown = (board: Board) => {
  if (!board.startedAt) return "--:--:--";
  const endsAt = board.startedAt + board.durationMs;
  const left = Math.max(0, endsAt - board.serverTime);
  const total = Math.floor(left / 1000);
  const h = String(Math.floor(total / 3600)).padStart(2, "0");
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
};

const phaseLabel = (board: Board) =>
  board.paused
    ? "PAUSED"
    : board.phase === "lobby"
      ? "AWAITING ZERO HOUR"
      : board.phase === "frozen"
        ? "LEDGER SEALED"
        : "LIVE";

function statTile(label: string, value: string, tone = "") {
  const tile = document.createElement("div");
  tile.className = `board-stat ${tone}`;
  const small = document.createElement("small");
  small.textContent = label;
  const strong = document.createElement("strong");
  strong.textContent = value;
  tile.append(small, strong);
  return tile;
}

function renderStats(board: Board) {
  const host = byId("board-stats");
  host.replaceChildren(
    statTile("Operators", `${board.enrolled}`),
    statTile("Online now", `${board.online}`, "is-good"),
    statTile("Challenges solved", `${board.solved}`, "is-cyan"),
    statTile("Prizes remaining", rupees(board.prizesRemaining), "is-amber"),
    statTile("Settled", rupees(board.paidOut)),
    statTile("Checked out", `${board.checkedOut}`),
  );
}

function renderLeaderboard(board: Board) {
  const host = byId("board-leaderboard");
  host.replaceChildren();
  if (!board.leaderboard.length) {
    const empty = document.createElement("li");
    empty.className = "board-empty";
    empty.textContent =
      board.phase === "lobby"
        ? "Waiting for operators to enrol."
        : "No standings yet.";
    host.append(empty);
    return;
  }
  board.leaderboard.forEach((entry, index) => {
    const row = document.createElement("li");
    row.className = "board-row";
    if (index === 0) row.classList.add("is-first");
    if (entry.checkedOut) row.classList.add("is-out");

    const rank = document.createElement("span");
    rank.className = "board-rank";
    rank.textContent = String(index + 1);

    const name = document.createElement("span");
    name.className = "board-name";
    name.textContent = entry.name;

    const tags = document.createElement("span");
    tags.className = "board-tags";
    if (entry.checkedOut) tags.textContent = "SEALED";
    else if (entry.capped) tags.textContent = "AT CAP";

    const solved = document.createElement("span");
    solved.className = "board-solved";
    solved.textContent = `${entry.completed}`;

    const score = document.createElement("span");
    score.className = "board-score";
    score.textContent = rupees(entry.score);

    row.append(rank, name, tags, solved, score);
    host.append(row);
  });
}

function renderAnnouncements(board: Board) {
  const host = byId("board-announcements");
  host.replaceChildren();
  // Newest first: on a projector the top line is the one people read.
  for (const notice of [...board.announcements].reverse()) {
    const item = document.createElement("li");
    const text = document.createElement("p");
    text.textContent = notice.text;
    item.append(text);
    host.append(item);
  }
  if (!host.childElementCount) {
    const item = document.createElement("li");
    item.textContent = "No transmissions yet.";
    host.append(item);
  }
}

let latest: Board | null = null;
let failures = 0;

function render() {
  if (!latest) return;
  byId("board-phase").textContent = phaseLabel(latest);
  byId("board-time").textContent = countdown(latest);
  document.body.dataset.phase = latest.paused ? "paused" : latest.phase;
  renderStats(latest);
  renderLeaderboard(latest);
  renderAnnouncements(latest);
}

async function poll() {
  try {
    const response = await fetch("/api/board", {
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    latest = (await response.json()) as Board;
    failures = 0;
    byId("board-state").textContent = `Updated ${new Date().toLocaleTimeString()}`;
    render();
  } catch (error) {
    failures++;
    // The board is unattended, so it states the problem and keeps retrying
    // rather than stopping. Previous standings stay on screen meanwhile.
    byId("board-state").textContent =
      failures > 2
        ? `Lost contact with the city (${failures} attempts). Still retrying…`
        : "Reconnecting…";
  }
}

void poll();
setInterval(poll, 3000);
// The clock is interpolated locally between polls so the countdown ticks every
// second instead of jumping in three-second steps.
setInterval(() => {
  if (!latest || latest.paused || !latest.startedAt) return;
  latest.serverTime += 1000;
  byId("board-time").textContent = countdown(latest);
}, 1000);
