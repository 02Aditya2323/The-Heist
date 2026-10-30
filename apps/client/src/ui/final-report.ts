import type { EventView } from "@heist/shared";
import "./final-report.css";

/**
 * The end-of-event screen.
 *
 * At minute 180 the server seals the ledger by itself, cancels every open
 * contract and checks every operator out at their final wealth. Before this
 * screen existed, players saw only "LEDGER SEALED" in small type and could keep
 * walking an inert city with no idea what they had scored. Now the city is
 * covered by a report that needs no organizer to explain it: final score, rank,
 * what they completed, and the full leaderboard.
 *
 * Staff accounts are exempt so the organizer keeps the city and the console.
 */
export function installFinalReport(pause: (value: boolean) => void) {
  const root = document.createElement("section");
  root.id = "final-report";
  root.hidden = true;
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "final-report-title");
  document.body.append(root);
  let shownFor = "";

  const money = (paise: number) =>
    `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const node = (tag: string, text = "", cls = "") => {
    const n = document.createElement(tag);
    if (text) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };

  return {
    update(event: EventView) {
      const staff = event.role === "admin" || event.role === "superadmin";
      if (event.phase !== "frozen" || staff) {
        if (!root.hidden) {
          root.hidden = true;
          shownFor = "";
          pause(false);
        }
        return;
      }
      // Re-asserted on every update while sealed: a dialog's asynchronous
      // close event can resume input after the first pause.
      pause(true);
      // Re-render only when something on the report changes.
      const key = JSON.stringify([event.player.payout, event.leaderboard.map((r) => [r.name, r.score])]);
      if (key === shownFor) return;
      shownFor = key;
      // Close dialogs first: their close handlers resume input, so pausing
      // before closing them would be undone immediately.
      document.querySelectorAll<HTMLDialogElement>("dialog[open]").forEach((d) => d.close());
      pause(true);

      const me = event.player;
      const board = event.leaderboard;
      const rank = board.findIndex((r) => r.name === me.name) + 1;
      const score = me.checkedOut ? me.payout : me.home + me.bank + me.transit;

      const card = node("div", "", "fr-card");
      card.append(
        node("small", "ZERO HOUR // THE LEDGER IS SEALED", "fr-eyebrow"),
        node("h2", "Final report", ""),
      );
      card.lastElementChild!.id = "final-report-title";

      const hero = node("div", "", "fr-hero");
      const scoreBox = node("div", "", "fr-score");
      scoreBox.append(node("small", "YOUR FINAL SCORE"), node("strong", money(score)));
      const rankBox = node("div", "", "fr-rank");
      rankBox.append(
        node("small", "YOUR RANK"),
        node("strong", rank ? `#${rank}` : "—"),
        node("span", `of ${board.length} operator${board.length === 1 ? "" : "s"}`),
      );
      hero.append(scoreBox, rankBox);
      card.append(hero);

      const facts = node("ul", "", "fr-facts");
      facts.replaceChildren(
        ...[
          ["Operator", me.name],
          ["Contracts completed", String(me.completed)],
          ["Home address", me.homeId.replace(/^home-/, "").toUpperCase()],
        ].map(([label, value]) => {
          const li = node("li");
          li.append(node("span", label), node("b", value));
          return li;
        }),
      );
      card.append(facts);

      const done = event.completedChallenges ?? [];
      if (done.length) {
        const list = node("div", "", "fr-done");
        list.append(node("h3", "What you completed"));
        const ul = node("ul");
        for (const c of done) ul.append(node("li", `${c.title}${c.mode === "training" ? " (practice)" : ""}`));
        list.append(ul);
        card.append(list);
      }

      const lb = node("div", "", "fr-board");
      lb.append(node("h3", "Leaderboard"));
      const table = node("table");
      const tbody = node("tbody");
      board.forEach((r, i) => {
        const tr = node("tr", "", r.name === me.name ? "is-self" : "");
        tr.append(
          node("td", `#${i + 1}`),
          node("td", r.name),
          node("td", `${r.completed} solved`),
          node("td", money(r.score)),
        );
        tbody.append(tr);
      });
      table.append(tbody);
      lb.append(table);
      card.append(lb);

      card.append(
        node(
          "p",
          "The event is over and every score is final and verified by the server. Thank you for playing The Heist.",
          "fr-foot",
        ),
      );
      root.replaceChildren(card);
      root.hidden = false;
      // Keep the self row in view on a long leaderboard.
      root.querySelector(".is-self")?.scrollIntoView({ block: "nearest" });
    },
  };
}
