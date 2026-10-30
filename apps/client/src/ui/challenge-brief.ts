import type { ChallengeView } from "@heist/shared";

/**
 * The mission brief shown above every challenge.
 *
 * Shared by the player's contract terminal and the staff preview, so what an
 * organizer reviews is exactly what a player will read. The staff preview used
 * to print the raw prompt and objective, so staff could not see the answer
 * format block, which is the part most likely to cost a player a paid contract.
 *
 * The sections always appear in the same order: who is asking, what to
 * produce, where the evidence is, and the exact shape of the answer. Players
 * previously lost paid contracts by solving a puzzle correctly and formatting
 * the answer differently from what the validator wanted, which the free-text
 * prompt never stated.
 *
 * `c.prompt` still carries the per-player Evidence ID appended by the server,
 * while `brief.scenario` is the clean fiction, so the structured path shows the
 * ID separately and the fallback path keeps it inline.
 */
export function renderChallengeBrief(
  c: Pick<ChallengeView, "prompt" | "client" | "objective" | "brief">,
): HTMLElement {
  const brief = node("section", "", "challenge-brief");
  brief.append(node("small", "MISSION BRIEF / READ BEFORE YOU ACT"));
  if (c.client) brief.append(node("p", `CLIENT / ${c.client}`, "contract-client"));

  const structured = c.brief;
  if (!structured) {
    // Legacy rehearsal challenges have no structured brief.
    brief.append(node("pre", c.prompt, "brief-text"));
    if (c.objective) brief.append(node("p", c.objective, "contract-objective"));
    return brief;
  }

  const part = (label: string, text: string, className: string, pre = false) => {
    const section = node("div", "", `brief-part ${className}`);
    section.append(
      node("span", label, "brief-label"),
      node(pre ? "pre" : "p", text, "brief-text"),
    );
    return section;
  };
  brief.append(part("THE SITUATION", structured.scenario, "is-scenario", true));
  brief.append(part("YOUR TASK", structured.task, "is-task"));
  if (structured.data)
    brief.append(part("WHERE THE EVIDENCE IS", structured.data, "is-data"));
  brief.append(part("ANSWER FORMAT", structured.answerFormat, "is-format"));
  if (structured.example)
    brief.append(
      part(
        "A CORRECTLY FORMATTED ANSWER",
        `${structured.example}   (this is only an example of the format, not the answer)`,
        "is-example",
      ),
    );
  if (structured.hints?.length) {
    const details = document.createElement("details");
    details.className = "brief-hints";
    details.append(node("summary", "Stuck? Open a hint"));
    const list = node("ol");
    for (const hint of structured.hints) list.append(node("li", hint));
    details.append(list);
    brief.append(details);
  }
  const evidence = /Evidence ID: ([a-f0-9]+)/.exec(c.prompt)?.[1];
  if (evidence) brief.append(node("p", `Evidence ID ${evidence}`, "brief-evidence"));
  return brief;
}

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = "",
  className = "",
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
}
