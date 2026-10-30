/** No arbitrary target URL: this runner can only create its own fresh disposable server. */
export function gameplayOptions(args: string[]) {
  const values = new Map<string, string>();
  for (const arg of args) {
    const m = /^--(bots|seconds|event-minutes|seed)=(\d+)$/.exec(arg);
    if (!m || values.has(m[1]))
      throw new Error(`Invalid/duplicate option: ${arg}`);
    values.set(m[1], m[2]);
  }
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const n = Number(values.get(key) ?? fallback);
    if (!Number.isSafeInteger(n) || n < min || n > max)
      throw new Error(`${key} must be ${min}–${max}`);
    return n;
  };
  const eventMinutes = integer("event-minutes", 10, 10, 180);
  return {
    bots: integer("bots", 40, 8, 40),
    seconds: integer("seconds", eventMinutes * 60 + 20, 150, 11000),
    eventMinutes,
    seed: integer("seed", 42, 0, 2147483647),
  };
}
