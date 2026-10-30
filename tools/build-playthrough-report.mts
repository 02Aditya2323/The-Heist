/** Package real browser captures; this never renders or fabricates game screenshots. */
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
const directory = resolve("screenshots/playthrough-2026-10-14");
const read = (name: string) =>
  JSON.parse(readFileSync(join(directory, name), "utf8"));
const results = read("results.json") as {
  id: string;
  name: string;
  method: string;
  inputs: unknown;
  result: string;
  completionView?: string;
  before: string;
  played: string;
  complete: string;
}[];
const desktop = read("desktop.json") as {
  id: string;
  kind: string;
  files: string[];
}[];
const centres = read("centres.json") as {
  station: string;
  name: string;
  result: string;
  action: string;
  files: string[];
  errors?: unknown[];
}[];
const catalogue = JSON.parse(
  readFileSync("apps/server/src/game/challenge-catalogue.json", "utf8"),
) as { id: string }[];
const raw = JSON.parse(readFileSync("maps/art-world.json", "utf8"));
assert.equal(results.length, 42);
assert.equal(new Set(results.map((r) => r.id)).size, 42);
assert.deepEqual(
  results.map((r) => r.id).sort(),
  catalogue.map((r) => r.id).sort(),
);
assert.equal(desktop.length, 42);
assert.equal(new Set(desktop.map((r) => r.kind)).size, 17);
assert.equal(centres.length, 37);
assert(
  raw.hotspots
    .filter((h: any) => h.action !== "homes")
    .every((h: any) => centres.some((c) => c.station === h.id)),
);
assert(centres.every((c) => !c.errors?.length));
const frameNames = readdirSync(directory).filter((n) => n.endsWith(".jpg"));
for (const r of results)
  for (const name of [r.before, r.played, r.complete])
    assert(existsSync(join(directory, name)), `${r.id}: missing ${name}`);
for (const r of [...desktop, ...centres])
  for (const name of r.files)
    assert(existsSync(join(directory, name)), `Missing ${name}`);
const esc = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const link = (name: string, label: string) =>
  `[${label}](${join(directory, name).replaceAll("\\", "/")})`;
const sorted = [...results].sort(
  (a, b) =>
    catalogue.findIndex((c) => c.id === a.id) -
    catalogue.findIndex((c) => c.id === b.id),
);
const intro = `42/42 templates completed through visible UI controls in an isolated unpaid rehearsal. 17/17 workbench types exercised. ${frameNames.length} actual JPEG captures; 37 centre cards. No stored answers, variant seeds, private game state, direct answer requests or forced-solved state were used. Desktop references are fresh, unsolved personal variants; before/played/complete frames are the actual original narrow-view playthrough.\n\nThis does not certify real-event acquisition, payouts, simultaneous raid crews, every procedural variant or all 90 repeated Home addresses.`;
const findings = [
  "Recent completed-card retention uses attempt insertion order: a newly solved early-listed card can disappear once more than eight recent clears exist, jumping selection to a different card. Correct/cleared feedback still confirms acceptance; affected captures show the clear message instead of a retained verified card.",
  "The teleport maze has no key/door in this variant, but still says “key not acquired” on a valid completed route. The route is accepted; the wording is misleading for keyless boards.",
  "An unassigned reserve Home (H090) opens under its correct title but falls back to “YOUR SAFEHOUSE H001” rather than explicitly explaining that H090 is unassigned. Captured as centre-home-h090-unassigned.jpg.",
  "During normal five-second guess cooldowns the tool also says server verification is temporarily unavailable. The accurate countdown is shown below; the generic wording could be clearer.",
];
const rows = sorted.map((r) => {
  const d = desktop.find((d) => d.id === r.id)!;
  return `| ${r.name} | ${d.kind} | ${link(r.before, "Before")} · ${link(r.played, "Played")} · ${link(r.complete, "Accepted")} | ${d.files.map((f, i) => link(f, String(i + 1))).join(" · ")} |`;
});
const centreRows = centres.map(
  (c) =>
    `| ${c.name} (${c.station}) | ${c.action} | ${c.files.map((f, i) => link(f, String(i + 1))).join(" · ")} |`,
);
writeFileSync(
  join(directory, "SCREENSHOT_INDEX.md"),
  `# Every challenge / card playthrough\n\n${intro}\n\n## Findings\n\n${findings.map((f) => "- " + f).join("\n")}\n\n## All 42 challenges\n\nDesktop columns contain every scroll-page capture. Original playthrough images are narrow because the visible in-app browser pane was 319 × 764; the separate background desktop references naturally used 1280 × 720. No image was resized or AI-generated.\n\n| Challenge | Workbench | Actual playthrough | Desktop pages |\n| --- | --- | --- | --- |\n${rows.join("\n")}\n\n## All functional centres and Home card states\n\nAll 33 non-Home POIs, including seven route kiosks, plus own Home, other Home, unassigned reserve Home and Undercity Home guide. Listings were opened at legitimate server-validated nearby positions in disposable fixtures. Bank deposit was correctly denied during rehearsal; own Home protection was entered and left. Live payouts/Checkout/raid membership were not executed.\n\n| Centre | Type | Pages |\n| --- | --- | --- |\n${centreRows.join("\n")}\n\n## Per-challenge play details\n\n${sorted.map((r) => `### ${r.name}\n\n${r.method}\n\nResult: ${r.result}${r.completionView ? " · " + r.completionView : ""}.\n\n<details><summary>Actions / deductions (solution spoilers)</summary>\n\n\`\`\`json\n${JSON.stringify(r.inputs, null, 2)}\n\`\`\`\n\n</details>\n`).join("\n")}\n`,
);
const figures = (files: string[]) =>
  files
    .map(
      (f, i) =>
        `<a href="${esc(f)}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(f)}" alt="Actual game capture ${i + 1}"/><span>Frame ${i + 1}</span></a>`,
    )
    .join("");
const cards = sorted
  .map((r) => {
    const d = desktop.find((d) => d.id === r.id)!;
    return `<article class="item" data-search="${esc((r.name + " " + d.kind).toLowerCase())}"><h2>${esc(r.name)}</h2><p class="badge">${esc(d.kind)} / SERVER ACCEPTED</p><details open><summary>Desktop layout reference — fresh variant</summary><div class="frames">${figures(d.files)}</div></details><details><summary>Actual solve: before / played / accepted</summary><div class="frames">${figures([r.before, r.played, r.complete])}</div></details><p>${esc(r.method)}</p><details><summary>Solution / actions (spoilers)</summary><pre>${esc(JSON.stringify(r.inputs, null, 2))}</pre></details></article>`;
  })
  .join("");
const centreCards = centres
  .map(
    (c) =>
      `<article class="item" data-search="${esc((c.name + " " + c.station + " " + c.action).toLowerCase())}"><h2>${esc(c.name)}</h2><p class="badge">${esc(c.station)} / ${esc(c.action)}</p><div class="frames">${figures(c.files)}</div><p>${esc(c.result)}</p></article>`,
  )
  .join("");
writeFileSync(
  join(directory, "index.html"),
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>The Heist — all 42 challenge playthroughs</title><style>body{margin:0;background:#08131b;color:#dbe9ec;font:16px/1.6 system-ui}header,main{max-width:1400px;margin:auto;padding:24px}h1{font-size:clamp(28px,4vw,48px);line-height:1.1;color:#f3cf95}h2{font-size:20px;color:#f3cf95}input{width:100%;box-sizing:border-box;padding:14px;border:1px solid #4d6b76;border-radius:8px;background:#14232c;color:white;font:inherit}header{position:relative}a{color:#92e5e6}section{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:20px}.item{background:#11212a;border:1px solid #29454f;border-radius:14px;padding:18px;min-width:0}.badge{font:12px monospace;letter-spacing:1px;color:#9de1c7}.frames{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:12px 0}.frames a{display:block;text-decoration:none}.frames img{width:100%;height:150px;object-fit:contain;background:#050c12;border-radius:6px}.frames span{display:block;font-size:12px}summary{cursor:pointer;padding:8px 0;color:#a8d9e5}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}li{margin:8px 0}footer{padding:32px;color:#a2bbc6}.item[hidden]{display:none}</style><header><p class="badge">REAL BROWSER EVIDENCE / 14 OCTOBER 2026</p><h1>42 challenges. Played, not just opened.</h1><p>${esc(intro)}</p><p><a href="SCREENSHOT_INDEX.md">Full Markdown report</a> · <a href="results.json">Recorded solve details</a></p><label for="search">Find a challenge, workbench or centre</label><input id="search" placeholder="Try BG-01, cipher, raid, Bank…"><details><summary>Audit findings and limits</summary><ul>${findings.map((f) => "<li>" + esc(f) + "</li>").join("")}</ul></details></header><main><h2>All 42 challenges</h2><section>${cards}</section><h2>37 centre cards / Home states</h2><section>${centreCards}</section></main><footer>Every image is an unmodified captured game screen. Desktop reference variants are separate from original solved variants. Real saved-event data was not used or reset.</footer><script>document.getElementById('search').addEventListener('input',function(){const q=this.value.toLowerCase().trim();document.querySelectorAll('.item').forEach(e=>e.hidden=!e.dataset.search.includes(q));});</script></html>`,
);
writeFileSync(
  join(directory, "coverage.json"),
  JSON.stringify(
    {
      templates: results.length,
      workbenchKinds: [...new Set(desktop.map((d) => d.kind))],
      centres: centres.length,
      screenshots: frameNames.length,
      findings,
      scope: intro,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    {
      verified: results.length,
      desktop: desktop.length,
      centres: centres.length,
      screenshots: frameNames.length,
      index: join(directory, "index.html"),
    },
    null,
    2,
  ),
);
