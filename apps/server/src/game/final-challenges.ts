import { createHmac } from "node:crypto";
import type { ChallengeBrief, ChallengeWorkbench, WorkbenchKind } from "@heist/shared";
import { CHALLENGE_CATALOGUE } from "./challenge-catalogue.js";
import { simulateDebug } from "./debug-simulation.js";

export interface FinalChallenge {
  prompt: string;
  answer: string;
  client: string;
  objective: string;
  difficulty: number;
  brief: ChallengeBrief;
  workbench: ChallengeWorkbench;
  validate: (input: string) => boolean;
  runFixes?: (input: string) => string;
  oracle?: (input: string) => string;
  success?: string;
}
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toUpperCase();

/**
 * What a correctly shaped answer looks like, for each kind of workbench.
 *
 * The required shape is a property of the workbench, not of the individual
 * challenge: every maze wants a route string, every cipher wants decoded text.
 * Defining it once per kind therefore covers all 42 challenges accurately,
 * rather than relying on 42 hand-written descriptions that would drift from the
 * validators.
 *
 * `validate` normalises with `norm` (trim, collapse whitespace, upper-case), so
 * these descriptions say case and spacing do not matter wherever that is true.
 *
 * Every example is deliberately a value that is NOT any challenge's real
 * answer. The point is to remove ambiguity about the format without giving the
 * puzzle away.
 */
const ANSWER_CONTRACT: Record<
  WorkbenchKind,
  { answerFormat: string; example?: string }
> = {
  code: {
    answerFormat:
      "Exactly what the program prints, on one line, including any words and punctuation it prints. Capitals and extra spaces are forgiven.",
    example: "Total 1234",
  },
  debug: {
    answerFormat:
      "One line:choice pair per buggy line, separated by commas. The line number comes first, then the number of the fix you picked.",
    example: "3:1,7:0",
  },
  cipher: {
    answerFormat:
      "The decoded message as letters only. Capitals and spacing are forgiven.",
    example: "MEET AT THE HARBOR",
  },
  deduction: {
    answerFormat: "The single name or value the evidence identifies.",
    example: "CORVIN",
  },
  logs: {
    answerFormat:
      "The single value the logs identify, exactly as it appears in them.",
    example: "10.0.4.19",
  },
  machine: {
    answerFormat:
      "The starting number that produces the target. Digits only, with a minus sign if it is negative.",
    example: "-18",
  },
  portal: {
    answerFormat:
      "The passphrase the clues spell out. This is a fictional puzzle: never enter a real password here.",
    example: "AMBER LANTERN",
  },
  maze: {
    answerFormat:
      "The route as a single run of direction letters: U for up, D for down, L for left, R for right. No spaces, commas or arrows.",
    example: "RRDDLU",
  },
  tree: {
    answerFormat: "The names in the required order, separated by commas.",
    example: "ARIA, BOYD, CELE",
  },
  order: {
    answerFormat:
      "The items in the correct order, separated by commas, first to last.",
    example: "BUILD, TEST, SHIP",
  },
  ring: {
    answerFormat: "The digits of the combination in order, with no separators.",
    example: "40719",
  },
  lights: {
    answerFormat:
      "The switches to press, separated by commas. Order does not matter.",
    example: "A, C, D",
  },
  statements: {
    answerFormat:
      "The one name the statements convict, spelled exactly as it appears on the board.",
    example: "CORVIN",
  },
  oracle: {
    answerFormat: "The code the oracle confirms. Digits only, no separators.",
    example: "5173",
  },
  circuit: {
    answerFormat:
      "The required input bits in order, as 0s and 1s with no separators.",
    example: "10110",
  },
  courier: {
    answerFormat: "The single value the courier gives up, exactly as stated.",
    example: "LANTERN",
  },
  constraints: {
    answerFormat:
      "The one assignment that satisfies every constraint, as comma-separated values in the order the board lists them.",
    example: "2, 5, 9",
  },
};
export function shift(text: string, n: number) {
  return text.replace(/[a-z]/gi, (c) =>
    String.fromCharCode(
      ((c.toUpperCase().charCodeAt(0) - 65 + (n % 26) + 26) % 26) + 65,
    ),
  );
}
export function atbash(text: string) {
  return text.replace(/[a-z]/gi, (c) =>
    String.fromCharCode(90 - (c.toUpperCase().charCodeAt(0) - 65)),
  );
}
const reverse = (s: string) => [...s].reverse().join("");
const relay = (s: string, sign = 1) => {
  let i = 0;
  return s.replace(/[a-z]/gi, (c) => shift(c, sign * ++i));
};
const distinct = (s: string) => new Set(s).size === s.length;
const CLIENTS: Record<string, string> = {
  "ST-01": "Veyra Transit Authority",
  "ST-02": "Transit Authority Junior Clerk",
  "ST-03": "Black Grid Gatekeeper",
  "SD-01": "Veyra Power Grid",
  "SD-02": "Veyra Network Desk",
  "SD-03": "Veyra Courier Guild",
  "SD-04": "Veyra Utilities",
  "SD-05": "Veyra Parks Department",
  "SD-06": "Black Grid Customs Office",
  "SD-07": "Harbor Security Desk",
  "SD-08": "Black Grid Courier Drop",
  "SD-09": "Veyra Transit Authority",
  "SD-10": "Veyra Fraud Desk",
  "EX-01": "Veyra Vault Services",
  "EX-02": "Veyra Staffing Office",
  "EX-03": "Courier Guild · Second Shift",
  "EX-04": "Black Grid Door Terminal",
  "EX-05": "Mock Veyra Bank Portal",
};
export function digitFeedback(secret: string, guess: string) {
  let exact = 0,
    total = 0;
  for (let i = 0; i < secret.length; i++) {
    if (secret[i] === guess[i]) exact++;
    if (secret.includes(guess[i])) total++;
  }
  return `${exact} in place, ${total - exact} misplaced`;
}
export function toggleLights(board: number[], index: number) {
  const b = board.slice();
  for (const n of [
    index,
    index - 3,
    index + 3,
    ...(index % 3 ? [index - 1] : []),
    ...(index % 3 < 2 ? [index + 1] : []),
  ])
    if (n >= 0 && n < 9) b[n] ^= 1;
  return b;
}

/** Pure puzzle simulation, separate from city movement. Keys and teleport pads are part of the puzzle. */
export function walkMaze(
  grid: string[],
  route: string,
): { ok: boolean; steps: number } {
  let x = grid[0].indexOf("S"),
    y = 0,
    key = false;
  for (let row = 0; row < grid.length; row++) {
    const start = grid[row].indexOf("S");
    if (start >= 0) {
      x = start;
      y = row;
      break;
    }
  }
  let steps = 0;
  for (const move of route.toUpperCase().replace(/[\s,]/g, "")) {
    let nx = x,
      ny = y;
    if (move === "U") ny--;
    else if (move === "D") ny++;
    else if (move === "L") nx--;
    else if (move === "R") nx++;
    else if (move === "T") {
      const pad = grid[y]?.[x];
      if (!pad || !/[0-9]/.test(pad)) return { ok: false, steps };
      const other = grid.flatMap((r, ry) =>
        [...r].flatMap((v, rx) =>
          v === pad && (rx !== x || ry !== y) ? [{ x: rx, y: ry }] : [],
        ),
      )[0];
      if (!other) return { ok: false, steps };
      nx = other.x;
      ny = other.y;
    } else return { ok: false, steps };
    const tile = grid[ny]?.[nx];
    if (!tile || tile === "#" || (tile === "D" && !key))
      return { ok: false, steps };
    x = nx;
    y = ny;
    key ||= tile === "K";
    steps++;
  }
  return { ok: grid[y]?.[x] === "E", steps };
}
export function shortestMaze(grid: string[]): string {
  const queue = [""],
    seen = new Set<string>();
  const initial = grid.flatMap((r, y) =>
    [...r].flatMap((c, x) =>
      c === "S" ? [{ x, y, key: false, route: "" }] : [],
    ),
  )[0];
  if (!initial) throw new Error("Missing maze start");
  const states = [initial];
  for (let at = 0; at < states.length; at++) {
    const s = states[at];
    if (grid[s.y][s.x] === "E") return s.route;
    for (const [m, dx, dy] of [
      ["U", 0, -1],
      ["D", 0, 1],
      ["L", -1, 0],
      ["R", 1, 0],
      ["T", 0, 0],
    ] as const) {
      let x = s.x + dx,
        y = s.y + dy;
      if (m === "T") {
        const pad = grid[s.y][s.x];
        if (!/[0-9]/.test(pad)) continue;
        const p = grid.flatMap((r, ry) =>
          [...r].flatMap((v, rx) =>
            v === pad && (rx !== s.x || ry !== s.y) ? [{ x: rx, y: ry }] : [],
          ),
        )[0];
        if (!p) continue;
        x = p.x;
        y = p.y;
      }
      const c = grid[y]?.[x];
      if (!c || c === "#" || (c === "D" && !s.key)) continue;
      const key = s.key || c === "K",
        id = `${x},${y},${key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      states.push({ x, y, key, route: s.route + m });
    }
  }
  throw new Error("Unsolvable generated maze");
}
function hops(
  nodes: string[],
  edges: [string, string][],
  a: string,
  b: string,
) {
  const q: [string, number][] = [[a, 0]],
    seen = new Set([a]);
  for (let i = 0; i < q.length; i++) {
    const [n, d] = q[i];
    if (n === b) return d;
    for (const [x, y] of edges) {
      const v = x === n ? y : y === n ? x : "";
      if (v && !seen.has(v)) {
        seen.add(v);
        q.push([v, d + 1]);
      }
    }
  }
  return -1;
}

export function generateFinalChallenge(
  secret: string,
  player: string,
  id: string,
  variant = "",
): FinalChallenge {
  const spec = CHALLENGE_CATALOGUE.find((t) => t.id === id);
  if (!spec) throw new Error("Unknown challenge");
  let seed =
    parseInt(
      createHmac("sha256", secret)
        .update(`final-v2:${player}:${id}:${variant}`)
        .digest("hex")
        .slice(0, 8),
      16,
    ) >>> 0;
  const rand = (n: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return ((seed ^ (seed >>> 16)) >>> 0) % n;
  };
  const shuffle = <T>(arr: T[]) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = rand(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const nums = Array.from({ length: 6 }, () => 5 + rand(70)),
    suffix = String(1000 + rand(9000));
  const difficulty =
    spec.group === "Starter" ? 1 : spec.group === "Standard" ? 2 : 3;
  const out = (
    prompt: string,
    answer: string | number,
    workbench: ChallengeWorkbench,
    objective = "Solve the evidence and submit your result.",
    client = CLIENTS[id] || "Veyra Operations Desk",
    brief: Partial<ChallengeBrief> = {},
  ): FinalChallenge => {
    const contract = ANSWER_CONTRACT[workbench.kind];
    return {
      prompt: `${prompt}\nEvidence ID: ${createHmac("sha256", secret).update(`${player}:${id}:${variant}`).digest("hex").slice(0, 12)}`,
      answer: String(answer),
      workbench,
      objective,
      client,
      difficulty,
      // Every challenge gets a structured brief, derived here rather than
      // hand-written 42 times. `scenario` keeps the existing fiction, `task`
      // keeps the existing objective, and the answer contract comes from the
      // workbench kind so it cannot drift away from what `validate` accepts.
      brief: {
        scenario: prompt,
        task: objective,
        answerFormat: contract.answerFormat,
        example: contract.example,
        ...brief,
      },
      validate: (input) => norm(input) === norm(String(answer)),
    };
  };
  const code = (
    text: string,
    answer: string | number,
    variables: string[],
    prompt: string,
  ) =>
    out(
      prompt,
      answer,
      { kind: "code", code: text, language: spec.language, variables },
      "Read the program and type exactly what it prints.",
    );
  const debug = (
    text: string,
    fixRows: { line: number; correct: string; decoys: string[] }[],
    run: (correct: boolean[]) => string,
    prompt: string,
    languages?: Record<string, string>,
  ) => {
    const expected: Record<number, number> = {};
    const fixes = fixRows.map((row) => {
      const options = shuffle([row.correct, ...row.decoys]);
      expected[row.line] = options.indexOf(row.correct);
      return { line: row.line, options };
    });
    const parse = (input: string) =>
      Object.fromEntries(input.split(/[,;]/).map((s) => s.trim().split(":")));
    const answer = Object.entries(expected)
      .map(([l, v]) => `${l}:${v}`)
      .join(",");
    const c = out(
      prompt,
      answer,
      {
        kind: "debug",
        code: text,
        language: spec.language,
        variables: ["pass", "value", "total"],
        fixes,
        initialOutput: run(fixRows.map(() => false)),
        languages,
      },
      "Select each buggy line, choose its fix, then run the repaired code.",
    );
    c.validate = (input) => {
      const selected = parse(input);
      return (
        Object.keys(selected).length === fixRows.length &&
        Object.entries(expected).every(
          ([line, v]) => Number(selected[line]) === v,
        )
      );
    };
    c.runFixes = (input) => {
      const selected = parse(input);
      const replacements: Record<string, string> = {};
      for (const fix of fixes) {
        const value = selected[fix.line];
        if (
          value !== undefined &&
          /^\d+$/.test(value) &&
          fix.options[Number(value)]
        )
          replacements[fix.line] = fix.options[Number(value)];
      }
      return simulateDebug(id, c.workbench, replacements);
    };
    return c;
  };
  if (id === "ST-01" || id === "ST-02") {
    const a = [nums[0], -nums[1], nums[2], -nums[3], nums[4], nums[5]],
      answer = a.filter((v) => v > 0).reduce((a, b) => a + b, 0);
    if (id === "ST-01")
      return code(
        `#include <stdio.h>\nint main() {\n    int amounts[6] = {${a.join(", ")}};\n    int total = 0;\n    for (int i = 0; i < 6; i++) {\n        if (amounts[i] > 0) total += amounts[i];\n    }\n    printf("%d\\n", total);\n    return 0;\n}`,
        answer,
        ["i", "amounts[i]", "total"],
        "Veyra Transit Authority logged fares and negative refunds. Total only positive fares.",
      );
    return debug(
      `amounts = [${a.join(", ")}]\ntotal = 0\nfor a in amounts:\n    if a != 0:\n        total += a\nprint(total)`,
      [
        {
          line: 4,
          correct: "if a > 0:",
          decoys: ["if a < 0:", "if a == 0:", "if a > 100:"],
        },
      ],
      ([ok]) =>
        String((ok ? a.filter((v) => v > 0) : a).reduce((a, b) => a + b, 0)),
      "The Transit clerk counts refunds as fares. Repair the condition; refunds must be excluded.",
    );
  }
  if (id === "SD-01") {
    const a = shuffle(Array.from({ length: 6 }, (_, i) => nums[0] + i * 7));
    const max = Math.max(...a);
    return code(
      `public class Main {\n    public static void main(String[] args) {\n        int[] r = {${a.join(", ")}};\n        int best = r[0], pos = 0;\n        for (int i = 1; i < r.length; i++) {\n            if (r[i] > best) { best = r[i]; pos = i; }\n        }\n        System.out.println("Peak " + best + " at " + pos);\n    }\n}`,
      `Peak ${max} at ${a.indexOf(max)}`,
      ["i", "r[i]", "best", "pos"],
      "The Power Grid needs its highest reading and zero-based position.",
    );
  }
  if (id === "SD-02") {
    const values = shuffle([2, 3, 4, 5].map((v) => v * 15 + rand(10)));
    const lone = 100 + rand(20),
      a = [...values, ...values, lone, lone + 1];
    return code(
      `packets = [${a.join(", ")}]\nfor p in packets:\n    if packets.count(p) == 1:\n        print(p)\n        break`,
      lone,
      ["p", "count"],
      "Every packet echoes twice except two strays. Report the first packet seen exactly once.",
    );
  }
  if (id === "SD-03") {
    const cmd = Array.from({ length: 9 }, () => "UDLR"[rand(4)]).join("");
    let x = 0,
      y = 0;
    for (const m of cmd) {
      x += m === "R" ? 1 : m === "L" ? -1 : 0;
      y += m === "U" ? 1 : m === "D" ? -1 : 0;
    }
    return code(
      `#include <stdio.h>\nint main() {\n    char cmd[] = "${cmd}";\n    int x = 0, y = 0;\n    for (int i = 0; cmd[i] != '\\0'; i++) {\n        switch (cmd[i]) {\n            case 'R': x++; break;\n            case 'L': x--; break;\n            case 'U': y++; break;\n            case 'D': y--; break;\n        }\n    }\n    printf("%d %d\\n", x, y);\n}`,
      `${x} ${y}`,
      ["i", "cmd[i]", "x", "y"],
      "A delivery robot starts at 0 0. U increases the puzzle's y; D decreases it. These are program coordinates, not city coordinates.",
    );
  }
  if (id === "SD-04") {
    const a = [1 + rand(5), 1 + rand(5), 0, 1 + rand(5), 1 + rand(5)];
    return debug(
      `#include <stdio.h>\nint main() {\n    int r[5] = {${a.join(", ")}};\n    int total = 0;\n    for (int i = 1; i < 5; i++) {\n        total = total + r[i];\n        printf("%d ", total);\n    }\n}`,
      [
        {
          line: 5,
          correct: "for (int i = 0; i < 5; i++) {",
          decoys: [
            "for (int i = 2; i < 5; i++) {",
            "for (int i = 0; i < 4; i++) {",
          ],
        },
        {
          line: 6,
          correct: "if (r[i] == 0) total = 0; else total += r[i];",
          decoys: [
            "total += r[i];",
            "if (r[i] == 0) total++; else total += r[i];",
          ],
        },
      ],
      ([start, reset]) => {
        let t = 0;
        return a
          .slice(start ? 0 : 1)
          .map((v) => {
            t = reset && v === 0 ? 0 : t + v;
            return t;
          })
          .join(" ");
      },
      "The meter must process every reading. A zero resets the running total. Repair two lines.",
    );
  }
  if (id === "SD-05") {
    const n = 5 + rand(5);
    return debug(
      `public class Main {\n    public static void main(String[] args) {\n        int posts = ${n}, count = 0;\n        for (int i = 1; i < posts; i++) {\n            System.out.println("Post " + i);\n            count++;\n        }\n        System.out.println("Total " + count);\n    }\n}`,
      [
        {
          line: 4,
          correct: "for (int i = 1; i <= posts; i++) {",
          decoys: [
            "for (int i = 1; i < posts - 1; i++) {",
            "for (int i = 1; i <= posts + 1; i++) {",
          ],
        },
      ],
      ([ok]) =>
        Array.from(
          { length: n - (ok ? 0 : 1) },
          (_, i) => `Post ${i + 1}`,
        ).join("\n") + `\nTotal ${n - (ok ? 0 : 1)}`,
      "Number every fence post, from 1 through the final post. Fix the missing endpoint.",
    );
  }
  if (id === "EX-03") {
    const limit = 30 + rand(25),
      a = [limit + 22, limit - 15, limit + 38, limit, limit + 11, limit + 33];
    return debug(
      `#include <stdio.h>\nint main() {\n    int v[6] = {${a.join(", ")}};\n    int count = 1, sum = 0;\n    for (int i = 0; i < 5; i++) {\n        if (v[i] >= ${limit}) {\n            count++; sum += v[i];\n        }\n    }\n    printf("%d %d\\n", count, sum);\n}`,
      [
        {
          line: 4,
          correct: "int count = 0, sum = 0;",
          decoys: ["int count = 2, sum = 0;", "int count = 1, sum = 1;"],
        },
        {
          line: 5,
          correct: "for (int i = 0; i < 6; i++) {",
          decoys: [
            "for (int i = 1; i < 6; i++) {",
            "for (int i = 0; i < 4; i++) {",
          ],
        },
        {
          line: 6,
          correct: `if (v[i] > ${limit}) {`,
          decoys: [`if (v[i] >= ${limit}) {`, `if (v[i] < ${limit}) {`],
        },
      ],
      ([zero, last, strict]) => {
        const chosen = a
          .slice(0, last ? 6 : 5)
          .filter((v) => (strict ? v > limit : v >= limit));
        return `${chosen.length + (zero ? 0 : 1)} ${chosen.reduce((a, b) => a + b, 0)}`;
      },
      `Count and sum all readings strictly above ${limit}. The first count, loop boundary, and comparison are each wrong.`,
    );
  }
  if (id === "RC-02") {
    const n = 5 + rand(8),
      py = `n = ${n}\ntotal = 0\nfor i in range(n):\n    total += i\nprint(total)`,
      c = `int n = ${n};\nint total = 0;\nfor (int i = 0; i < n; i++) {\n    total += i;\n}\nprintf("%d\\n", total);`,
      java = `int n = ${n};\nint total = 0;\nfor (int i = 0; i < n; i++) {\n    total += i;\n}\nSystem.out.println(total);`;
    return debug(
      py,
      [
        {
          line: 3,
          correct: "range(1, n + 1) / int i = 1; i <= n",
          decoys: [
            "range(1, n) / int i = 1; i < n",
            "range(n + 2) / int i = 0; i <= n + 1",
          ],
        },
      ],
      ([ok]) => String((n * (n + (ok ? 1 : -1))) / 2),
      "Sum every integer from 1 through n. Choose your language; the loop bug and line number are equivalent.",
      { Python: py, C: c, Java: java },
    );
  }
  if (id === "BR-08") {
    const limit = 4 + rand(4),
      g = Array.from({ length: 3 }, () =>
        Array.from({ length: 4 }, () => 1 + rand(10)),
      );
    g[1][2] = limit;
    return debug(
      `#include <stdio.h>\nint main() {\n    int g[3][4] = {${g.map((r) => `{${r.join(", ")}}`).join(", ")}};\n    int count = 0;\n    for (int r = 0; r < 3; r++) {\n        for (int c = 0; c < 4; c++) {\n            if (g[r][c] >= ${limit}) count++;\n        }\n        printf("%d ", count);\n    }\n}`,
      [
        {
          line: 4,
          correct:
            "Remove this declaration; add int count = 0; inside the row loop at line 5.",
          decoys: [
            "Set count = 1 outside the row loop.",
            "Keep count outside both loops.",
          ],
        },
        {
          line: 7,
          correct: `if (g[r][c] > ${limit}) count++;`,
          decoys: [
            `if (g[r][c] >= ${limit}) count++;`,
            `if (g[r][c] < ${limit}) count++;`,
          ],
        },
      ],
      ([reset, strict]) => {
        let n = 0;
        return g
          .map((r) => {
            if (reset) n = 0;
            n += r.filter((v) => (strict ? v > limit : v >= limit)).length;
            return n;
          })
          .join(" ");
      },
      `Print a fresh count for each row, including only values strictly above ${limit}. Repair the reset and comparison.`,
    );
  }
  if (id === "BL-05") {
    const costs = shuffle([
      30 + rand(10),
      15 + rand(8),
      55 + rand(10),
      70 + rand(10),
      90 + rand(10),
    ]);
    return debug(
      `costs = [${costs.join(", ")}]\nbest = 0\nbest_index = 0\nfor i in range(1, len(costs)):\n    if costs[i] > best:\n        best = costs[i]\nprint("Route", best_index + 1, "costs", best)`,
      [
        {
          line: 2,
          correct: "best = costs[0]",
          decoys: ["best = -1", "best = costs[-1]"],
        },
        {
          line: 5,
          correct: "if costs[i] < best:",
          decoys: ["if costs[i] > best:", "if costs[i] == best:"],
        },
        {
          line: 6,
          correct: "best = costs[i]; best_index = i",
          decoys: ["best = costs[i]", "best_index = 0"],
        },
      ],
      ([initial, comparison, index]) => {
        let best = initial ? costs[0] : 0,
          pos = 0;
        for (let i = 1; i < costs.length; i++)
          if (comparison ? costs[i] < best : costs[i] > best) {
            best = costs[i];
            if (index) pos = i;
          }
        return `Route ${pos + 1} costs ${best}`;
      },
      "Choose the cheapest route, saving its one-based printed route number. Repair three lines.",
    );
  }
  if (id === "RC-01")
    return code(
      `fares = [${nums.join(", ")}]\ntotal = 0\nfor f in fares:\n    total += f\nprint(total)`,
      nums.reduce((a, b) => a + b, 0),
      ["f", "total"],
      "Read the fare accumulator. Your race data is personal and equal in length to other entrants.",
    );
  if (id === "GH-03") {
    const states = Array.from({ length: 10 }, () => (rand(3) ? "UP" : "DOWN"));
    let best = 0,
      run = 0;
    for (const s of states) {
      run = s === "UP" ? run + 1 : 0;
      best = Math.max(best, run);
    }
    return code(
      `status = [${states.map((v) => `"${v}"`).join(", ")}]\nbest = 0\nrun = 0\nfor s in status:\n    if s == "UP":\n        run += 1\n        if run > best:\n            best = run\n    else:\n        run = 0\nprint(best)`,
      best,
      ["s", "run", "best"],
      "Find the longest uninterrupted streak of UP servers.",
    );
  }
  if (id === "BR-02") {
    const user = `agent${rand(20)}`,
      log = [user, "ana", user, "dev", user, "raj"],
      count = log.filter((n) => n === user).length;
    return code(
      `public class Main {\n    public static void main(String[] args) {\n        String[] log = {${shuffle(
        log,
      )
        .map((v) => `"${v}"`)
        .join(
          ", ",
        )}};\n        int count = 0;\n        for (int i = 0; i < log.length; i++) {\n            if (log[i].equals("${user}")) count++;\n        }\n        if (count >= 2) System.out.println("DOUBLE " + count);\n        else System.out.println("OK");\n    }\n}`,
      `DOUBLE ${count}`,
      ["i", "log[i]", "count"],
      `Bank monitoring flags repeated logins by ${user}. Read the printed result.`,
    );
  }
  if (id === "BL-01") {
    const moves = [nums[0], -nums[1], nums[2], -200, nums[4], -nums[5]];
    let total = 0;
    for (const m of moves) if (total + m >= 0) total += m;
    return code(
      `public class Main {\n    public static void main(String[] args) {\n        int[] moves = {${moves.join(", ")}};\n        int balance = 0;\n        for (int i = 0; i < moves.length; i++) {\n            if (balance + moves[i] >= 0) balance += moves[i];\n        }\n        System.out.println(balance);\n    }\n}`,
      total,
      ["i", "moves[i]", "balance"],
      "Apply ledger moves in order. Ignore a withdrawal that would make the balance negative.",
    );
  }
  if (["ST-03", "SD-08", "RC-03", "GH-01", "BR-03", "BL-02"].includes(id)) {
    const flags: Record<string, string> = {
      "ST-03": "GATE_OPEN",
      "SD-08": "LAYERS_PEEL",
      "RC-03": "SPRINT",
      "GH-01": "KEY_CARD_OK",
      "BR-03": "RELAY_RUN",
      "BL-02": "TRIPLE_LOCK",
    };
    const plain = `VEYRA{${flags[id]}_${suffix}}`,
      n = 1 + rand(12);
    let cipher = "",
      prompt = "";
    if (id === "ST-03") {
      cipher = shift(plain, n);
      prompt = `Header SHIFT: ${n}. Undo that forward Caesar shift.`;
    } else if (id === "BR-03") {
      cipher = relay(plain);
      prompt =
        "Each letter was shifted forward by its letter position, starting at 1. Count letters only; braces, digits and underscores stay. Undo the positional shifts.";
    } else if (id === "GH-01") {
      cipher = reverse(atbash(plain));
      prompt =
        "The keycard was encoded with Atbash, then reversed. Undo the wrapping.";
    } else if (id === "RC-03") {
      cipher = reverse(shift(plain, n));
      prompt = `The message was shifted forward ${n}, then reversed. Peel in reverse order.`;
    } else {
      cipher = reverse(atbash(shift(plain, n)));
      prompt = `The courier shifted forward ${n}, applied Atbash, then reversed. Undo these layers in reverse order.`;
    }
    return out(
      `${prompt}\nCiphertext: ${cipher}\nAlphabet: ABCDEFGHIJKLMNOPQRSTUVWXYZ. Atbash pairs A/Z, B/Y, C/X. Submit the full VEYRA flag.`,
      plain,
      { kind: "cipher", ciphertext: cipher },
      "Decide the decoding steps and their order using the cipher bench.",
      "Veyra Cipher Desk",
    );
  }
  if (id === "SD-06") {
    const words = [
        "anchor",
        "basket",
        "candle",
        "copper",
        "dagger",
        "ember",
        "falcon",
        "garnet",
        "harbor",
        "island",
        "jacket",
        "kettle",
        "lantern",
        "marble",
        "needle",
        "orchid",
        "paddle",
        "quartz",
        "ribbon",
        "saddle",
        "timber",
        "uplink",
        "velvet",
        "walnut",
        "yonder",
        "zephyr",
        "bridge",
        "cobalt",
        "drift",
        "flint",
      ],
      word = words[rand(words.length)];
    return out(
      `The manifest contains 30 candidates. Find the unique word satisfying every clue; submit VEYRA{word}.`,
      `VEYRA{${word}}`,
      {
        kind: "deduction",
        candidates: shuffle(words),
        clues: [
          `Length is ${word.length}.`,
          `First letter is ${word[0]}.`,
          `Second letter is ${word[1]}.`,
          `Last letter is ${word.at(-1)}.`,
        ],
      },
      "Strike out candidates and tick the clues you have checked.",
      "Black Grid Customs Office",
    );
  }
  if (id === "SD-07" || id === "BR-04") {
    const logs: string[] = [],
      target = id === "SD-07" ? `agent_${suffix}` : `S-${suffix}`;
    for (let i = 0; i < 25; i++) {
      const user = `clerk_${i}`,
        ip = `198.51.100.${i + 1}`;
      logs.push(
        `02:${String(i).padStart(2, "0")}:00 LOGIN OK user=${user} ip=${ip} session=N-${i}`,
        `02:${String(i).padStart(2, "0")}:30 LOGOUT user=${user} ip=${ip} session=N-${i}`,
      );
    }
    if (id === "SD-07") {
      logs.splice(0, 6);
      for (let i = 0; i < 6; i++)
        logs.push(
          `02:13:${String(i * 8).padStart(2, "0")} LOGIN FAIL user=${target} ip=203.0.113.7`,
        );
      logs.push(
        `01:00:00 LOGIN OK user=${target} ip=198.51.100.77`,
        `02:14:15 LOGIN OK user=${target} ip=203.0.113.7`,
      );
      for (let i = 0; i < 5; i++)
        logs.push(
          `02:20:${String(i * 8).padStart(2, "0")} LOGIN FAIL user=locked_decoy ip=203.0.113.8`,
        );
      logs.push(
        `02:31:00 LOGIN FAIL user=usual_decoy ip=198.51.100.9`,
        `02:31:20 LOGIN OK user=usual_decoy ip=198.51.100.9`,
      );
    } else
      logs.push(
        `03:12:00 LOGIN user=omar session=${target}`,
        `03:14:00 ACTION user=omar session=${target} export_records`,
        `03:15:00 ACTION user=omar session=${target} inspect_audit`,
      );
    return out(
      id === "SD-07"
        ? "Find the account with at least five failures followed within two minutes by a successful login from a NEW IP. Use the earlier logins to establish its usual IP. Submit VEYRA{account}."
        : "Find the session active after 03:00 that never logged out. Submit VEYRA{session}.",
      `VEYRA{${target}}`,
      { kind: "logs", logs: logs.sort() },
      "Search, filter, and pin evidence before submitting.",
      "Harbor Security Desk",
    );
  }
  if (id === "EX-04" || id === "BL-04") {
    const key = 3 + rand(18),
      steps =
        id === "EX-04"
          ? [
              { multiply: 3, add: 8, divide: 2 },
              { multiply: 1, add: -5, divide: 1 },
            ]
          : Array.from({ length: 3 }, () => ({
              multiply: 2,
              add: -1,
              divide: 1,
            })),
      run = (x: number) =>
        steps.reduce((v, s) => (v * s.multiply + s.add) / s.divide, x),
      target = run(key);
    const challenge = out(
      `Find the starting number that produces ${target}. The machine shows every operation. You may test any input up to five times.`,
      key,
      { kind: "machine", steps, target },
      "Work backwards through the machine.",
      "Black Grid Gatekeeper",
    );
    challenge.success = `Vault accepted. VEYRA{${id === "EX-04" ? "GATEKEEPER" : "WARDEN_DOWN"}_${suffix}}`;
    return challenge;
  }
  if (id === "EX-05") {
    const words = shuffle(
        ["VAULT", "TRACE", "BADGE", "GATES"].map((word) => word),
      )[0],
      fragments: Record<string, string> = {
        V: "Vault hours are posted at reception.",
        A: "All tellers wear blue badges.",
        U: "Updates ship on Fridays.",
        L: "Lost cards go to the front desk.",
        T: "Tea is served in the lobby.",
        R: "Reports are reviewed at noon.",
        C: "Couriers use the side entrance.",
        E: "Every terminal has a local log.",
        B: "Bank doors close after sunset.",
        D: "Deliveries arrive before lunch.",
        G: "Guards rotate every hour.",
        S: "Staff gather in the atrium.",
      };
    const c = out(
      "TRAINING SANDBOX — not a real login. The staff notice board hides a password in plain sight. Use the mock portal to log in as admin.",
      `admin:${words}`,
      { kind: "portal", notices: [...words].map((c) => fragments[c]) },
      "Inspect the notices and enter the mock administrator credentials.",
      "Mock Veyra Bank Portal",
    );
    c.validate = (input) => norm(input) === `ADMIN:${words}`;
    c.success = `Mock portal unlocked. VEYRA{FIRST_LETTERS_${suffix}}`;
    return c;
  }
  if (["EX-01", "BG-02", "BR-01"].includes(id)) {
    let grid =
      id === "EX-01"
        ? ["S..#..", ".#.#.#", ".#K...", ".###D#", ".#....", "####.E"]
        : id === "BG-02"
          ? ["S.#..", ".#K#.", "...D.", "##.#E"]
          : ["S.1#2..", ".######", "..1.2.E"];
    if (rand(2)) grid = grid.map((r) => reverse(r));
    const answer = shortestMaze(grid),
      shortest = id !== "BG-02",
      c = out(
        "Move the token from S to E. Walls (#) block you. Pick up K before entering D. Matching digit pads allow a one-step teleport (T)." +
          (shortest
            ? " Reach E in the fewest possible moves."
            : " Any valid route to E is accepted."),
        answer,
        { kind: "maze", grid, shortest },
        "Steer the token; submit the recorded route.",
        "Veyra Vault Services",
      );
    c.validate = (input) => {
      const run = walkMaze(grid, input);
      return run.ok && (!shortest || run.steps === answer.length);
    };
    return c;
  }
  if (id === "EX-02" || id === "BR-05") {
    const nodes = shuffle([
        "Asha",
        "Bimal",
        "Chitra",
        "Dev",
        "Esha",
        "Farid",
        "Gita",
        "Hari",
        "Isha",
      ]),
      pairs = [
        [0, 1],
        [0, 2],
        [1, 3],
        [1, 4],
        [2, 5],
        [3, 6],
        [3, 7],
        [5, 8],
      ],
      edges = pairs.map(([a, b]) => [nodes[a], nodes[b]] as [string, string]);
    if (id === "BR-05")
      return out(
        `Find the nearest shared boss of ${nodes[6]} and ${nodes[4]}. Arrows point from manager to direct report.`,
        nodes[1],
        { kind: "tree", nodes, edges, selected: [nodes[6], nodes[4]] },
        "Tap the shared manager.",
        "Veyra Staffing Office",
      );
    let max = 0,
      best: [string, string] = [nodes[0], nodes[1]];
    for (const a of nodes)
      for (const b of nodes) {
        const d = hops(nodes, edges, a, b);
        if (d > max) {
          max = d;
          best = [a, b];
        }
      }
    const c = out(
      "Tap two employees separated by the longest chain of reporting links. Links may be followed in either direction; more than one tied pair may be valid.",
      best.join(","),
      { kind: "tree", nodes, edges },
      "Select both ends of the longest chain.",
      "Veyra Staffing Office",
    );
    c.validate = (input) => {
      const p = input.split(/[,\s]+/).filter(Boolean);
      return (
        p.length === 2 &&
        nodes.includes(p[0]) &&
        nodes.includes(p[1]) &&
        hops(nodes, edges, p[0], p[1]) === max
      );
    };
    return c;
  }
  if (id === "SD-09") {
    const presses = shuffle(Array.from({ length: 9 }, (_, i) => i)).slice(0, 3);
    let lights = Array(9).fill(0);
    for (const n of presses) lights = toggleLights(lights, n);
    const c = out(
      "The turnstile lights are jammed. A press toggles that light and its orthogonal neighbours. Turn all nine off.",
      presses.join(","),
      { kind: "lights", lights },
      "Tap the light panel until every lamp is off.",
      "Veyra Transit Authority",
    );
    c.validate = (input) => {
      let b = lights.slice();
      const ns = input.split(",").filter(Boolean).map(Number);
      if (
        !ns.length ||
        ns.length > 40 ||
        ns.some((n) => !Number.isInteger(n) || n < 0 || n > 8)
      )
        return false;
      for (const n of ns) b = toggleLights(b, n);
      return b.every((v) => !v);
    };
    return c;
  }
  if (id === "SD-10") {
    const n = shuffle(["Aman", "Bela", "Chitra", "Dev"]);
    return out(
      "Exactly one statement is false. Select the thief.",
      n[1],
      {
        kind: "statements",
        candidates: n,
        clues: [
          `${n[0]} says: ${n[1]} did it.`,
          `${n[1]} says: ${n[2]} did it.`,
          `${n[2]} says: ${n[1]} is lying.`,
          `${n[3]} says: I did not do it.`,
        ],
      },
      "Check each suspect against all four statements.",
      "Veyra Fraud Desk",
    );
  }
  if (id === "BG-01" || id === "GH-02") {
    const answer =
        id === "BG-01"
          ? shuffle([..."0123456789"])
              .slice(0, 3)
              .join("")
          : String(1 + rand(100)),
      c = out(
        id === "BG-01"
          ? "Guess the three-digit door code. Digits are distinct; a leading zero is allowed. Each guess reports exact and misplaced digits. Nine guesses, then the alarm."
          : "The courier knows a number from 1 to 100. Ask up to eight guesses; each reply says higher or lower. Find the number before the lock ends.",
        answer,
        {
          kind: id === "BG-01" ? "oracle" : "courier",
          maxGuesses: id === "BG-01" ? 9 : 8,
        },
        "Use feedback to narrow the possibilities.",
        id === "BG-01" ? "Home Door Keypad" : "NEXUS Courier",
      );
    c.oracle = (input) =>
      id === "BG-01"
        ? /^\d{3}$/.test(input) && distinct(input)
          ? digitFeedback(answer, input)
          : "Enter three different digits."
        : /^\d+$/.test(input) && Number(input) >= 1 && Number(input) <= 100
          ? Number(input) < Number(answer)
            ? "Higher"
            : Number(input) > Number(answer)
              ? "Lower"
              : "Correct"
          : "Enter a whole number from 1 to 100.";
    return c;
  }
  if (id === "BG-03") {
    const switches = shuffle([..."ABCDEF"]),
      [a, b, c1, d, e, f] = switches;
    const c = out(
      `G1 = ${a} AND ${b}; G2 = ${c1} OR ${d}; G3 = G1 XOR G2; G4 = ${e} OR ${f}; OUTPUT = G3 AND G4. Turn on the output lamp.`,
      `${c1},${e}`,
      { kind: "circuit", switches },
      "Toggle the fuse-box switches and submit a lit output.",
      "Home Fuse Box",
    );
    c.validate = (input) => {
      // Splitting untrimmed input yields empty tokens at the ends, which fail
      // the single-letter guard below and reject an otherwise correct answer.
      const active = new Set(
        input.trim().toUpperCase().split(/[\s,]+/).filter(Boolean),
      );
      if ([...active].some((n) => !"ABCDEF".includes(n) || n.length !== 1))
        return false;
      return (
        (active.has(a) && active.has(b)) !==
          (active.has(c1) || active.has(d)) &&
        (active.has(e) || active.has(f))
      );
    };
    return c;
  }
  if (id === "BR-06") {
    const map = shuffle([..."0123456789"]),
      convert = (s: string) => [...s].map((d) => map[Number(d)]).join(""),
      key = convert("4719"),
      guesses = ["7314", "9081", "7509", "7308", "8234"].map(convert),
      c = out(
        "Find the four-digit key with different digits. Each clue gives exact and misplaced digits. Leading zero is allowed. Submit the four digits or VEYRA{digits}.",
        key,
        {
          kind: "deduction",
          candidates: [..."0123456789"],
          clues: guesses.map((g) => `${g}: ${digitFeedback(key, g)}`),
        },
        "Use the digit board to reconcile every clue.",
        "Bank Combination Desk",
      );
    c.validate = (input) =>
      norm(input) === key || norm(input) === `VEYRA{${key}}`;
    return c;
  }
  if (id === "BR-07") {
    const baseKeys = [
        "2031",
        "2041",
        "2051",
        "2061",
        "2071",
        "6293",
        "8094",
        "8194",
        "8294",
        "8394",
      ],
      key = baseKeys[rand(baseKeys.length)],
      map = shuffle([..."0123456789"]),
      encoded = [...key].map((v) => map[Number(v)]).join(""),
      sum = [...key].reduce((a, b) => a + Number(b), 0);
    const c = out(
      `The vault encodes each true digit using the supplied lookup. Work out the TRUE four-digit key, then translate each digit into its SHOWN digit before submitting. True digits are distinct. First is double the last, second is the smallest, third is greater than first, and their sum is ${sum}. Lookup TRUE → SHOWN: ${map.map((v, i) => `${i}→${v}`).join(", ")}. Submit the encoded key or VEYRA{encoded_key}.`,
      encoded,
      {
        kind: "deduction",
        candidates: [..."0123456789"],
        clues: [
          "First = 2 × last",
          "Second is the smallest",
          "Third > first",
          `Sum = ${sum}`,
          "All digits distinct",
          `Encode using ${map.map((v, i) => `${i}→${v}`).join(", ")}`,
        ],
      },
      "Fill the four digit slots and check every condition.",
      "Self-Checking Vault",
    );
    c.validate = (input) =>
      [encoded, `VEYRA{${encoded}}`].includes(norm(input));
    return c;
  }
  if (id === "BR-09") {
    const nodes = shuffle([..."ABCDEF"]),
      base = [
        [1, 0],
        [2, 0],
        [4, 2],
        [3, 5],
        [1, 3],
        [4, 1],
      ],
      edges = base.map(([a, b]) => [nodes[a], nodes[b]] as [string, string]),
      remaining = new Set(nodes),
      result: string[] = [];
    while (remaining.size) {
      const ready = [...remaining]
        .filter((n) => !edges.some(([a, b]) => b === n && remaining.has(a)))
        .sort()[0];
      if (!ready) throw new Error("Invalid order");
      result.push(ready);
      remaining.delete(ready);
    }
    const c = out(
      "Arrange deployment tasks. An arrow A → B means A must precede B. Whenever several tasks are ready, take the alphabetically earliest.",
      result.join(","),
      { kind: "order", nodes, edges },
      "Arrange all six tasks in the smallest valid order.",
      "Veyra Deploy Desk",
    );
    c.validate = (input) =>
      input.toUpperCase().replace(/[\s,]/g, "") === result.join("");
    return c;
  }
  if (id === "BR-10") {
    const names = shuffle([..."ABCDEF"]),
      [a, b, c, d, e, f] = names,
      solution = [3, 1, 5, 2, 6, 4],
      answer = names.map((n, i) => `${n}=${solution[i]}`).join(","),
      challenge = out(
        "Give every variable a different number from 1 to 6 so all eight conditions hold.",
        answer,
        {
          kind: "constraints",
          nodes: names,
          clues: [
            `${a} > ${b}`,
            `${c} is odd`,
            `${d} + ${b} = ${a}`,
            `${e} > ${c}`,
            `${f} is even`,
            `abs(${a} - ${f}) = 1`,
            `${c} > ${a}`,
            `${b} is odd`,
          ],
        },
        "Fill the constraint board and submit the assignments.",
        "Bank Constraint Vault",
      );
    challenge.validate = (input) => {
      // Trimmed and filtered: an empty token from surrounding whitespace would
      // otherwise count as a seventh assignment and fail the length check.
      const assignments = Object.fromEntries(
        input
          .trim()
          .toUpperCase()
          .split(/[,\s]+/)
          .filter(Boolean)
          .map((s) => s.split("=")),
      );
      return (
        Object.keys(assignments).length === 6 &&
        names.every((n, i) => Number(assignments[n]) === solution[i])
      );
    };
    return challenge;
  }
  if (id === "BL-03") {
    const nodes = shuffle([..."ABCDEF"]),
      edges = [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 1],
        [2, 4],
        [4, 5],
      ].map(([a, b]) => [nodes[a], nodes[b]] as [string, string]),
      ring = nodes.slice(1, 4),
      c = out(
        "Follow the payment arrows. Select the accounts forming the only closed loop.",
        ring.join(","),
        { kind: "ring", nodes, edges },
        "Tap the accounts belonging to the shadow ring.",
        "Black Ledger Investigations",
      );
    c.validate = (input) => {
      const ns = input
        .toUpperCase()
        .split(/[\s,]+/)
        .filter(Boolean);
      return (
        new Set(ns).size === 3 &&
        ns.length === 3 &&
        ring.every((n) => ns.includes(n))
      );
    };
    return c;
  }
  throw new Error(`Missing final challenge implementation: ${id}`);
}
