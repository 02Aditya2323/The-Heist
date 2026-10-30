import assert from "node:assert/strict";
import { calculateExpression } from "../apps/client/src/ui/challenge-workbench.js";
for (const [expression, value] of [
  ["(40 + 25) × 2", 130],
  ["14 * 3 + 8", 50],
  ["-5 + 3 * 4", 7],
  ["20 ÷ (2 + 3)", 4],
  [".5 + .25", 0.75],
  ["-(3 - 7)", 4],
] as const)
  assert.equal(calculateExpression(expression), value);
for (const expression of [
  'globalThis.fetch("evil")',
  "1/0",
  "alert(1)",
  "2**3",
  "(1+2",
  "2+",
  "Infinity",
  "NaN",
  "1;2",
])
  assert.throws(() => calculateExpression(expression));
console.log(
  "Workbench calculator checks passed: arithmetic, precedence, Unicode operators, and rejection of executable or invalid input.",
);
