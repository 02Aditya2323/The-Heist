import type { ChallengeView, EventRequest } from "@heist/shared";
import { terminalIcon } from "./terminal-cards.js";
import {
  WORKBENCH_DESIGN,
  codeTokens,
  challengeGate,
} from "./workbench-design.js";

type Draft = {
  fingerprint?: string;
  language?: string;
  values?: Record<string, string>;
  history?: string[];
  notes: string;
  marked: number[];
  trace: string[][];
  fixes: Record<string, string>;
  cipher: string;
  query: string;
  pins: string[];
  selected: string[];
  route: string;
  presses: number[];
  switches: string[];
  order: string[];
  assignments: Record<string, string>;
  guesses: string[];
};
const drafts = new Map<string, Draft>();
try {
  const saved = JSON.parse(
    sessionStorage.getItem("heist-workbench-drafts") || "[]",
  ) as [string, Draft][];
  if (Array.isArray(saved))
    for (const [id, draft] of saved.slice(-60))
      if (typeof id === "string" && draft && typeof draft.notes === "string")
        drafts.set(id, draft);
} catch {}
const saveDrafts = () => {
  try {
    sessionStorage.setItem(
      "heist-workbench-drafts",
      JSON.stringify([...drafts].slice(-60)),
    );
  } catch {}
};
const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = "",
  cls = "",
) => {
  const n = document.createElement(tag);
  n.textContent = text;
  if (cls) n.className = cls;
  return n;
};
const button = (text: string, fn: () => void) => {
  const b = el("button", text, "bench-button");
  b.type = "button";
  b.addEventListener("click", fn);
  return b;
};
const labelled = (label: string, input: HTMLElement) => {
  const l = el("label", label);
  l.append(input);
  return l;
};
const input = (label: string, value = "", type = "text") => {
  const n = el("input");
  n.type = type;
  n.value = value;
  n.setAttribute("aria-label", label);
  return n;
};
const shift = (s: string, n: number) =>
  s.replace(/[a-z]/gi, (c) =>
    String.fromCharCode(
      ((c.toUpperCase().charCodeAt(0) - 65 + (n % 26) + 26) % 26) + 65,
    ),
  );
const atbash = (s: string) =>
  s.replace(/[a-z]/gi, (c) =>
    String.fromCharCode(90 - (c.toUpperCase().charCodeAt(0) - 65)),
  );

/** Arithmetic only. Never executes user-entered JavaScript or submitted code. */
export function calculateExpression(text: string): number {
  text = text.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-");
  if (text.length > 150 || !/^[\d\s.+\-*/()]+$/.test(text))
    throw new Error("Use numbers, parentheses, +, −, × and ÷.");
  const tokens = text.match(/\d+(?:\.\d*)?|\.\d+|[()+\-*/]/g) || [];
  let at = 0;
  const factor = (): number => {
    const t = tokens[at++];
    if (t === "+" || t === "-") return (t === "-" ? -1 : 1) * factor();
    if (t === "(") {
      const v = sum();
      if (tokens[at++] !== ")") throw new Error("Close the parenthesis.");
      return v;
    }
    if (t === undefined || !/^(\d|\.)/.test(t))
      throw new Error("Expected a number.");
    return Number(t);
  };
  const product = (): number => {
    let n = factor();
    while (tokens[at] === "*" || tokens[at] === "/") {
      const op = tokens[at++],
        v = factor();
      n = op === "*" ? n * v : n / v;
    }
    return n;
  };
  const sum = (): number => {
    let n = product();
    while (tokens[at] === "+" || tokens[at] === "-") {
      const op = tokens[at++],
        v = product();
      n = op === "+" ? n + v : n - v;
    }
    return n;
  };
  const result = sum();
  if (at !== tokens.length || !Number.isFinite(result))
    throw new Error("Check the expression; division by zero is not allowed.");
  return result;
}
export function createWorkbench(
  c: ChallengeView,
  send: (request: EventRequest) => void,
  onAnswer: (answer: string) => void,
  serverTime: number,
  readOnly = false,
): HTMLElement {
  const w = c.workbench!,
    root = el("section", "", "challenge-workbench");
  root.dataset.kind = w.kind;
  const design = WORKBENCH_DESIGN[w.kind];
  root.setAttribute("aria-label", design.title);
  const serverButton = (text: string, action: () => void) => {
    const control = button(text, action);
    control.disabled =
      readOnly ||
      c.expiresAt <= serverTime ||
      (c.blockedUntil || 0) > serverTime;
    return control;
  };
  const fingerprint = JSON.stringify([c.prompt, w]);
  let state = drafts.get(c.id);
  if (state?.fingerprint && state.fingerprint !== fingerprint)
    state = undefined;
  if (!state) {
    state = {
      fingerprint,
      notes: "",
      marked: [],
      trace: [],
      fixes: {},
      cipher: w.ciphertext || "",
      query: "",
      pins: [],
      selected: [],
      route: "",
      presses: [],
      switches: [],
      order: w.nodes?.slice() || [],
      assignments: {},
      guesses: [],
    };
    drafts.set(c.id, state);
    if (drafts.size > 80) drafts.delete(drafts.keys().next().value!);
  }
  const d = state;
  d.fingerprint = fingerprint;
  d.values ||= {};
  d.history ||= [];
  // Keep notes and local tool state through re-renders without touching server authority.
  root.addEventListener("input", saveDrafts);
  root.addEventListener("change", saveDrafts);
  root.addEventListener("click", saveDrafts);
  const emitAnswer = onAnswer;
  onAnswer = (answer) => {
    saveDrafts();
    emitAnswer(answer);
  };
  const header = el("header", "", "bench-header"),
    emblem = el("span", "", "bench-emblem"),
    heading = el("div");
  emblem.append(terminalIcon(design.icon));
  heading.append(
    el(
      "small",
      `INTERACTIVE FIELD TOOL / ${w.kind.toUpperCase()}`,
      "bench-kicker",
    ),
    el("h4", design.title),
    el("p", design.instruction),
  );
  header.append(emblem, heading);
  const steps = el("ol", "", "bench-workflow");
  design.steps.forEach((step, i) => {
    const item = el("li");
    item.append(el("span", String(i + 1).padStart(2, "0")), el("b", step));
    steps.append(item);
  });
  root.append(header, steps);
  const main = el("div", "", "bench-main");
  root.append(main);
  const feedback = el("output", c.feedback || "", "bench-feedback");
  feedback.setAttribute("role", "status");
  feedback.setAttribute("aria-label", "Server feedback");
  if (c.feedback) main.append(feedback);
  if (w.kind === "code" || w.kind === "debug") {
    const panel = el("div", "", "code-panel"),
      selection = el("div", "", "code-lines");
    const chrome = el("div", "", "code-chrome");
    chrome.append(
      el("span", "SOURCE / READ ONLY"),
      el("span", w.language || "PROGRAM"),
    );
    panel.append(chrome);
    let currentCode = w.code || "Read the original briefing above.";
    const renderCode = (code: string) => {
      currentCode = code;
      if (chrome.lastElementChild)
        chrome.lastElementChild.textContent =
          d.language || w.language || "PROGRAM";
      selection.replaceChildren();
      const lines = code.split("\n");
      for (const fix of w.fixes || []) {
        const chosen = d.fixes[fix.line];
        if (chosen === undefined || chosen === "") continue;
        let replacement = fix.options[Number(chosen)];
        if (!replacement) continue;
        if (w.languages && fix.line === 3) {
          const pieces = replacement.split(" / ");
          replacement = code.startsWith("n =")
            ? `for i in ${pieces[0]}:`
            : `for (${pieces[1]}; i++) {`;
        }
        if (replacement.includes("inside the row loop")) {
          lines[fix.line - 1] =
            "    // Counter resets at the start of each row";
          lines[4] += " int count = 0;";
          continue;
        }
        const indent = lines[fix.line - 1]?.match(/^\s*/)?.[0] || "";
        lines[fix.line - 1] = indent + replacement;
      }
      lines.forEach((line, i) => {
        const b = button("", () => {
          const index = d.marked.indexOf(i + 1);
          if (index >= 0) d.marked.splice(index, 1);
          else d.marked.push(i + 1);
          b.setAttribute("aria-pressed", String(d.marked.includes(i + 1)));
        });
        b.className = "code-line";
        b.setAttribute("aria-label", `Line ${i + 1}: ${line}`);
        b.setAttribute("aria-pressed", String(d.marked.includes(i + 1)));
        const source = el("code");
        for (const token of codeTokens(line || " "))
          source.append(el("span", token.text, `syntax-${token.kind}`));
        b.append(el("span", String(i + 1), "line-number"), source);
        selection.append(b);
      });
    };
    if (w.languages) {
      const select = el("select");
      select.setAttribute("aria-label", "Code language");
      for (const lang of Object.keys(w.languages)) {
        const opt = el("option", lang);
        opt.value = lang;
        select.append(opt);
      }
      select.addEventListener("change", () => {
        d.language = select.value;
        renderCode(w.languages![select.value]);
      });
      select.value =
        d.language && w.languages[d.language]
          ? d.language
          : Object.keys(w.languages)[0];
      d.language = select.value;
      panel.append(labelled("Language", select));
    }
    renderCode(
      (w.languages && d.language ? w.languages[d.language] : w.code) ||
        "Read the original briefing above.",
    );
    panel.append(selection);
    main.append(panel);
    if (w.kind === "debug") {
      const fixes = el("div", "", "fix-options");
      for (const fix of w.fixes || []) {
        const select = el("select");
        select.setAttribute("aria-label", `Fix for line ${fix.line}`);
        const blank = el("option", "Choose a repair");
        blank.value = "";
        select.append(blank);
        fix.options.forEach((text, i) => {
          const opt = el("option", text);
          opt.value = String(i);
          select.append(opt);
        });
        select.value = d.fixes[fix.line] || "";
        select.addEventListener("change", () => {
          d.fixes[fix.line] = select.value;
          renderCode(currentCode);
          onAnswer(
            Object.entries(d.fixes)
              .filter(([, v]) => v !== "")
              .map(([l, v]) => `${l}:${v}`)
              .join(","),
          );
        });
        fixes.append(labelled(`Repair line ${fix.line}`, select));
      }
      fixes.append(
        serverButton("Run fixed code", () =>
          send({
            type: "game_action",
            action: "probe",
            id: c.id,
            input: Object.entries(d.fixes)
              .filter(([, v]) => v !== "")
              .map(([l, v]) => `${l}:${v}`)
              .join(","),
          }),
        ),
        el(
          "pre",
          c.feedback || `Initial output:\n${w.initialOutput || ""}`,
          "simulation-output",
        ),
      );
      main.append(fixes);
    }
    const trace = el("details", "", "trace-tool");
    trace.append(el("summary", "Trace table · track each loop pass"));
    const table = el("table"),
      head = el("tr");
    for (const v of ["Pass", ...(w.variables || ["value", "total"])])
      head.append(el("th", v));
    table.append(head);
    const addRow = (values: string[] = []) => {
      const idx = d.trace.length;
      d.trace.push(values);
      const row = el("tr");
      row.append(el("td", String(idx + 1)));
      (w.variables || ["value", "total"]).forEach((v, i) => {
        const cell = el("td"),
          field = input(`${v}, pass ${idx + 1}`, values[i] || "");
        field.maxLength = 50;
        field.addEventListener("input", () => {
          d.trace[idx][i] = field.value;
          saveDrafts();
        });
        cell.append(field);
        row.append(cell);
      });
      table.append(row);
    };
    const old = d.trace.slice();
    d.trace = [];
    for (const values of old) addRow(values);
    if (!d.trace.length) addRow();
    trace.append(
      table,
      button("Add loop pass", () => {
        if (d.trace.length < 40) addRow();
      }),
    );
    main.append(trace);
  }
  if (w.kind === "cipher") {
    const preview = el("pre", d.cipher, "cipher-preview"),
      operations = el("div", "", "bench-controls"),
      n = input("Caesar shift amount", "-3", "number");
    n.value = d.values!.shift || "-3";
    n.addEventListener("input", () => {
      d.values!.shift = n.value;
    });
    n.min = "-25";
    n.max = "25";
    const update = (value: string) => {
      d.history!.push(d.cipher);
      if (d.history!.length > 40) d.history!.shift();
      d.cipher = value;
      preview.textContent = value;
      saveDrafts();
    };
    operations.append(
      labelled("Caesar shift", n),
      button("Apply shift", () =>
        update(shift(d.cipher, Number(n.value) || 0)),
      ),
      button("Atbash", () => update(atbash(d.cipher))),
      button("Reverse", () => update([...d.cipher].reverse().join(""))),
      button("Undo positional shift", () => {
        let i = 0;
        update(d.cipher.replace(/[a-z]/gi, (s) => shift(s, -++i)));
      }),
      button("Reset ciphertext", () => update(w.ciphertext || "")),
      button("Undo transform", () => {
        const previous = d.history!.pop();
        if (previous !== undefined) {
          d.cipher = previous;
          preview.textContent = previous;
        }
      }),
      button("Use preview as answer", () => onAnswer(d.cipher)),
    );
    const substitutions = el("details");
    substitutions.append(el("summary", "Letter-by-letter substitution board"));
    const board = el("div", "", "substitution-board"),
      mapping: Record<string, string> = {};
    for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
      const field = input(`Substitute ${letter}`);
      field.value = d.values![`sub-${letter}`] || "";
      mapping[letter] = field.value;
      field.maxLength = 1;
      field.addEventListener("input", () => {
        mapping[letter] = field.value.toUpperCase();
        d.values![`sub-${letter}`] = mapping[letter];
      });
      board.append(labelled(letter, field));
    }
    substitutions.append(
      board,
      button("Apply substitutions", () =>
        update(d.cipher.replace(/[A-Z]/g, (c) => mapping[c] || c)),
      ),
    );
    main.append(
      el("p", "ABCDEFGHIJKLMNOPQRSTUVWXYZ ↔ ZYXWVUTSRQPONMLKJIHGFEDCBA"),
      preview,
      operations,
      substitutions,
    );
  }
  if (w.kind === "logs") {
    const query = input("Search log evidence", d.query),
      user = input("Filter by user", d.values!.user || ""),
      ip = input("Filter by IP", d.values!.ip || ""),
      status = el("select");
    status.setAttribute("aria-label", "Filter log status");
    for (const value of ["All", "LOGIN", "LOGOUT", "FAIL", "OK", "ACTION"]) {
      const opt = el("option", value);
      opt.value = value;
      status.append(opt);
    }
    status.value = d.values!.status || "All";
    const count = el("output", "", "bench-readout");
    const rows = el("div", "", "log-viewer"),
      pins = el("aside", "", "pinned-evidence"),
      render = () => {
        const focusedRow = rows.contains(document.activeElement)
          ? document.activeElement?.textContent
          : null;
        rows.replaceChildren();
        for (const line of w.logs || []) {
          if (d.query && !line.toLowerCase().includes(d.query.toLowerCase()))
            continue;
          if (user.value && !line.includes(`user=${user.value}`)) continue;
          if (ip.value && !line.includes(`ip=${ip.value}`)) continue;
          if (status.value !== "All" && !line.includes(status.value)) continue;
          const b = button(line, () => {
            if (d.pins.includes(line))
              d.pins = d.pins.filter((v) => v !== line);
            else d.pins.push(line);
            render();
          });
          b.className = "log-row";
          b.setAttribute("aria-pressed", String(d.pins.includes(line)));
          rows.append(b);
        }
        count.textContent = `${rows.childElementCount} / ${w.logs?.length || 0} signals shown · ${d.pins.length} pinned`;
        if (!rows.childElementCount)
          rows.append(
            el(
              "p",
              "No matching signals. Clear a filter to widen the search.",
              "bench-empty",
            ),
          );
        pins.replaceChildren(el("h5", `Pinned evidence / ${d.pins.length}`));
        if (!d.pins.length)
          pins.append(
            el(
              "p",
              "Tap a log row to keep it here while you investigate.",
              "bench-empty",
            ),
          );
        for (const line of d.pins) pins.append(el("pre", line));
        if (focusedRow)
          Array.from(rows.querySelectorAll<HTMLButtonElement>("button"))
            .find((row) => row.textContent === focusedRow)
            ?.focus({ preventScroll: true });
      };
    query.addEventListener("input", () => {
      d.query = query.value;
      render();
    });
    for (const [key, field] of [
      ["user", user],
      ["ip", ip],
      ["status", status],
    ] as const)
      field.addEventListener("input", () => {
        d.values![key] = field.value;
        render();
      });
    const filters = el("div", "", "log-filters");
    filters.append(
      labelled("Search evidence", query),
      labelled("User", user),
      labelled("IP", ip),
      labelled("Status", status),
    );
    main.append(
      el("p", `${w.logs?.length || 0} log entries. Tap a row to pin it.`),
      filters,
      count,
      rows,
      pins,
    );
    render();
  }
  if (w.kind === "deduction" || w.kind === "statements") {
    const clues = el("div", "", "clue-list");
    for (const [i, text] of (w.clues || []).entries()) {
      const tick = input(`Clue ${i + 1} checked`, "", "checkbox");
      tick.checked = d.marked.includes(i);
      tick.addEventListener("change", () => {
        d.marked = tick.checked
          ? [...d.marked, i]
          : d.marked.filter((v) => v !== i);
      });
      clues.append(labelled(text, tick));
    }
    main.append(clues);
    const board = el("div", "", "candidate-board");
    for (const [i, word] of (w.candidates || []).entries()) {
      const b = button(word, () => {
        if (w.kind === "statements") {
          d.selected = [word];
          board
            .querySelectorAll("button")
            .forEach((node) =>
              node.setAttribute(
                "aria-pressed",
                String(node.textContent === word),
              ),
            );
          onAnswer(word);
          return;
        }
        const j = d.selected.indexOf(word);
        if (j >= 0) d.selected.splice(j, 1);
        else d.selected.push(word);
        b.setAttribute("aria-pressed", String(d.selected.includes(word)));
      });
      b.setAttribute(
        "aria-label",
        w.kind === "statements"
          ? `Select suspect ${word}`
          : `Eliminate candidate ${word}`,
      );
      b.setAttribute("aria-pressed", String(d.selected.includes(word)));
      board.append(b);
    }
    main.append(board);
    if (w.candidates?.every((v) => /^\d$/.test(v))) {
      const slots = el("div", "", "digit-slots"),
        digits = Array.from({ length: 4 }, (_, i) =>
          input(`Key digit ${i + 1}`, d.assignments[String(i)] || ""),
        );
      for (const [i, n] of digits.entries()) {
        n.maxLength = 1;
        n.inputMode = "numeric";
        n.addEventListener("input", () => {
          d.assignments[String(i)] = n.value;
          onAnswer(digits.map((n) => n.value).join(""));
        });
        slots.append(n);
      }
      main.append(slots);
    }
  }
  if (w.kind === "machine") {
    const chain = el("div", "", "machine-chain");
    for (const s of w.steps || [])
      chain.append(
        el(
          "span",
          `× ${s.multiply} → ${s.add >= 0 ? "+" : ""}${s.add} → ÷ ${s.divide}`,
        ),
      );
    const field = input(
      "Machine test input",
      d.values!.machine || "",
      "number",
    );
    field.addEventListener("input", () => {
      d.values!.machine = field.value;
    });
    const probe = serverButton(
      `Test machine · ${Math.max(0, 5 - (c.testRuns || 0))} runs left`,
      () =>
        send({
          type: "game_action",
          action: "probe",
          id: c.id,
          input: field.value,
        }),
    );
    probe.disabled ||= (c.testRuns || 0) >= 5;
    main.append(
      el("strong", `TARGET OUTPUT: ${w.target}`),
      chain,
      labelled("Test any input", field),
      probe,
    );
  }
  if (w.kind === "portal") {
    const portal = el("div", "", "mock-portal");
    portal.append(
      el("strong", "TRAINING SANDBOX / MOCK LOGIN"),
      el("p", "This form is a puzzle. Do not enter any real password."),
    );
    for (const notice of w.notices || [])
      portal.append(el("p", notice, "staff-notice"));
    const user = input("Mock portal username", d.values!.portalUser || "admin"),
      password = input(
        "Mock portal puzzle password",
        d.values!.portalPassword || "",
      );
    user.addEventListener("input", () => {
      d.values!.portalUser = user.value;
      onAnswer(`${user.value}:${password.value}`);
    });
    password.addEventListener("input", () => {
      d.values!.portalPassword = password.value;
      onAnswer(`${user.value}:${password.value}`);
    });
    user.autocomplete = "off";
    password.autocomplete = "off";
    portal.append(
      labelled("Puzzle username", user),
      labelled("Puzzle password", password),
      button("Use mock login as answer", () =>
        onAnswer(`${user.value}:${password.value}`),
      ),
    );
    main.append(portal);
  }
  if (w.kind === "maze") {
    const grid = w.grid!,
      board = el("div", "", "puzzle-grid"),
      readout = el("output", "", "maze-readout");
    board.style.setProperty("--columns", String(grid[0].length));
    board.tabIndex = 0;
    board.setAttribute(
      "aria-label",
      "Maze token board. Arrow keys move. T uses a matching teleport pad.",
    );
    const simulate = () => {
      let x = 0,
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
      for (const m of d.route) {
        if (m === "U") y--;
        if (m === "D") y++;
        if (m === "L") x--;
        if (m === "R") x++;
        if (m === "T") {
          const pad = grid[y][x],
            other = grid.flatMap((r, ry) =>
              [...r].flatMap((v, rx) =>
                v === pad && (rx !== x || ry !== y) ? [{ x: rx, y: ry }] : [],
              ),
            )[0];
          if (other) {
            x = other.x;
            y = other.y;
          }
        }
        key ||= grid[y]?.[x] === "K";
      }
      return { x, y, key };
    };
    const render = () => {
      const s = simulate();
      board.replaceChildren();
      grid.forEach((row, y) =>
        [...row].forEach((tile, x) => {
          const cell = el(
            "span",
            x === s.x && y === s.y ? "●" : tile === "." ? "" : tile,
            "puzzle-tile",
          );
          cell.dataset.tile = tile;
          cell.setAttribute(
            "aria-label",
            `Row ${y + 1}, column ${x + 1}: ${x === s.x && y === s.y ? "your token, " : ""}${({ "#": "wall", ".": "path", S: "start", K: "key", D: "locked door", E: "exit" } as Record<string, string>)[tile] || "teleport pad " + tile}`,
          );
          cell.dataset.token = String(x === s.x && y === s.y);
          board.append(cell);
        }),
      );
      readout.textContent = `${d.route.length} moves · ${s.key ? "key acquired" : "key not acquired"}${grid[s.y][s.x] === "E" ? " · exit reached" : ""}`;
      const teleport = controls.querySelector<HTMLButtonElement>(
        '[aria-label="Use teleport pad"]',
      );
      if (teleport) teleport.disabled = !/[0-9]/.test(grid[s.y][s.x]);
      onAnswer(d.route);
    };
    const move = (m: string) => {
      const s = simulate();
      let x = s.x,
        y = s.y;
      if (m === "U") y--;
      if (m === "D") y++;
      if (m === "L") x--;
      if (m === "R") x++;
      if (m === "T" && !/[0-9]/.test(grid[y][x])) return;
      const tile = grid[y]?.[x];
      if (
        !tile ||
        tile === "#" ||
        (tile === "D" && !s.key) ||
        d.route.length >= 500
      )
        return;
      d.route += m;
      render();
    };
    board.addEventListener("keydown", (e) => {
      const moves: Record<string, string> = {
        ArrowUp: "U",
        ArrowDown: "D",
        ArrowLeft: "L",
        ArrowRight: "R",
        t: "T",
        T: "T",
      };
      if (moves[e.key]) {
        e.preventDefault();
        e.stopPropagation();
        move(moves[e.key]);
      }
    });
    const controls = el("div", "", "bench-controls");
    controls.classList.add("maze-controls");
    for (const [m, label] of [
      ["U", "↑"],
      ["L", "←"],
      ["D", "↓"],
      ["R", "→"],
      ["T", "Teleport"],
    ]) {
      const control = button(label, () => move(m));
      control.setAttribute(
        "aria-label",
        (
          {
            U: "Move token up",
            L: "Move token left",
            D: "Move token down",
            R: "Move token right",
            T: "Use teleport pad",
          } as Record<string, string>
        )[m],
      );
      controls.append(control);
    }
    controls.append(
      button("Undo move", () => {
        d.route = d.route.slice(0, -1);
        render();
      }),
      button("Reset maze", () => {
        d.route = "";
        render();
      }),
    );
    main.append(
      el(
        "p",
        "● Your token · S Start · K Key · D Door · E Exit · Numbers Teleport",
        "maze-legend",
      ),
      board,
      readout,
      controls,
    );
    render();
  }
  if (w.kind === "tree" || w.kind === "ring") {
    const diagram = el("div", "", "node-diagram"),
      svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 600 320");
    svg.setAttribute("preserveAspectRatio", "none");
    const defs = document.createElementNS(svg.namespaceURI, "defs"),
      marker = document.createElementNS(svg.namespaceURI, "marker"),
      arrow = document.createElementNS(svg.namespaceURI, "path"),
      arrowId = `arrow-${c.id.replace(/[^a-z0-9]/gi, "-")}`;
    marker.setAttribute("id", arrowId);
    marker.setAttribute("viewBox", "0 0 10 10");
    marker.setAttribute("refX", "9");
    marker.setAttribute("refY", "5");
    marker.setAttribute("markerWidth", "7");
    marker.setAttribute("markerHeight", "7");
    marker.setAttribute("orient", "auto-start-reverse");
    arrow.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
    arrow.setAttribute("fill", "#a1bdd0");
    marker.append(arrow);
    defs.append(marker);
    svg.append(defs);
    svg.setAttribute(
      "aria-label",
      w.kind === "tree" ? "Reporting links" : "Payment arrows",
    );
    const nodes = w.nodes || [],
      coords = nodes.map((_, i) =>
        w.kind === "ring"
          ? {
              x:
                300 +
                230 * Math.cos((i / nodes.length) * Math.PI * 2 - Math.PI / 2),
              y:
                160 +
                125 * Math.sin((i / nodes.length) * Math.PI * 2 - Math.PI / 2),
            }
          : {
              x: [300, 160, 440, 90, 220, 440, 40, 140, 520][i] || 300,
              y: [30, 100, 100, 170, 170, 170, 270, 270, 270][i] || 30,
            },
      );
    for (const [a, b] of w.edges || []) {
      const i = nodes.indexOf(a),
        j = nodes.indexOf(b);
      if (i < 0 || j < 0) continue;
      const line = document.createElementNS(svg.namespaceURI, "line");
      const dx = coords[j].x - coords[i].x,
        dy = coords[j].y - coords[i].y,
        length = Math.hypot(dx, dy) || 1;
      line.setAttribute("x1", String(coords[i].x + (dx / length) * 23));
      line.setAttribute("y1", String(coords[i].y + (dy / length) * 23));
      line.setAttribute("x2", String(coords[j].x - (dx / length) * 23));
      line.setAttribute("y2", String(coords[j].y - (dy / length) * 23));
      line.setAttribute("marker-end", `url(#${arrowId})`);
      line.setAttribute("stroke", "#62848e");
      svg.append(line);
      const text = document.createElementNS(svg.namespaceURI, "text");
      text.setAttribute("x", String((coords[i].x + coords[j].x) / 2));
      text.setAttribute("y", String((coords[i].y + coords[j].y) / 2));
      text.textContent = "";
      svg.append(text);
    }
    diagram.append(svg);
    nodes.forEach((n, i) => {
      const b = button(n, () => {
        if (d.selected.includes(n))
          d.selected = d.selected.filter((v) => v !== n);
        else {
          if (w.kind === "tree" && d.selected.length >= (w.selected ? 1 : 2))
            d.selected = [];
          d.selected.push(n);
        }
        diagram
          .querySelectorAll<HTMLButtonElement>("button")
          .forEach((v) =>
            v.setAttribute(
              "aria-pressed",
              String(d.selected.includes(v.textContent || "")),
            ),
          );
        onAnswer(d.selected.join(","));
      });
      b.style.left = `${coords[i].x / 6}%`;
      b.style.top = `${coords[i].y / 3.2}%`;
      b.setAttribute("aria-pressed", String(d.selected.includes(n)));
      diagram.append(b);
    });
    const viewport = el("div", "", "network-viewport");
    viewport.tabIndex = 0;
    viewport.setAttribute(
      "aria-label",
      "Interactive network. Scroll horizontally on small screens.",
    );
    viewport.append(diagram);
    main.append(
      viewport,
      el(
        "p",
        "Directed links / " +
          (w.edges || []).map(([a, b]) => `${a} → ${b}`).join(" · "),
      ),
    );
  }
  if (w.kind === "order") {
    main.append(
      el("p", (w.edges || []).map(([a, b]) => `${a} before ${b}`).join(" · ")),
    );
    const list = el("ol", "", "order-board");
    let dragging = "";
    const render = () => {
      const focusedAction = list.contains(document.activeElement)
        ? document.activeElement?.getAttribute("aria-label")
        : null;
      list.replaceChildren();
      d.order.forEach((n, i) => {
        const li = el("li");
        li.draggable = true;
        li.addEventListener("dragstart", (e) => {
          dragging = n;
          e.dataTransfer?.setData("text/plain", n);
        });
        li.addEventListener("dragover", (e) => e.preventDefault());
        li.addEventListener("drop", (e) => {
          e.preventDefault();
          if (!d.order.includes(dragging)) return;
          d.order = d.order.filter((v) => v !== dragging);
          d.order.splice(i, 0, dragging);
          render();
        });
        li.append(
          el("strong", n),
          button(`Move ${n} earlier`, () => {
            if (i > 0) {
              [d.order[i - 1], d.order[i]] = [d.order[i], d.order[i - 1]];
              render();
            }
          }),
          button(`Move ${n} later`, () => {
            if (i < d.order.length - 1) {
              [d.order[i + 1], d.order[i]] = [d.order[i], d.order[i + 1]];
              render();
            }
          }),
        );
        const actions = li.querySelectorAll("button");
        actions[0].setAttribute("aria-label", `Move ${n} earlier`);
        actions[0].textContent = "↑ Earlier";
        actions[0].disabled = i === 0;
        actions[1].setAttribute("aria-label", `Move ${n} later`);
        actions[1].textContent = "↓ Later";
        actions[1].disabled = i === d.order.length - 1;
        list.append(li);
      });
      onAnswer(d.order.join(","));
      if (focusedAction) {
        const action = Array.from(
          list.querySelectorAll<HTMLButtonElement>("button"),
        ).find(
          (control) => control.getAttribute("aria-label") === focusedAction,
        );
        (action?.disabled
          ? action
              .closest("li")
              ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
          : action
        )?.focus({ preventScroll: true });
      }
    };
    main.append(list);
    render();
  }
  if (w.kind === "lights") {
    const board = el("div", "", "puzzle-grid lights-board");
    board.style.setProperty("--columns", "3");
    const render = () => {
      let lights = w.lights!.slice();
      for (const index of d.presses)
        for (const n of [
          index,
          index - 3,
          index + 3,
          ...(index % 3 ? [index - 1] : []),
          ...(index % 3 < 2 ? [index + 1] : []),
        ])
          if (n >= 0 && n < 9) lights[n] ^= 1;
      board.replaceChildren();
      lights.forEach((v, i) => {
        const b = button(v ? "●" : "○", () => {
          if (d.presses.length < 40) {
            d.presses.push(i);
            render();
            board.querySelectorAll<HTMLButtonElement>("button")[i]?.focus();
          }
        });
        b.setAttribute(
          "aria-label",
          `Light row ${Math.floor(i / 3) + 1} column ${(i % 3) + 1}`,
        );
        b.setAttribute("aria-pressed", String(!!v));
        board.append(b);
      });
      onAnswer(d.presses.join(","));
    };
    main.append(
      board,
      button("Reset light panel", () => {
        d.presses = [];
        render();
      }),
    );
    render();
  }
  if (w.kind === "circuit") {
    const output = el("output", "", "circuit-lamp"),
      controls = el("div", "", "bench-controls"),
      stages = el("div", "", "circuit-stages"),
      render = () => {
        const has = (n: string) => d.switches.includes(n),
          g1 = has(w.switches![0]) && has(w.switches![1]),
          g2 = has(w.switches![2]) || has(w.switches![3]),
          g3 = g1 !== g2,
          g4 = has(w.switches![4]) || has(w.switches![5]);
        output.textContent = `LOCAL PREVIEW / G1 ${+g1} · G2 ${+g2} · G3 ${+g3} · G4 ${+g4}\nOUTPUT (G3 AND G4): ${g3 && g4 ? "ON" : "OFF"}`;
        output.dataset.on = String(g3 && g4);
        stages.replaceChildren();
        for (const [title, formula, value] of [
          ["G1 / AND", `${w.switches![0]} ∧ ${w.switches![1]}`, g1],
          ["G2 / OR", `${w.switches![2]} ∨ ${w.switches![3]}`, g2],
          ["G3 / XOR", "G1 ⊕ G2", g3],
          ["G4 / OR", `${w.switches![4]} ∨ ${w.switches![5]}`, g4],
        ] as const) {
          const stage = el("article", "", "circuit-stage");
          stage.dataset.on = String(value);
          stage.append(
            el("small", title),
            el("strong", value ? "1 / ON" : "0 / OFF"),
            el("span", formula),
          );
          stages.append(stage);
        }
        onAnswer(d.switches.join(","));
      };
    for (const s of w.switches || []) {
      const b = button(`Switch ${s}`, () => {
        d.switches = d.switches.includes(s)
          ? d.switches.filter((v) => v !== s)
          : [...d.switches, s];
        b.setAttribute("aria-pressed", String(d.switches.includes(s)));
        render();
      });
      b.setAttribute("aria-pressed", String(d.switches.includes(s)));
      controls.append(b);
    }
    controls.classList.add("switch-board");
    main.append(controls, stages, output);
    render();
  }
  if (w.kind === "constraints") {
    main.append(el("p", (w.clues || []).join("\n")));
    const board = el("div", "", "constraint-board");
    for (const n of w.nodes || []) {
      const select = el("select");
      select.setAttribute("aria-label", `Value for ${n}`);
      for (const v of ["", 1, 2, 3, 4, 5, 6]) {
        const opt = el("option", String(v || "Choose"));
        opt.value = String(v);
        select.append(opt);
      }
      select.value = d.assignments[n] || "";
      select.addEventListener("change", () => {
        d.assignments[n] = select.value;
        onAnswer(
          Object.entries(d.assignments)
            .filter(([, v]) => v)
            .map(([n, v]) => `${n}=${v}`)
            .join(","),
        );
      });
      board.append(labelled(n, select));
    }
    main.append(board);
  }
  if (w.kind === "oracle" || w.kind === "courier") {
    const guess = input(
      w.kind === "oracle" ? "Three-digit keypad guess" : "Courier number guess",
      d.values!.guess || "",
    );
    guess.addEventListener("input", () => {
      d.values!.guess = guess.value;
    });
    guess.inputMode = "numeric";
    guess.required = true;
    if (w.kind === "oracle") {
      guess.pattern = "\\d{3}";
      guess.placeholder = "000";
    } else {
      guess.type = "number";
      guess.min = "1";
      guess.max = "100";
      guess.step = "1";
      guess.placeholder = "1–100";
    }
    guess.maxLength = w.kind === "oracle" ? 3 : 3;
    const submitGuess = serverButton("Submit guess", () => {
      if (!guess.reportValidity()) return;
      onAnswer(guess.value);
      send({
        type: "game_action",
        action: "answer",
        id: c.id,
        answer: guess.value,
      });
    });
    submitGuess.disabled ||= challengeGate(c, serverTime) !== "ready";
    submitGuess.dataset.benchSubmit = "";
    const guessForm = el("form", "", "guess-form");
    guessForm.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!submitGuess.disabled) submitGuess.click();
    });
    guessForm.append(
      labelled(w.kind === "oracle" ? "Keypad" : "Ask the courier", guess),
      submitGuess,
    );
    const guessStatus = el(
      "p",
      submitGuess.disabled
        ? "Server verification is temporarily unavailable. Read the contract status below."
        : "Each submission is sent to the server. Local typing does not use a guess.",
      "bench-empty",
    );
    main.append(
      el(
        "p",
        `Up to ${w.maxGuesses} guesses. Server feedback remains in the contract.`,
      ),
      guessForm,
      guessStatus,
    );
  }
  const tools = el("details", "", "contract-tools");
  tools.open = false;
  tools.append(el("summary", "Private toolkit / Notes & calculator"));
  const scratch = el("textarea");
  scratch.value = d.notes;
  scratch.maxLength = 4000;
  scratch.setAttribute("aria-label", `Scratchpad for ${c.title}`);
  scratch.placeholder = "Your notes, clues and intermediate results";
  scratch.addEventListener("input", () => {
    d.notes = scratch.value;
    saveDrafts();
  });
  const expression = input("Calculator expression"),
    result = el("output");
  expression.value = d.values!.calculator || "";
  expression.addEventListener("input", () => {
    d.values!.calculator = expression.value;
  });
  const toolkit = el("div", "", "toolkit-grid"),
    calculator = el("div", "", "calculator-panel");
  result.setAttribute("role", "status");
  result.setAttribute("aria-label", "Calculator result");
  calculator.append(
    labelled("Calculator", expression),
    button("Calculate", () => {
      try {
        result.textContent = String(calculateExpression(expression.value));
      } catch (e) {
        result.textContent =
          e instanceof Error ? e.message : "Check the expression.";
      }
    }),
    result,
  );
  expression.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      calculator.querySelector<HTMLButtonElement>("button")?.click();
    }
  });
  toolkit.append(labelled("Private scratchpad", scratch), calculator);
  tools.append(toolkit);
  root.append(tools);
  if (w.kind === "debug")
    onAnswer(
      Object.entries(d.fixes)
        .filter(([, v]) => v !== "")
        .map(([l, v]) => `${l}:${v}`)
        .join(","),
    );
  if (w.kind === "tree" || w.kind === "ring") onAnswer(d.selected.join(","));
  if (w.kind === "statements" && d.selected.length) onAnswer(d.selected[0]);
  if (w.kind === "portal")
    onAnswer(
      `${d.values!.portalUser || "admin"}:${d.values!.portalPassword || ""}`,
    );
  if (w.kind === "constraints")
    onAnswer(
      Object.entries(d.assignments)
        .filter(([, v]) => v)
        .map(([n, v]) => `${n}=${v}`)
        .join(","),
    );
  if (w.kind === "deduction" && w.candidates?.every((v) => /^\d$/.test(v)))
    onAnswer(
      Array.from({ length: 4 }, (_, i) => d.assignments[String(i)] || "").join(
        "",
      ),
    );
  return root;
}
