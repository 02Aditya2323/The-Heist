/**
 * Logical audit of every challenge template.
 *
 * The existing checks cover presentation (briefs are complete) and workbench
 * arithmetic. This one asks a different question: for every template, across
 * many seeded variants, is the challenge actually coherent?
 *
 * A challenge is incoherent if its own stated answer does not validate, if the
 * format example would be accepted as a solution, if the answer is visible in
 * the prompt, if two players get the same variant, or if the same player gets a
 * different puzzle on a reload. Each of those is silent: the game runs, and a
 * player loses a paid contract to it.
 *
 * Run: npx tsx tools/check-challenge-logic.mts [variantsPerTemplate]
 */
import { CHALLENGE_CATALOGUE } from '../apps/server/src/game/challenge-catalogue.js';
import { generateFinalChallenge } from '../apps/server/src/game/final-challenges.js';

const VARIANTS = Number(process.argv[2] || 24);
const SECRET = 'challenge-logic-audit-secret';

interface Finding { id: string; variant: string; check: string; detail: string; }
const findings: Finding[] = [];
const add = (id: string, variant: string, check: string, detail: string) =>
  findings.push({ id, variant, check, detail });

// Values that should never be accepted by any validator. A validator that says
// yes to these is not checking anything.
const JUNK = ['', ' ', 'x', '0', 'undefined', 'null', 'NaN', 'aaaaaaaa', '!!!'];
// Text that signals an unfinished template rather than a real puzzle.
const PLACEHOLDER = /\b(TODO|FIXME|TBD|lorem ipsum|placeholder|xxx+|undefined|NaN|\[object Object\])\b/i;

const normalise = (s: string) => s.trim().replace(/\s+/g, ' ').toUpperCase();

for (const spec of CHALLENGE_CATALOGUE) {
  const id = spec.id;
  const answers = new Set<string>();
  const prompts = new Set<string>();

  for (let i = 0; i < VARIANTS; i++) {
    const player = `auditor-${i}`;
    const variant = `v${i}`;
    let c;
    try {
      c = generateFinalChallenge(SECRET, player, id, variant);
    } catch (e) {
      add(id, variant, 'generates', (e as Error).message);
      continue;
    }

    // 1. The challenge must accept its own answer. Anything else means a paid
    //    contract can be solved correctly and still be rejected.
    try {
      if (!c.validate(c.answer)) add(id, variant, 'self-consistent', `validate() rejects its own answer ${JSON.stringify(c.answer)}`);
    } catch (e) {
      add(id, variant, 'self-consistent', `validate() threw on its own answer: ${(e as Error).message}`);
    }

    // 2. Whitespace and case must not decide a player's money, where the
    //    contract says they are forgiven.
    try {
      if (c.validate(c.answer) && !c.validate(`  ${c.answer}  `))
        add(id, variant, 'whitespace-tolerant', 'surrounding whitespace changes the verdict');
    } catch { /* a validator may legitimately reject malformed input by throwing */ }

    // 3. Junk must not pass.
    for (const junk of JUNK) {
      if (normalise(junk) === normalise(c.answer)) continue;
      try {
        if (c.validate(junk)) add(id, variant, 'rejects-junk', `accepts ${JSON.stringify(junk)}`);
      } catch { /* throwing on junk is fine */ }
    }

    // 4. The worked example must never be a solution.
    const example = c.brief?.example;
    if (example) {
      try {
        if (c.validate(example)) add(id, variant, 'example-not-answer', `the format example ${JSON.stringify(example)} is accepted as the answer`);
      } catch { /* fine */ }
    }

    // 5. The answer must not be sitting in the text the player is shown.
    const shown = [c.prompt, c.brief?.scenario, c.brief?.task, c.brief?.data, c.objective]
      .filter(Boolean).join('\n');
    const ans = c.answer?.trim() ?? '';
    if (ans.length >= 4 && normalise(shown).includes(normalise(ans)))
      add(id, variant, 'no-answer-leak', `the answer ${JSON.stringify(ans)} appears in the text shown to the player`);

    // 6. Nothing unfinished or malformed on screen.
    if (PLACEHOLDER.test(shown)) add(id, variant, 'no-placeholder', `shown text contains placeholder or malformed output: ${shown.match(PLACEHOLDER)?.[0]}`);
    if (!ans) add(id, variant, 'has-answer', 'answer is empty');
    if (!c.prompt?.trim()) add(id, variant, 'has-prompt', 'prompt is empty');

    // 7. The brief must be complete and must state a format.
    for (const field of ['scenario', 'task', 'answerFormat'] as const) {
      if (!c.brief?.[field]?.trim()) add(id, variant, 'brief-complete', `brief.${field} is missing`);
    }

    // 8. Difficulty must be a sane, displayable number.
    if (!Number.isInteger(c.difficulty) || c.difficulty < 1 || c.difficulty > 5)
      add(id, variant, 'difficulty-range', `difficulty is ${c.difficulty}`);

    // 9. Determinism: the same player reloading must get the same puzzle.
    const again = generateFinalChallenge(SECRET, player, id, variant);
    if (again.answer !== c.answer || again.prompt !== c.prompt)
      add(id, variant, 'deterministic', 'regenerating the same variant produced a different puzzle');

    answers.add(c.answer);
    prompts.add(c.prompt);
  }

  // 10. Variants must actually differ, or players can pass answers around.
  //     Some templates legitimately have a small answer space (a yes/no style
  //     verdict), so this is reported against the prompt as well.
  if (answers.size === 1 && prompts.size === 1 && VARIANTS > 1)
    add(id, '*', 'variants-differ', `all ${VARIANTS} variants are identical in both prompt and answer`);
}

const byCheck = new Map<string, Finding[]>();
for (const f of findings) {
  if (!byCheck.has(f.check)) byCheck.set(f.check, []);
  byCheck.get(f.check)!.push(f);
}

console.log(`Audited ${CHALLENGE_CATALOGUE.length} templates x ${VARIANTS} variants = ${CHALLENGE_CATALOGUE.length * VARIANTS} generated challenges.`);
if (!findings.length) {
  console.log('Every template is self-consistent, deterministic, varied, leak-free and completely briefed.');
  process.exit(0);
}
console.log(`\n${findings.length} finding(s):\n`);
for (const [check, list] of byCheck) {
  const ids = [...new Set(list.map((f) => f.id))];
  console.log(`  ${check}  —  ${list.length} occurrence(s) across ${ids.length} template(s): ${ids.join(', ')}`);
  for (const f of list.slice(0, 4)) console.log(`      ${f.id} ${f.variant}: ${f.detail}`);
  if (list.length > 4) console.log(`      ... and ${list.length - 4} more`);
}
process.exit(1);
