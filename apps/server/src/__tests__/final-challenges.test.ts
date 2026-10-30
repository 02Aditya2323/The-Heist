import { describe, it, expect } from "vitest";
import { CHALLENGE_CATALOGUE } from "../game/challenge-catalogue.js";
import {
  generateFinalChallenge,
  shift,
  atbash,
  shortestMaze,
  walkMaze,
  digitFeedback,
  toggleLights,
} from "../game/final-challenges.js";
const generate = (id: string, player = "operator-a", variant = "qa") =>
  generateFinalChallenge("private-test-seed", player, id, variant);
const ints = (s: string) => s.split(",").map((v) => Number(v.trim()));
describe("Final challenge book and workbook catalogue", () => {
  it("contains exactly the documented 42 IDs and 8/7/14/13 type mix", () => {
    expect(CHALLENGE_CATALOGUE).toHaveLength(42);
    expect(new Set(CHALLENGE_CATALOGUE.map((c) => c.id)).size).toBe(42);
    const counts = Object.fromEntries(
      ["Code", "Debug", "CTF", "Puzzle"].map((type) => [
        type,
        CHALLENGE_CATALOGUE.filter((c) => c.type === type).length,
      ]),
    );
    expect(counts).toEqual({ Code: 8, Debug: 7, CTF: 14, Puzzle: 13 });
    expect(CHALLENGE_CATALOGUE.filter((c) => c.language === "C")).toHaveLength(
      5,
    );
    expect(
      CHALLENGE_CATALOGUE.filter((c) => c.language === "Python"),
    ).toHaveLength(5);
    expect(
      CHALLENGE_CATALOGUE.filter((c) => c.language === "Java"),
    ).toHaveLength(4);
    expect(CHALLENGE_CATALOGUE.some((c) => /SQL|C\+\+/.test(c.language))).toBe(
      false,
    );
  });
  for (const template of CHALLENGE_CATALOGUE)
    it(`${template.id}: deterministic valid variants and a real ${template.workbench}`, () => {
      for (let seed = 0; seed < 60; seed++) {
        const c = generate(template.id, `operator-${seed}`);
        expect(c.validate(c.answer)).toBe(true);
        expect(c.validate("__forged__")).toBe(false);
        expect(JSON.stringify(c)).toBe(
          JSON.stringify(generate(template.id, `operator-${seed}`)),
        );
        expect(c.workbench.kind).toBeTruthy();
        expect(c.client).toBeTruthy();
        expect(c.prompt).not.toBe(
          generate(template.id, `other-${seed}`).prompt,
        );
      }
    });
  it("computes all code-reading answers from the displayed data independently", () => {
    for (let seed = 0; seed < 30; seed++)
      for (const id of CHALLENGE_CATALOGUE.filter((c) => c.type === "Code").map(
        (c) => c.id,
      )) {
        const c = generate(id, `operator-${seed}`),
          code = c.workbench.code!;
        let expected = "";
        if (id === "ST-01") {
          const ns = ints(code.match(/amounts\[6\] = \{([^}]+)\}/)![1]);
          expected = String(ns.filter((v) => v > 0).reduce((a, b) => a + b, 0));
        }
        if (id === "SD-01") {
          const ns = ints(code.match(/int\[\] r = \{([^}]+)\}/)![1]);
          expected = `Peak ${Math.max(...ns)} at ${ns.indexOf(Math.max(...ns))}`;
        }
        if (id === "SD-02") {
          const ns = ints(code.match(/packets = \[([^\]]+)\]/)![1]);
          expected = String(
            ns.find((v) => ns.filter((n) => n === v).length === 1),
          );
        }
        if (id === "SD-03") {
          const cmds = code.match(/cmd\[\] = "([UDLR]+)"/)![1];
          let x = 0,
            y = 0;
          for (const m of cmds) {
            if (m === "R") x++;
            if (m === "L") x--;
            if (m === "U") y++;
            if (m === "D") y--;
          }
          expected = `${x} ${y}`;
        }
        if (id === "RC-01") {
          const ns = ints(code.match(/fares = \[([^\]]+)\]/)![1]);
          expected = String(ns.reduce((a, b) => a + b, 0));
        }
        if (id === "GH-03") {
          const states = code
            .match(/status = \[([^\]]+)\]/)![1]
            .match(/UP|DOWN/g)!;
          let run = 0,
            max = 0;
          for (const s of states) {
            run = s === "UP" ? run + 1 : 0;
            max = Math.max(max, run);
          }
          expected = String(max);
        }
        if (id === "BR-02") {
          const log = code
              .match(/String\[\] log = \{([^}]+)\}/)![1]
              .match(/"[^"]+"/g)!,
            target = code.match(/equals\("([^"]+)"\)/)![1],
            n = log.filter((v) => v === `"${target}"`).length;
          expected = n >= 2 ? `DOUBLE ${n}` : "OK";
        }
        if (id === "BL-01") {
          let balance = 0;
          for (const n of ints(code.match(/moves = \{([^}]+)\}/)![1]))
            if (balance + n >= 0) balance += n;
          expected = String(balance);
        }
        expect(c.answer).toBe(expected);
      }
  });
  it("keeps every debug repair line within its code panel and accepts equivalent language views", () => {
    for (const spec of CHALLENGE_CATALOGUE.filter((c) => c.type === "Debug")) {
      const c = generate(spec.id);
      expect(c.runFixes).toBeTypeOf("function");
      for (const fix of c.workbench.fixes!) {
        expect(fix.line).toBeGreaterThan(0);
        expect(fix.line).toBeLessThanOrEqual(
          c.workbench.code!.split("\n").length,
        );
        expect(new Set(fix.options).size).toBe(fix.options.length);
      }
      expect(c.runFixes!(c.answer)).not.toBe(c.workbench.initialOutput);
      expect(c.runFixes!('')).toBe(c.workbench.initialOutput);
    }
    expect(Object.keys(generate("RC-02").workbench.languages!)).toEqual([
      "Python",
      "C",
      "Java",
    ]);
  });
  it("decodes every layered ciphertext back to its complete player-specific flag", () => {
    for (const id of ["ST-03", "SD-08", "RC-03", "GH-01", "BR-03", "BL-02"]) {
      const c = generate(id);
      let text = c.workbench.ciphertext!,
        n = Number(c.prompt.match(/(?:SHIFT: |forward )(\d+)/)?.[1] || 0);
      if (id === "ST-03") text = shift(text, -n);
      else if (id === "BR-03") {
        let i = 0;
        text = text.replace(/[A-Z]/g, (v) => shift(v, -++i));
      } else {
        text = [...text].reverse().join("");
        if (id === "GH-01") text = atbash(text);
        else if (id === "RC-03") text = shift(text, -n);
        else text = shift(atbash(text), -n);
      }
      expect(text).toBe(c.answer);
    }
  });
  it("requires keys, validates any valid burglary maze route, and counts teleport as one move", () => {
    for (const id of ["EX-01", "BG-02", "BR-01"]) {
      const c = generate(id),
        grid = c.workbench.grid!;
      expect(walkMaze(grid, c.answer).ok).toBe(true);
      expect(c.answer.length).toBe(shortestMaze(grid).length);
      expect(c.validate("RRRRRR")).toBe(false);
    }
    expect(walkMaze(["SD.E"], "RRR").ok).toBe(false);
    expect(shortestMaze(["S1#", "##1", "..E"])).toBe("RTD");
  });
  it("accepts all genuinely solved circuit states, not just one expected combination", () => {
    const c = generate("BG-03"),
      s = c.workbench.switches!;
    let successes = 0;
    for (let bits = 0; bits < 64; bits++) {
      const active = s.filter((_, i) => bits & (1 << i)),
        g1 = !!(bits & 1) && !!(bits & 2),
        g2 = !!(bits & 4) || !!(bits & 8),
        g4 = !!(bits & 16) || !!(bits & 32),
        correct = g1 !== g2 && g4;
      expect(c.validate(active.join(","))).toBe(correct);
      if (correct) successes++;
    }
    expect(successes).toBe(30);
  });
  it("validates actual light-toggle replay instead of trusting a claimed solved board", () => {
    const c = generate("SD-09");
    let lights = c.workbench.lights!;
    for (const p of c.answer.split(",").map(Number))
      lights = toggleLights(lights, p);
    expect(lights.every((v) => !v)).toBe(true);
    expect(c.validate("9")).toBe(false);
    expect(digitFeedback("284", "482")).toBe("1 in place, 2 misplaced");
  });
  it("runs each number machine using only the displayed operations", () => {
    for (const id of ["EX-04", "BL-04"]) {
      const c = generate(id),
        result = c.workbench.steps!.reduce(
          (v, s) => (v * s.multiply + s.add) / s.divide,
          Number(c.answer),
        );
      expect(result).toBe(c.workbench.target);
    }
  });
});
