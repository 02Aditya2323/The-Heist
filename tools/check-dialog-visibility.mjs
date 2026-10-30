#!/usr/bin/env node
/**
 * Refuse a CSS `display` rule on a <dialog> that is not scoped to its open
 * state.
 *
 * Why this gate exists. The browser hides a closed dialog through a user agent
 * stylesheet rule equivalent to hiding any dialog without the open attribute.
 * That rule has the lowest possible precedence, so any author `display`
 * declaration on the same element silently defeats it and the dialog paints
 * from the moment the page loads: full size, opaque, in the normal flow, on
 * top of the game.
 *
 * This is exactly what shipped in the operator console. A bare
 * `.oc-dialog { display: flex }` left an opaque 1180x900 panel pinned to the
 * top-left corner, covering most of the canvas for every player whether or not
 * they were staff, and it survived every existing check: the CSS is valid, the
 * markup is correct, the build is clean and no test renders a page.
 *
 * The failure mode is quiet and total, so it is worth a dedicated gate.
 *
 * Read-only. Exits non-zero naming the file, line and selector.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const clientSrc = resolve(root, "apps/client/src");

/** Selectors that address a <dialog> element in this codebase. */
const DIALOG_SELECTOR =
  /(^|[\s,>+~])(dialog\b|\.oc-dialog\b|\.staff-dialog\b|\.completion-dialog\b|\.interaction-choices\b|#terminal-dialog\b)/;

/** Each of these scopes a rule to the state in which the dialog is shown. */
const SCOPED = /\[open\]|:modal|::backdrop/;

function cssFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name);
    if (statSync(full).isDirectory()) out.push(...cssFiles(full));
    else if (name.endsWith(".css")) out.push(full);
  }
  return out;
}

const failures = [];
let blocksChecked = 0;

for (const file of [
  ...cssFiles(clientSrc),
  resolve(root, "apps/client/index.html"),
  resolve(root, "apps/client/game.html"),
]) {
  const raw = readFileSync(file, "utf8");

  // Comments are blanked first, preserving line count. A comment can contain
  // braces -- this file's own header describes one -- and leaving them in makes
  // every block boundary after it wrong.
  const text = raw.replace(/\/\*[\s\S]*?\*\//g, (c) =>
    c.replace(/[^\n]/g, " "),
  );

  // Walk declaration blocks. A deliberately small parser: these are plain CSS
  // files with no preprocessor, and a full parser would be more to trust.
  const block = /([^{}]*)\{([^{}]*)\}/g;
  let m;
  while ((m = block.exec(text)) !== null) {
    // The capture reaches back to the previous brace, so it can carry an
    // at-rule prelude or blank lines. Only the final line is the selector.
    const selector = m[1].split("\n").pop().trim();
    const body = m[2];
    if (!selector || selector.startsWith("@")) continue;

    // A rule targeting a descendant of the dialog is fine: it can only render
    // when the dialog itself does. Only the dialog element matters here.
    const targetsDialogItself = selector.split(",").some((part) => {
      const last = part.trim().split(/[\s>+~]+/).pop() ?? "";
      return DIALOG_SELECTOR.test(" " + last);
    });
    if (!targetsDialogItself) continue;

    blocksChecked++;
    if (SCOPED.test(selector)) continue;

    const display = /(^|;)\s*display\s*:\s*([^;]+)/.exec(body);
    if (!display) continue;
    if (display[2].trim() === "none") continue; // hiding is always safe

    const line = text.slice(0, m.index + m[1].length).split("\n").length;
    failures.push(
      `${relative(root, file)}:${line}  selector "${selector}" sets ` +
        `display: ${display[2].trim()} on a dialog without an [open] scope.`,
    );
  }
}

console.log(
  `Checked ${blocksChecked} CSS rule(s) that target a <dialog> element directly.`,
);

if (failures.length) {
  console.error(`\n${failures.length} dialog(s) would stay painted while closed:`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error(
    "\nScope the rule to the shown state, for example `.oc-dialog[open]`.\n" +
      "An unscoped display declaration overrides the user agent rule that\n" +
      "hides a closed dialog, and the panel then covers the game.",
  );
  process.exit(1);
}
console.log("No dialog can paint while closed.");
