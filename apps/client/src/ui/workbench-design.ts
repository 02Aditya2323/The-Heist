import type { WorkbenchKind } from "@heist/shared";

/** Presentation only. No answers, seeds, rewards or validation rules live here. */
export const WORKBENCH_DESIGN: Record<
  WorkbenchKind,
  {
    title: string;
    icon: string;
    instruction: string;
    steps: [string, string, string];
  }
> = {
  code: {
    title: "Code observatory",
    icon: "Code",
    instruction:
      "Read the program, highlight useful lines and trace its output. Submit the value requested in the briefing.",
    steps: ["Inspect source", "Trace values", "Submit output"],
  },
  debug: {
    title: "Repair station",
    icon: "Debug",
    instruction:
      "Choose repairs for the listed lines. Run a server simulation, then verify your repair.",
    steps: ["Find the fault", "Test repairs", "Verify repair"],
  },
  cipher: {
    title: "Cipher laboratory",
    icon: "CTF",
    instruction:
      "Transform the ciphertext with the tools below. Copy your preview into the answer field when you are ready.",
    steps: ["Read the cipher", "Transform text", "Submit plaintext"],
  },
  deduction: {
    title: "Evidence desk",
    icon: "CTF",
    instruction:
      "Mark the clues you have used and eliminate unlikely candidates. Enter the conclusion requested in the briefing.",
    steps: ["Review clues", "Eliminate options", "Submit conclusion"],
  },
  logs: {
    title: "Signal intelligence",
    icon: "CTF",
    instruction:
      "Filter the log stream and pin useful evidence. Use those records to answer the briefing.",
    steps: ["Filter signals", "Pin evidence", "Submit finding"],
  },
  machine: {
    title: "Number engine",
    icon: "CTF",
    instruction:
      "Follow each transformation to find the input that produces the target. Test runs are limited and checked by the server.",
    steps: ["Inspect stages", "Test an input", "Submit input"],
  },
  portal: {
    title: "Sandbox access",
    icon: "CTF",
    instruction:
      "This is a fictional login puzzle. Decode the staff notices, then use the mock credentials as your answer. Never enter a real password.",
    steps: ["Read notices", "Build credentials", "Verify access"],
  },
  maze: {
    title: "Route planner",
    icon: "Puzzle",
    instruction:
      "Move the token with arrows or the direction pad. Collect the key before crossing a locked door. T activates a numbered teleport pad.",
    steps: ["Inspect the route", "Move your token", "Verify route"],
  },
  tree: {
    title: "Command network",
    icon: "Puzzle",
    instruction:
      "Follow the reporting arrows and select the person or people requested in the briefing. Your selection is collected automatically.",
    steps: ["Read the network", "Select nodes", "Verify selection"],
  },
  ring: {
    title: "Payment network",
    icon: "Puzzle",
    instruction:
      "Follow the directed payment links. Select the nodes requested in the briefing, then verify your selection.",
    steps: ["Trace payments", "Select nodes", "Verify selection"],
  },
  order: {
    title: "Deployment console",
    icon: "Puzzle",
    instruction:
      "Arrange the tasks so every dependency comes first. Drag a row or use its earlier/later buttons; both produce the same order.",
    steps: ["Read dependencies", "Arrange tasks", "Verify order"],
  },
  lights: {
    title: "Fare gate panel",
    icon: "Puzzle",
    instruction:
      "Press a light to toggle it and its orthogonal neighbours. Your press sequence is recorded automatically; reset to start again.",
    steps: ["Inspect the panel", "Toggle lights", "Verify sequence"],
  },
  statements: {
    title: "Witness board",
    icon: "Puzzle",
    instruction:
      "Compare the statements against the briefing. Choose a suspect below; the highlighted choice becomes your answer.",
    steps: ["Read testimony", "Choose a suspect", "Verify choice"],
  },
  oracle: {
    title: "Oracle keypad",
    icon: "CTF",
    instruction:
      "Enter a three-digit guess and read the server response. Each attempt uses one of your limited guesses.",
    steps: ["Inspect the clues", "Enter a guess", "Read feedback"],
  },
  circuit: {
    title: "Fuse control",
    icon: "Puzzle",
    instruction:
      "Toggle the named switches and inspect the logic-stage readout. When the requested condition is met, verify your switch selection.",
    steps: ["Read the logic", "Toggle switches", "Verify circuit"],
  },
  courier: {
    title: "Courier channel",
    icon: "CTF",
    instruction:
      "Ask the courier a number and use the server feedback to narrow your next guess. The briefing defines the goal and guess limit.",
    steps: ["Read the brief", "Ask a number", "Read the reply"],
  },
  constraints: {
    title: "Constraint vault",
    icon: "Puzzle",
    instruction:
      "Assign a value to each named node while satisfying every clue. The board collects your assignments for server verification.",
    steps: ["Read the clues", "Assign values", "Verify the board"],
  },
};

export function challengeGate(
  c: {
    expiresAt: number;
    blockedUntil?: number;
    openedAt?: number;
    minimumSolveMs?: number;
    answerReadyAt?: number;
    solved: boolean;
  },
  now: number,
) {
  if (c.solved) return "solved";
  if (c.expiresAt <= now) return "expired";
  if ((c.blockedUntil || 0) > now) return "locked";
  if ((c.answerReadyAt || 0) > now) return "cooldown";
  if (now < (c.openedAt || 0) + (c.minimumSolveMs || 0)) return "reading";
  return "ready";
}

/** Safe source decoration: callers render tokens with textContent, never innerHTML. */
export function codeTokens(line: string): { text: string; kind: string }[] {
  const pattern =
    /(\/\/.*|#.*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:if|else|for|while|return|break|continue|int|float|double|char|void|boolean|String|class|public|static|def|in|range|print|True|False|None|System|out|println|printf)\b|\b\d+(?:\.\d+)?\b)/g;
  const result: { text: string; kind: string }[] = [];
  let at = 0;
  for (const match of line.matchAll(pattern)) {
    if (match.index! > at)
      result.push({ text: line.slice(at, match.index), kind: "plain" });
    const text = match[0];
    result.push({
      text,
      kind:
        text.startsWith("//") || text.startsWith("#")
          ? "comment"
          : /^['"]/.test(text)
            ? "string"
            : /^\d/.test(text)
              ? "number"
              : "keyword",
    });
    at = match.index! + text.length;
  }
  if (at < line.length) result.push({ text: line.slice(at), kind: "plain" });
  return result;
}
