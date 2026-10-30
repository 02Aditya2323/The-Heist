import { createHmac } from "node:crypto";
import { EVENT_RULES } from "./rules.js";
import { CHALLENGE_CATALOGUE } from "./challenge-catalogue.js";
export { generateFinalChallenge as generateChallenge } from "./final-challenges.js";
export interface Template {
  id: string;
  title: string;
  topic: string;
  district: string;
  tier: string;
  reward: number;
  station?: string;
  language?: string;
  raidTier?: string;
}
const definitions = [
  ["ST-01", "Broken payroll", "CP", "tech"],
  ["ST-02", "Dockside receipts", "SQL", "harbor"],
  ["ST-03", "The signal pattern", "Logic", "tech"],
  ["SD-01", "Rolling blackout", "CP", "tech"],
  ["SD-02", "Intercepted dispatch", "CP", "tech"],
  ["SD-03", "Off-by-one", "Debugging", "tech"],
  ["SD-04", "Find the fracture", "Debugging", "tech"],
  ["SD-05", "Ghost invoices", "SQL", "harbor"],
  ["SD-06", "Duplicate identities", "SQL", "harbor"],
  ["SD-07", "Silent port", "Network", "harbor"],
  ["SD-08", "Weak evidence", "Crypto", "black"],
  ["SD-09", "Paper trail", "OSINT", "harbor"],
  ["SD-10", "Crossed wires", "Logic", "tech"],
  ["EX-01", "Cargo optimizer", "DSA", "tech"],
  ["EX-02", "Service recovery", "Debugging", "tech"],
  ["EX-03", "Ledger windows", "SQL", "harbor"],
  ["EX-04", "Forged clearance", "CTF", "black"],
  ["EX-05", "Midnight intruder", "Forensics", "black"],
  ["BG-01", "Keypad intercept", "Logic", "under"],
  ["BG-02", "Rotating tumblers", "Logic", "under"],
  ["BG-03", "Nested vault", "Logic", "under"],
  ...[1, 2, 3].map((n) => [
    `RC-0${n}`,
    ["Rush hour", "Query race", "Hot patch"][n - 1],
    ["CP", "SQL", "Debugging"][n - 1],
    "central",
  ]),
  ...[1, 2, 3].map((n) => [
    `GH-0${n}`,
    ["Lost keycards", "Courier manifest", "Server sprint"][n - 1],
    "Logic",
    "nexus",
  ]),
  ...Array.from({ length: 10 }, (_, i) => [
    `BR-${String(i + 1).padStart(2, "0")}`,
    `Bank breach ${i + 1}`,
    [
      "DSA",
      "DSA",
      "Debugging",
      "Debugging",
      "SQL",
      "SQL",
      "Crypto",
      "Crypto",
      "Forensics",
      "Network",
    ][i],
    "central",
  ]),
  ...["DSA", "Debugging", "SQL", "CTF", "Forensics"].map((t, i) => [
    `BL-0${i + 1}`,
    `Black Ledger / ${t}`,
    t,
    "central",
  ]),
];
/**
 * The prize for a template, read from the live rules at the moment of use.
 *
 * This used to be copied into each template when the module loaded, so an
 * organizer changing a prize in the console re-funded the pools for the new
 * amount while every contract kept paying the old one, draining a pool early
 * or stranding money in it. A getter keeps payouts and pools in step.
 */
export function rewardFor(id: string) {
  return id.startsWith("ST")
    ? EVENT_RULES.starterPay
    : id.startsWith("SD")
      ? EVENT_RULES.standardPay
      : id.startsWith("EX")
        ? EVENT_RULES.expertPay
        : 0;
}
const withLiveReward = <T extends { id: string }>(t: T) =>
  Object.defineProperty(t, "reward", {
    get: () => rewardFor(t.id),
    enumerable: true,
  }) as T & { reward: number };

export const legacyTemplates: Template[] = definitions.map(
  ([id, title, topic, district]) =>
    withLiveReward({
      id,
      title,
      topic,
      district,
      tier: id.slice(0, 2),
    }),
);
export const STATIONS: Record<string, { id: string; district: string }> = {
  "CP Lab": { id: "cp-lab", district: "tech" },
  "Debugging Lab": { id: "debug-lab", district: "tech" },
  "Logic Terminal": { id: "logic", district: "tech" },
  "Data Centre": { id: "data-centre", district: "harbor" },
  "Code Review Desk": { id: "sql", district: "harbor" },
  "Network Tower": { id: "network-tower", district: "harbor" },
  "OSINT Terminal": { id: "osint", district: "harbor" },
  "CTF Arena": { id: "ctf", district: "black" },
  "Challenge Terminal": { id: "black-challenge", district: "black" },
  "Sandbox Station": { id: "sandbox", district: "black" },
};
export const templates: Template[] = CHALLENGE_CATALOGUE.map((t) => withLiveReward({
  id: t.id,
  title: t.title,
  topic: t.type,
  language: t.language,
  station: STATIONS[t.station]?.id,
  district:
    STATIONS[t.station]?.district ||
    (t.id.startsWith("BG")
      ? "under"
      : t.id.startsWith("GH")
        ? "nexus"
        : "central"),
  tier: t.id.slice(0, 2),
  raidTier: t.group.startsWith("Raid tier") ? t.group.at(-1) : undefined,
}));
export function generateLegacyChallenge(
  secret: string,
  player: string,
  id: string,
  variant = "0",
): { prompt: string; answer: string } {
  const template = legacyTemplates.find((t) => t.id === id);
  if (!template) throw new Error("Unknown challenge");
  const digest = createHmac("sha256", secret)
    .update(`${player}:${id}:${variant}`)
    .digest();
  const seal = digest.toString("hex").slice(0, 10);
  let state = digest.readUInt32LE(0) || 1;
  const rand = (n: number) => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) % n;
  };
  const nums = Array.from(
    { length: template.tier === "EX" || template.tier === "BL" ? 18 : 10 },
    () => rand(90) + 10,
  );
  const a = rand(20) + 2,
    b = rand(9) + 2;
  const out = (prompt: string, answer: string | number) => ({
    prompt,
    answer: String(answer),
  });
  if (["EX-01", "BR-02", "BL-01"].includes(id)) {
    const items = nums.map((v, i) => ({ w: 2 + (v % 13), v: v + a + i })),
      capacity = id === "BL-01" ? 57 : 39,
      dp = Array(capacity + 1).fill(0);
    for (const item of items)
      for (let w = capacity; w >= item.w; w--)
        dp[w] = Math.max(dp[w], dp[w - item.w] + item.v);
    return out(
      `Cargo optimizer / 0–1 knapsack. Each packet can be carried once. Capacity = ${capacity}. Find the maximum total value without exceeding capacity.\nPackets (weight,value):\n${items.map((x) => `${x.w},${x.v}`).join("\n")}`,
      Math.max(...dp),
    );
  }
  if (["EX-02", "BL-02"].includes(id)) {
    const operations = nums.map((n, i) => ({ key: `tx-${i % 7}`, amount: n }));
    const seen = new Set<string>();
    let total = 0;
    for (const op of operations) {
      if (!seen.has(op.key)) {
        seen.add(op.key);
        total += op.amount;
      }
    }
    return out(
      `Retry-safe ledger. The broken service processes every delivery. Repair it so ONLY the first occurrence of each transaction key changes the balance. Duplicate deliveries can have different amounts; keep the first. Starting balance ${a}. Then refund ${b}. Give the corrected final balance.\n${operations.map((x) => `${x.key}: +${x.amount}`).join("\n")}`,
      total + a - b,
    );
  }
  if (["EX-03", "BR-06", "BL-03"].includes(id)) {
    const rows = nums.map((amount, i) => ({ id: i + 1, owner: i % 4, amount }));
    let total = 0;
    for (let owner = 0; owner < 4; owner++)
      total += rows
        .filter((r) => r.owner === owner)
        .sort((x, y) => y.amount - x.amount || x.id - y.id)
        .slice(0, 2)
        .reduce((s, r) => s + r.amount, 0);
    return out(
      `Ledger window query. For EACH owner, rank rows by amount DESC, id ASC. Keep exactly the first two per owner. Submit the sum of all retained amounts.\nRows (id,owner,amount):\n${rows.map((r) => `${r.id},${r.owner},${r.amount}`).join("\n")}`,
      total,
    );
  }
  if (["EX-04", "BL-04"].includes(id)) {
    const token = Buffer.from(
      JSON.stringify({ role: "administrator", clearance: a, exp: b }),
    ).toString("base64");
    return out(
      `Simulated unsigned-token sandbox. A vulnerable verifier trusts the decoded role and clearance without checking a signature. Evidence token (base64):\n${token}\n\nDetermine the role and clearance that the vulnerable service accepts. Variant seal: ${seal}. Submit HEIST{role_clearance_seal}. This is an offline transcript; no network access is required.`,
      `HEIST{administrator_${a}_${seal}}`,
    );
  }
  if (["EX-05", "BL-05"].includes(id)) {
    const account = `svc_${a}`,
      time = `03:${String(b * 3).padStart(2, "0")}`;
    return out(
      `Forensic reconstruction. Find the account responsible for the FIRST successful privileged archive read after token renewal. Submit "account HH:MM".\n03:00 svc_${a + 1} READ archive DENY\n03:02 ${account} LOGIN FAIL\n03:04 ${account} TOKEN_RENEW OK\n${time} ${account} READ archive OK\n04:01 svc_${a + 1} READ archive OK\n04:03 ${account} READ archive OK`,
      `${account} ${time}`,
    );
  }
  if (id === "BR-03") {
    const corrected = nums
      .map((n, i) => (i % 2 ? n - a : n + b))
      .filter((n) => n > 40)
      .sort((x, y) => x - y);
    return out(
      `Pipeline repair: (1) add ${b} to readings at EVEN indices, subtract ${a} at ODD indices (0-based); (2) discard readings <=40; (3) numeric sort ascending. The buggy service uses string sorting and reverses index parity. Submit the correct retained readings joined by commas.\n${nums.join(", ")}`,
      corrected.join(","),
    );
  }
  if (id === "BR-04") {
    const weights = nums.slice(0, 8),
      memo = new Map<number, number>();
    const visit = (i: number): number => {
      if (i >= weights.length) return 0;
      if (memo.has(i)) return memo.get(i)!;
      const result = Math.max(visit(i + 1), weights[i] + visit(i + 2));
      memo.set(i, result);
      return result;
    };
    return out(
      `Patch the optimizer: adjacent vault sensors cannot both be disabled. Choose any subset of non-adjacent positions to maximize the total reading. The buggy greedy function picks the largest sensor repeatedly. Submit the true optimum.\n${weights.join(", ")}`,
      visit(0),
    );
  }
  if (id === "BR-05") {
    const rates = [a, b, a + b],
      owners = nums.map((n, i) => ({ owner: i % 3, amount: n }));
    return out(
      `Join two offline tables and aggregate. invoices(owner,amount):\n${owners.map((r) => `${r.owner},${r.amount}`).join("\n")}\nweights(owner,multiplier):\n${rates.map((n, i) => `${i},${n}`).join("\n")}\nSubmit SUM(invoice.amount * weight.multiplier) after joining on owner.`,
      owners.reduce((s, r) => s + r.amount * rates[r.owner], 0),
    );
  }
  if (id === "BR-07") {
    const text = `VAULT-${a}-${b}`,
      cipher = Buffer.from(
        text
          .split("")
          .map((c) => String.fromCharCode(c.charCodeAt(0) ^ a))
          .join(""),
        "latin1",
      ).toString("hex");
    return out(
      `Hex evidence was produced by XORing every ASCII byte of a plaintext string with decimal key ${a}. Decode the hex, then undo XOR. Submit the plaintext.\n${cipher}`,
      text,
    );
  }
  if (id === "BR-08") {
    const n = 100 + rand(500),
      mod = 97,
      power = 7;
    let result = 1;
    for (let i = 0; i < power; i++) result = (result * n) % mod;
    return out(
      `A toy cryptographic relay sends C = M^7 mod 97. For M=${n}, compute C using exact integer arithmetic. Variant seal: ${seal}. Submit HEIST{C_seal}. This models only a simulated cipher.`,
      `HEIST{${result}_${seal}}`,
    );
  }
  if (id === "BR-09") {
    const pairs = nums.slice(0, 6).map((v, i) => ({
      t: i * 2 + 1,
      host: `h${i}`,
      badge: 100 + i * 10 + (v % 10),
    }));
    const culprit = pairs[b % 6];
    return out(
      `Correlate logs. Badge registry: ${pairs.map((p) => `${p.badge}=${p.host}`).join("; ")}.\nArchive reads: ${pairs.map((p) => `minute ${p.t}, badge ${p.badge}`).join("; ")}.\nThe integrity monitor reports a corrupted snapshot first at minute ${culprit.t + 1}. Each archive read changes its snapshot exactly one minute later. Submit the responsible host.`,
      culprit.host,
    );
  }
  if (id === "BR-10") {
    const octets = [10, rand(200) + 1, rand(250), rand(250)],
      bits = 26,
      network = octets[3] & 192;
    return out(
      `Subnet reconstruction: client ${octets.join(".")}/${bits}. Give the network address (dotted decimal, without /26). A /26 mask is 255.255.255.192.`,
      `${octets[0]}.${octets[1]}.${octets[2]}.${network}`,
    );
  }
  if (id === "RC-01")
    return out(
      `Speed round: count pairs of DIFFERENT array indices i<j whose sum is divisible by ${b}.\n${nums.join(", ")}`,
      nums.reduce(
        (s, n, i) =>
          s + nums.slice(i + 1).filter((m) => (m + n) % b === 0).length,
        0,
      ),
    );
  if (id === "RC-02")
    return out(
      `Speed SQL: SELECT COUNT(*) FROM packets WHERE amount BETWEEN ${a + 20} AND ${a + 60}; Both bounds are inclusive.\namount: ${nums.join(", ")}`,
      nums.filter((n) => n >= a + 20 && n <= a + 60).length,
    );
  if (id === "RC-03")
    return out(
      `Hot patch: the function must compute XOR of every integer, starting at 0. The broken service used bitwise OR. Submit the fixed checksum.\n${nums.join(", ")}`,
      nums.reduce((s, n) => s ^ n, 0),
    );
  if (id === "GH-01")
    return out(
      `Keycard verification. Recover the check digit: sum the decimal digits of ${nums[0] * 10000 + nums[1] * 100 + nums[2]}, then take modulo 10. Submit the single digit.`,
      String(nums[0] * 10000 + nums[1] * 100 + nums[2])
        .split("")
        .reduce((s, c) => s + Number(c), 0) % 10,
    );
  if (id === "GH-02")
    return out(
      `Courier manifest: ${nums.join(", ")}. All parcels but ONE occur an even number of times in this sealed manifest: ${[...nums, ...nums, nums[0] + 100].sort((x, y) => x - y).join(", ")}. Submit the unmatched parcel ID.`,
      nums[0] + 100,
    );
  if (id === "GH-03")
    return out(
      `Server sprint: readings ${nums.join(", ")}. Sort numerically ascending; calculate the sum of the smallest 4 values.`,
      nums
        .slice()
        .sort((x, y) => x - y)
        .slice(0, 4)
        .reduce((s, n) => s + n, 0),
    );
  if (id === "SD-10")
    return out(
      `Deduction lock: three operators have distinct keys numbered ${a}, ${a + 1}, ${a + 2}. Ada has the middle key. Bo has a smaller key than Cy. Submit Cy's key.`,
      a + 2,
    );
  if (id === "ST-01")
    return out(
      `A payroll relay lost its total. Add these integer amounts. Submit only the total.\n\n${nums.join(", ")}`,
      nums.reduce((x, y) => x + y, 0),
    );
  if (id === "ST-02")
    return out(
      `Receipts (id, amount):\n${nums.map((n, i) => `${i + 1}, ${n}`).join("\n")}\n\nSELECT SUM(amount) FROM receipts WHERE amount >= ${a + 40};\nSubmit the query result.`,
      nums.filter((n) => n >= a + 40).reduce((x, y) => x + y, 0),
    );
  if (id === "ST-03")
    return out(
      `Find the next number. The difference between adjacent numbers is constant.\n${[0, 1, 2, 3, 4].map((i) => a + i * b).join(", ")}, ?`,
      a + 5 * b,
    );
  if (id === "SD-01" || template.topic === "DSA") {
    if (id === "SD-01") {
      const sums = nums
        .slice(2)
        .map((_, i) => nums[i] + nums[i + 1] + nums[i + 2]);
      return out(
        `Find the maximum sum of exactly 3 consecutive readings.\n${nums.join(", ")}`,
        Math.max(...sums),
      );
    }
    const n = 8,
      edges: Array<[number, number, number]> = [];
    for (let i = 0; i < n - 1; i++) {
      edges.push([i, i + 1, rand(20) + 1]);
      if (i + 2 < n) edges.push([i, i + 2, rand(30) + 1]);
    }
    const dist = Array(n).fill(Infinity);
    dist[0] = 0;
    for (const [u, v, w] of edges) dist[v] = Math.min(dist[v], dist[u] + w);
    return out(
      `Escape network: directed edges (from,to,cost). Find the minimum total cost from node 0 to node 7. No reverse edges.\n${edges.map((e) => e.join(",")).join("\n")}`,
      dist[7],
    );
  }
  if (id === "SD-02") {
    const plain = `OPEN GATE ${a}`;
    const cipher = plain.replace(/[A-Z]/g, (c) =>
      String.fromCharCode(((c.charCodeAt(0) - 65 + b) % 26) + 65),
    );
    return out(
      `Intercept: ${cipher}\nEvery letter was shifted ${b} positions forward in A–Z. Digits and spaces are unchanged. Submit the decoded dispatch.`,
      plain,
    );
  }
  if (id === "SD-04") {
    const arr = Array.from(new Set(nums)).sort((x, y) => x - y);
    return out(
      `Broken search returns NOT FOUND when target equals the final array element. Give the target value that demonstrates this error.\nArray: ${arr.join(", ")}`,
      arr[arr.length - 1],
    );
  }
  if (template.topic === "Debugging")
    return out(
      `Repair this off-by-one: the service must include ALL records with an even index (0-based). Submit the correct sum after changing i < data.length - 1 to i < data.length.\n\ndata = [${nums.join(", ")}]\ntotal = 0\nfor (i = 0; i < data.length - 1; i += 2) total += data[i]\n\nAlso include the final checksum offset ${a} in your answer.`,
      nums.filter((_, i) => i % 2 === 0).reduce((x, y) => x + y, 0) + a,
    );
  if (id === "SD-06") {
    const rows = [...nums, nums[0], nums[2], nums[0]];
    return out(
      `Count surplus rows after retaining exactly one row per distinct identity.\n${rows.join(", ")}`,
      rows.length - new Set(rows).size,
    );
  }
  if (template.topic === "SQL") {
    const rows = nums.map((n, i) => ({ id: i + 1, owner: i % 3, amount: n }));
    return out(
      `Local ledger rows (id,owner,amount):\n${rows.map((r) => `${r.id},${r.owner},${r.amount}`).join("\n")}\n\nSELECT SUM(amount) FROM ledger WHERE owner = ${a % 3} AND amount > ${b * 4};\nReturn the integer result (0 for no rows).`,
      rows
        .filter((r) => r.owner === a % 3 && r.amount > b * 4)
        .reduce((x, r) => x + r.amount, 0),
    );
  }
  if (template.topic === "Network")
    return out(
      `Firewall log: source | destination port | status\nnode-A | ${a + 4000} | DENY\nnode-B | ${b + 8000} | ALLOW\nnode-C | 443 | DENY\nFind the destination port of the only accepted connection.`,
      b + 8000,
    );
  if (template.topic === "OSINT" || template.topic === "Forensics")
    return out(
      `Offline evidence bundle — all times UTC.\n[badge registry] badge-${a} belongs to operator-${b}.\n[access log] 02:14 badge-${a} entered archive.\n[access log] 02:17 badge-${a + 1} entered lobby.\n[incident] unauthorized archive access at 02:14.\nSubmit the operator identifier and time separated by one space.`,
      `operator-${b} 02:14`,
    );
  if (template.topic === "Crypto") {
    const pin = 1000 + rand(9000);
    return out(
      `A simulated keypad uses the weak digest H(pin) = (pin × ${b} + ${a}). The leaked digest is ${pin * b + a}. Variant seal: ${seal}. Recover the four-digit pin and submit HEIST{pin_seal}.`,
      `HEIST{${pin}_${seal}}`,
    );
  }
  if (template.topic === "CTF")
    return out(
      `Offline sandbox transcript: access is granted when role = decoded token. The simulated service incorrectly trusts client role. Decode the ASCII codes and submit HEIST{decoded-role}. No external target is involved.\n${`admin${a}`
        .split("")
        .map((c) => c.charCodeAt(0))
        .join(" ")}`,
      `HEIST{admin${a}}`,
    );
  if (id === "BG-02")
    return out(
      `Four tumblers begin at ${a}, ${b}, ${a + b}, ${a * b}. Turn each by +3, then submit their SUM.`,
      a + b + a + b + a * b + 12,
    );
  if (id === "BG-03")
    return out(
      `Nested lock: start with ${a}. Multiply by ${b}, add ${nums[0]}, then XOR with ${nums[1]}. Submit the final integer.`,
      (a * b + nums[0]) ^ nums[1],
    );
  return out(
    `NEXUS sequence: begin with ${a}, repeatedly multiply by ${b} then subtract 1. What is the value after exactly 3 operations?`,
    ((a * b - 1) * b - 1) * b - 1,
  );
}
export function validAnswer(actual: string, expected: string): boolean {
  return (
    actual.trim().replace(/\s+/g, " ").toLowerCase() ===
    expected.trim().toLowerCase()
  );
}
