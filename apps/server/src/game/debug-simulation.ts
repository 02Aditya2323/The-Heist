import type { ChallengeWorkbench } from "@heist/shared";
/** Executes only our finite authored repairs, never submitted source code. */
export function simulateDebug(
  id: string,
  w: ChallengeWorkbench,
  selections: Record<string, string>,
): string {
  const code = w.code!,
    line = (n: number) => selections[n] || code.split("\n")[n - 1],
    numbers = (pattern: RegExp) =>
      code.match(pattern)![1].split(",").map(Number);
  const comparison = (v: number, text: string, limit: number) =>
    text.includes(">=")
      ? v >= limit
      : text.includes("<=")
        ? v <= limit
        : text.includes("!=")
          ? v !== limit
          : text.includes("==")
            ? v === limit
            : text.includes(">")
              ? v > limit
              : v < limit;
  if (id === "ST-02") {
    const a = numbers(/amounts = \[([^\]]+)\]/),
      condition = line(4),
      limit = Number(condition.match(/(?:>|<|==|!=)\s*(\d+)/)?.[1] || 0);
    return String(
      a
        .filter((v) => comparison(v, condition, limit))
        .reduce((a, b) => a + b, 0),
    );
  }
  if (id === "SD-04") {
    const a = numbers(/r\[5\] = \{([^}]+)\}/),
      loop = line(5),
      start = Number(loop.match(/i = (\d+)/)?.[1] || 0),
      end = Number(loop.match(/i < (\d+)/)?.[1] || 5),
      update = line(6);
    let total = 0;
    return a
      .slice(start, end)
      .map((v) => {
        if (v === 0 && update.includes("total = 0")) total = 0;
        else if (v === 0 && update.includes("total++")) total++;
        else total += v;
        return total;
      })
      .join(" ");
  }
  if (id === "SD-05") {
    const n = Number(code.match(/posts = (\d+)/)![1]),
      loop = line(4),
      count = loop.includes("posts + 1")
        ? n + 1
        : loop.includes("posts - 1")
          ? n - 2
          : loop.includes("<=")
            ? n
            : n - 1;
    return (
      Array.from({ length: count }, (_, i) => `Post ${i + 1}`).join("\n") +
      `\nTotal ${count}`
    );
  }
  if (id === "EX-03") {
    const a = numbers(/v\[6\] = \{([^}]+)\}/),
      decl = line(4),
      loop = line(5),
      condition = line(6),
      start = Number(loop.match(/i = (\d+)/)?.[1] || 0),
      end = Number(loop.match(/i < (\d+)/)?.[1] || 5),
      limit = Number(condition.match(/(?:>=|>|<)\s*(\d+)/)![1]),
      selected = a
        .slice(start, end)
        .filter((v) => comparison(v, condition, limit));
    return `${Number(decl.match(/count = (\d+)/)?.[1] || 0) + selected.length} ${Number(decl.match(/sum = (\d+)/)?.[1] || 0) + selected.reduce((a, b) => a + b, 0)}`;
  }
  if (id === "RC-02") {
    const n = Number(code.match(/n = (\d+)/)![1]),
      repair = line(3),
      end = repair.includes("n + 2")
        ? n + 1
        : repair.includes("n + 1") || repair.includes("i <= n")
          ? n
          : n - 1;
    return String((end * (end + 1)) / 2);
  }
  if (id === "BR-08") {
    const rows = [...code.matchAll(/\{([\d, ]+)\}/g)].map((m) =>
        m[1].split(",").map(Number),
      ),
      limit = Number(code.match(/>= (\d+)/)![1]),
      decl = line(4),
      condition = line(7),
      reset = decl.includes("inside");
    let count = decl.includes("count = 1") ? 1 : 0;
    return rows
      .map((row) => {
        if (reset) count = 0;
        count += row.filter((v) => comparison(v, condition, limit)).length;
        return count;
      })
      .join(" ");
  }
  if (id === "BL-05") {
    const a = numbers(/costs = \[([^\]]+)\]/),
      decl = line(2),
      condition = line(5),
      update = line(6);
    let best = decl.includes("costs[0]")
        ? a[0]
        : decl.includes("costs[-1]")
          ? a.at(-1)!
          : decl.includes("-1")
            ? -1
            : 0,
      index = 0;
    for (let i = 1; i < a.length; i++)
      if (comparison(a[i], condition, best)) {
        if (update.includes("best = costs[i]")) best = a[i];
        if (update.includes("best_index = i")) index = i;
        else if (update.includes("best_index = 0")) index = 0;
      }
    return `Route ${index + 1} costs ${best}`;
  }
  throw new Error("Unknown authored debug simulation");
}
