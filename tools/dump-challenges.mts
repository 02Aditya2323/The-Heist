/**
 * Print the player-facing brief for challenges, as the terminal will show it.
 *
 * Authoring aid for reviewing presentation across the catalogue. The real
 * answer is printed last and clearly marked, because this tool reads the
 * server-side generator directly and its output must never be shown to players.
 *
 * Usage: npx tsx tools/dump-challenges.mts [ID ...]
 */
import { generateFinalChallenge } from "../apps/server/src/game/final-challenges.js";
import { CHALLENGE_CATALOGUE } from "../apps/server/src/game/challenge-catalogue.js";

const only = process.argv.slice(2);
const indent = (text: string) => "  " + text.replace(/\n/g, "\n  ");

for (const spec of CHALLENGE_CATALOGUE) {
  if (only.length && !only.includes(spec.id)) continue;
  const m = generateFinalChallenge("secret", "player1", spec.id, "v1");
  const b = m.brief;
  console.log("=".repeat(78));
  console.log(`${spec.id}  ${spec.title}    [workbench: ${m.workbench.kind}]`);
  console.log(`CLIENT / ${m.client}`);
  console.log("\nTHE SITUATION");
  console.log(indent(b.scenario));
  console.log("\nYOUR TASK");
  console.log(indent(b.task));
  if (b.data) {
    console.log("\nWHERE THE EVIDENCE IS");
    console.log(indent(b.data));
  }
  console.log("\nANSWER FORMAT");
  console.log(indent(b.answerFormat));
  if (b.example) {
    console.log("\nA CORRECTLY FORMATTED ANSWER");
    console.log(indent(`${b.example}   (example of the format only)`));
  }
  console.log("\n[server-side only, never shown to players]", JSON.stringify(m.answer));
}
