import type { ChallengeView } from "@heist/shared";

/** Independent player logic: only public ChallengeView evidence, never server generators/seeds. */
export function solvePublicChallenge(c: ChallengeView): string {
  const id = c.title.split(" · ")[0],
    w = c.workbench;
  if (!w) throw new Error(`Locked/missing evidence: ${id}`);
  const array = () => {
    const match = w.code?.match(/(?:=\s*\[|=\s*\{)([-\d,\s]+)[\]}]/);
    if (!match) throw new Error(`Unreadable public numeric array: ${id}`);
    return match[1].split(",").map(Number);
  };
  if (w.kind === "code") {
    if (id === "ST-01")
      return String(
        array()
          .filter((n) => n > 0)
          .reduce((a, b) => a + b, 0),
      );
    if (id === "SD-01") {
      const values = array(),
        peak = Math.max(...values);
      return `Peak ${peak} at ${values.indexOf(peak)}`;
    }
    if (id === "SD-02") {
      const values = array();
      return String(
        values.find((n) => values.filter((v) => v === n).length === 1),
      );
    }
    if (id === "SD-03") {
      const commands = w.code!.match(/cmd\[\]\s*=\s*"([UDLR]+)"/)?.[1];
      if (!commands) throw new Error("Missing robot commands");
      let x = 0,
        y = 0;
      for (const m of commands) {
        x += m === "R" ? 1 : m === "L" ? -1 : 0;
        y += m === "U" ? 1 : m === "D" ? -1 : 0;
      }
      return `${x} ${y}`;
    }
    if (id === "RC-01") return String(array().reduce((a, b) => a + b, 0));
    if (id === "GH-03") {
      const data = w.code!.match(/status = \[([^\]]+)\]/)?.[1];
      if (!data) throw new Error("Missing server status array");
      const states = [...data.matchAll(/"(UP|DOWN)"/g)].map((m) => m[1]);
      let run = 0,
        best = 0;
      for (const state of states) {
        run = state === "UP" ? run + 1 : 0;
        best = Math.max(best, run);
      }
      return String(best);
    }
  }
  if (w.kind === "debug") {
    const patterns: Record<string, RegExp[]> = {
      "ST-02": [/^if a > 0:/],
      "SD-04": [/i = 0; i < 5;/, /r\[i\] == 0\) total = 0; else total \+=/],
      "SD-05": [/i = 1; i <= posts;/],
      "EX-03": [/count = 0, sum = 0/, /i = 0; i < 6;/, /if \(v\[i\] > \d+\)/],
      "RC-02": [/range\(1, n \+ 1\)/],
    };
    const expected = patterns[id];
    if (!expected || !w.fixes || expected.length !== w.fixes.length)
      throw new Error(`Unsupported repair evidence: ${id}`);
    return w.fixes
      .map((row, i) => {
        const chosen = row.options.findIndex((s) => expected[i].test(s));
        if (chosen < 0) throw new Error(`No repair for line ${row.line}`);
        return `${row.line}:${chosen}`;
      })
      .join(",");
  }
  if (w.kind === "cipher") {
    let text = w.ciphertext!;
    const shift = (n: number) => {
      text = text.replace(/[a-z]/gi, (c) =>
        String.fromCharCode(
          65 + ((((c.toUpperCase().charCodeAt(0) - 65 + n) % 26) + 26) % 26),
        ),
      );
    };
    const n = Number(
      c.prompt.match(/(?:SHIFT:\s*|shifted forward\s+)(\d+)/i)?.[1],
    );
    if (id === "ST-03") {
      if (!n) throw new Error("Missing shift");
      shift(-n);
    } else {
      text = [...text].reverse().join("");
      if (id !== "RC-03")
        text = text.replace(/[a-z]/gi, (c) =>
          String.fromCharCode(90 - (c.toUpperCase().charCodeAt(0) - 65)),
        );
      if (id !== "GH-01") {
        if (!n) throw new Error("Missing shift");
        shift(-n);
      }
    }
    return text;
  }
  if (id === "SD-06" && w.candidates && w.clues) {
    const [len, first, second, last] = w.clues.map(
      (s) => s.match(/is (\w+)/)?.[1],
    );
    const options = w.candidates.filter(
      (s) =>
        s.length === Number(len) &&
        s[0] === first &&
        s[1] === second &&
        s.at(-1) === last,
    );
    if (options.length !== 1) throw new Error("Nonunique manifest evidence");
    return `VEYRA{${options[0]}}`;
  }
  if (w.kind === "machine" && w.steps && w.target !== undefined) {
    return String(
      [...w.steps]
        .reverse()
        .reduce((v, s) => (v * s.divide - s.add) / s.multiply, w.target),
    );
  }
  if (w.kind === "portal" && w.notices)
    return `admin:${w.notices.map((n) => n[0]).join("")}`;
  if (w.kind === "maze" && w.grid) return solveMaze(w.grid);
  if (w.kind === "lights" && w.lights) {
    for (let mask = 0; mask < 512; mask++) {
      const board = w.lights.slice(),
        moves: number[] = [];
      for (let i = 0; i < 9; i++)
        if (mask & (1 << i)) {
          moves.push(i);
          for (const p of [
            i,
            i - 3,
            i + 3,
            ...(i % 3 ? [i - 1] : []),
            ...(i % 3 < 2 ? [i + 1] : []),
          ])
            if (p >= 0 && p < 9) board[p] ^= 1;
        }
      if (board.every((n) => n === 0)) return moves.join(",");
    }
    throw new Error("Unsolvable public lights");
  }
  if (id === "SD-07" && w.logs) {
    const users = new Set(
      w.logs.map((l) => l.match(/user=(\w+)/)?.[1]).filter(Boolean),
    );
    const seconds = (l: string) => {
      const [h, m, s] = l.split(" ")[0].split(":").map(Number);
      return h * 3600 + m * 60 + s;
    };
    for (const user of users) {
      const lines = w.logs.filter((l) => l.includes(`user=${user} `));
      for (const success of lines.filter((l) => l.includes("LOGIN OK"))) {
        const ip = success.match(/ip=([\d.]+)/)?.[1],
          t = seconds(success);
        const failures = lines.filter(
          (l) =>
            l.includes("LOGIN FAIL") &&
            l.includes(`ip=${ip}`) &&
            seconds(l) <= t &&
            t - seconds(l) <= 120,
        );
        const previous = lines.filter(
          (l) =>
            l.includes("LOGIN OK") && seconds(l) < t && !l.includes(`ip=${ip}`),
        );
        if (failures.length >= 5 && previous.length) return `VEYRA{${user}}`;
      }
    }
    throw new Error("No matching log evidence");
  }
  if (id === "SD-10") {
    // Public statement board gives named assertions; enumerate each possible culprit.
    const clues = w.clues ?? [];
    const names = w.candidates ?? w.nodes ?? [];
    for (const name of names) {
      const truth = clues.map((s) => {
        const [speaker, claim] = s.split(" says: ");
        const positive = claim?.match(/^(\w+) did it\./);
        if (positive) return name === positive[1];
        if (claim === "I did not do it.") return name !== speaker;
        const lying = claim?.match(/^(\w+) is lying\./);
        if (lying) {
          const target = clues
            .find((c) => c.startsWith(`${lying[1]} says: `))
            ?.match(/says: (\w+) did it\./);
          if (target) return name !== target[1];
        }
        throw new Error("Unreadable statement");
      });
      if (truth.filter(Boolean).length === clues.length - 1) return name;
    }
  }
  if (id === "EX-02" && w.nodes && w.edges) {
    let best = -1,
      pair = "";
    for (const a of w.nodes)
      for (const b of w.nodes) {
        const q: [string, number][] = [[a, 0]],
          seen = new Set([a]);
        for (let at = 0; at < q.length; at++) {
          const [node, d] = q[at];
          if (node === b && d > best) {
            best = d;
            pair = `${a},${b}`;
          }
          for (const [x, y] of w.edges) {
            const next = x === node ? y : y === node ? x : undefined;
            if (next && !seen.has(next)) {
              seen.add(next);
              q.push([next, d + 1]);
            }
          }
        }
      }
    if (best >= 0) return pair;
  }
  throw new Error(`Unsupported public puzzle: ${id} (${w.kind})`);
}

/** Puzzle-only BFS, not a world collision/step reimplementation. */
function solveMaze(grid: string[]) {
  const states: { x: number; y: number; key: boolean; route: string }[] = [];
  grid.forEach((row, y) => {
    const x = row.indexOf("S");
    if (x >= 0) states.push({ x, y, key: false, route: "" });
  });
  const seen = new Set<string>();
  for (let at = 0; at < states.length; at++) {
    const p = states[at];
    if (grid[p.y][p.x] === "E") return p.route;
    for (const [move, dx, dy] of [
      ["U", 0, -1],
      ["D", 0, 1],
      ["L", -1, 0],
      ["R", 1, 0],
      ["T", 0, 0],
    ] as const) {
      let x = p.x + dx,
        y = p.y + dy;
      if (move === "T") {
        const pad = grid[p.y][p.x];
        if (!/\d/.test(pad)) continue;
        const other = grid.flatMap((row, ry) =>
          [...row].flatMap((c, rx) =>
            c === pad && (rx !== p.x || ry !== p.y) ? [{ x: rx, y: ry }] : [],
          ),
        )[0];
        if (!other) continue;
        ({ x, y } = other);
      }
      const cell = grid[y]?.[x];
      if (!cell || cell === "#" || (cell === "D" && !p.key)) continue;
      const key = p.key || cell === "K",
        stamp = `${x},${y},${key}`;
      if (seen.has(stamp)) continue;
      seen.add(stamp);
      states.push({ x, y, key, route: p.route + move });
    }
  }
  throw new Error("No public maze route");
}
