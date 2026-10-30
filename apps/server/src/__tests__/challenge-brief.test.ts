import { describe, it, expect } from "vitest";
import { generateFinalChallenge } from "../game/final-challenges.js";
import { CHALLENGE_CATALOGUE } from "../game/challenge-catalogue.js";

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toUpperCase();

/** A broad sample of generated variants for every template. */
function* everyVariant(count = 40) {
  for (const spec of CHALLENGE_CATALOGUE)
    for (let i = 0; i < count; i++)
      yield {
        spec,
        model: generateFinalChallenge(
          `secret-${i % 7}`,
          `player-${i}`,
          spec.id,
          `variant-${i}`,
        ),
      };
}

describe("structured challenge briefs", () => {
  it("gives every one of the 42 challenges a complete brief", () => {
    expect(CHALLENGE_CATALOGUE).toHaveLength(42);
    for (const spec of CHALLENGE_CATALOGUE) {
      const { brief } = generateFinalChallenge("s", "p", spec.id, "v");
      expect(brief.scenario, spec.id).toBeTruthy();
      expect(brief.task, spec.id).toBeTruthy();
      expect(brief.answerFormat, spec.id).toBeTruthy();
    }
  });

  it("never uses a real answer as the format example", () => {
    // The example exists to remove ambiguity about the answer's shape. If it
    // ever coincided with the actual answer it would hand out a paid prize, so
    // this is checked across 1,680 generated variants, not a single seed.
    const leaks: string[] = [];
    for (const { spec, model } of everyVariant()) {
      const example = model.brief.example;
      if (example && norm(example) === norm(model.answer))
        leaks.push(`${spec.id}: "${example}"`);
    }
    expect(leaks).toEqual([]);
  });

  it("never lets the format example pass the validator", () => {
    // Stronger than string equality: some validators accept more than one
    // spelling, so the example must also be rejected by the real check.
    const accepted: string[] = [];
    for (const { spec, model } of everyVariant(15)) {
      const example = model.brief.example;
      if (example && model.validate(example))
        accepted.push(`${spec.id}: "${example}"`);
    }
    expect(accepted).toEqual([]);
  });

  it("does not change what the validator accepts", () => {
    // The brief is presentation only. The real answer must still validate, so
    // adding briefs cannot have altered the economy of any challenge.
    for (const { spec, model } of everyVariant(10))
      if (spec.id.startsWith("ST") || spec.id.startsWith("SD") || spec.id.startsWith("EX"))
        expect(model.validate(model.answer), spec.id).toBe(true);
  });

  it("states that capitals and spacing are forgiven only where they are", () => {
    // `out()` normalises with trim / collapse-whitespace / upper-case, so a
    // code challenge answer typed in lower case must still pass.
    const model = generateFinalChallenge("s", "p", "ST-01", "v");
    expect(model.brief.answerFormat).toMatch(/forgiven/i);
    expect(model.validate(`  ${model.answer.toLowerCase()}  `)).toBe(true);
  });

  it("warns players never to type a real password into the portal puzzle", () => {
    const portal = CHALLENGE_CATALOGUE.map((c) =>
      generateFinalChallenge("s", "p", c.id, "v"),
    ).find((m) => m.workbench.kind === "portal");
    if (portal) expect(portal.brief.answerFormat).toMatch(/never enter a real password/i);
  });
});
