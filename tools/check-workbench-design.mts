import assert from "node:assert/strict";
import {
  WORKBENCH_DESIGN,
  challengeGate,
  codeTokens,
} from "../apps/client/src/ui/workbench-design.js";
const expected = [
  "code",
  "debug",
  "cipher",
  "deduction",
  "logs",
  "machine",
  "portal",
  "maze",
  "tree",
  "order",
  "ring",
  "lights",
  "statements",
  "oracle",
  "circuit",
  "courier",
  "constraints",
];
assert.deepEqual(Object.keys(WORKBENCH_DESIGN).sort(), expected.sort());
for (const design of Object.values(WORKBENCH_DESIGN)) {
  assert.ok(design.title && design.instruction && design.icon);
  assert.equal(design.steps.length, 3);
  assert.equal(new Set(design.steps).size, 3);
}
for (const source of [
  'if (x > 12) printf("<script>"); // note',
  "for i in range(10):",
  "#include <stdio.h>",
  'a = "escaped \\" string"',
  "",
  "ordinary_identifier + value",
  'print("₹100")',
]) {
  assert.equal(
    codeTokens(source)
      .map((token) => token.text)
      .join(""),
    source,
    "Decoration must preserve exact source",
  );
}
assert.equal(codeTokens("// if 123")[0].kind, "comment");
assert.ok(
  codeTokens("int total = 123;").some((token) => token.kind === "number"),
);
const c = {
  expiresAt: 10000,
  blockedUntil: 0,
  openedAt: 1000,
  minimumSolveMs: 5000,
  solved: false,
};
assert.equal(challengeGate(c, 5999), "reading");
assert.equal(challengeGate(c, 6000), "ready");
assert.equal(challengeGate({ ...c, blockedUntil: 8000 }, 7999), "locked");
assert.equal(challengeGate({ ...c, blockedUntil: 8000 }, 8000), "ready");
assert.equal(challengeGate({ ...c, answerReadyAt: 8000 }, 7999), "cooldown");
assert.equal(challengeGate({ ...c, answerReadyAt: 8000 }, 8000), "ready");
assert.equal(challengeGate(c, 10000), "expired");
assert.equal(challengeGate({ ...c, solved: true }, 11000), "solved");
assert.equal(challengeGate({ expiresAt: 10000, solved: false }, 1), "ready");
assert.equal(c.blockedUntil, 0);
console.log(
  "Workbench design passed: all 17 tool briefs, exact source preservation, and server-time verification states.",
);
