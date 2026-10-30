import { expect, it } from "vitest";
import { generateFinalChallenge } from "../../../server/src/game/final-challenges.js";
import { solvePublicChallenge } from "../gameplay-solver.js";
import type { ChallengeView } from "@heist/shared";

// The test oracle is confined to tests. The executable solver never imports the server.
const ids = [
  "ST-01",
  "ST-02",
  "ST-03",
  "SD-01",
  "SD-02",
  "SD-03",
  "SD-04",
  "SD-05",
  "SD-06",
  "SD-07",
  "SD-08",
  "SD-09",
  "SD-10",
  "EX-01",
  "EX-02",
  "EX-03",
  "EX-04",
  "EX-05",
  "RC-01",
  "RC-02",
  "RC-03",
  "GH-01",
  "GH-03",
];
it.each(ids)(
  "independent public-evidence solver handles variants for %s",
  (id) => {
    for (let variant = 0; variant < 30; variant++) {
      const model = generateFinalChallenge(
        "test-only-oracle",
        `test-player-${variant}`,
        id,
        `test-${variant}`,
      );
      const view: ChallengeView = {
        id: "public-attempt",
        title: `${id} · Test`,
        topic: "Test",
        prompt: model.prompt,
        reward: 0,
        expiresAt: Date.now() + 60000,
        solved: false,
        workbench: structuredClone(model.workbench),
      };
      const answer = solvePublicChallenge(view);
      expect(
        model.validate(answer),
        `${id} variant ${variant}: ${answer}`,
      ).toBe(true);
    }
  },
);
it("fails closed on unsupported or locked evidence", () => {
  const c: ChallengeView = {
    id: "x",
    title: "Unknown · X",
    topic: "x",
    prompt: "",
    reward: 0,
    expiresAt: 1,
    solved: false,
  };
  expect(() => solvePublicChallenge(c)).toThrow();
});
