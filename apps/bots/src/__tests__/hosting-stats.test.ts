import { describe, it, expect } from "vitest";
import { Samples, hostingOptions, hostingGates } from "../hosting-stats.js";

describe("hosting suite fails closed and bounds its own memory", () => {
  it("defaults to 40 operators and known finite profiles", () => {
    expect(hostingOptions([])).toMatchObject({
      bots: 40,
      seconds: 45,
      profile: "smoke",
    });
    expect(hostingOptions(["--profile=soak"]).seconds).toBe(10800);
  });
  it.each([
    "--bots=41",
    "--bots=NaN",
    "--seconds=0",
    "--seconds=1.5",
    "--profile=unknown",
    "--oops",
    "--bots=4junk",
  ])("rejects invalid input %s", (arg) => {
    expect(() => hostingOptions([arg])).toThrow();
  });
  it("requires deliberate rehearsal confirmation and fixture for external targets", () => {
    expect(() => hostingOptions(["--url=http://host:8765"])).toThrow();
    expect(() =>
      hostingOptions(["--url=http://host:8765", "--confirm-rehearsal"]),
    ).toThrow();
    expect(
      hostingOptions([
        "--url=http://host:8765",
        "--fixture=test.json",
        "--confirm-rehearsal",
      ]).url,
    ).toBe("http://host:8765");
    expect(() =>
      hostingOptions([
        "--url=http://secret@host",
        "--fixture=x",
        "--confirm-rehearsal",
      ]),
    ).toThrow();
  });
  it("rejects duplicate flags and conflicting serving/remote configuration", () => {
    expect(() => hostingOptions(["--bots=4", "--bots=5"])).toThrow();
    expect(() =>
      hostingOptions([
        "--serve",
        "--url=http://host",
        "--fixture=x",
        "--confirm-rehearsal",
      ]),
    ).toThrow();
    expect(() => hostingOptions(["--port=80"])).toThrow();
  });
  it("keeps exact totals with a bounded deterministic sample reservoir", () => {
    const sample = new Samples(16),
      copy = new Samples(16);
    for (let i = 1; i <= 10000; i++) {
      sample.add(i);
      copy.add(i);
    }
    expect(sample.summary()).toEqual(copy.summary());
    expect(sample.summary()).toMatchObject({
      count: 10000,
      retained: 16,
      mean: 5000.5,
      max: 10000,
      approximate: true,
    });
    expect(() => sample.add(NaN)).toThrow();
    expect(new Samples().summary().p99).toBeNull();
  });
  const good = {
    connected: 40,
    expected: 40,
    moves: 400,
    acks: 400,
    rejects: 0,
    errors: 0,
    disconnects: 0,
    aoiChecks: 40,
    aoiFailures: 0,
    resumes: 40,
    eventStates: 200,
    exercise: true,
    auditOk: true,
    coverageOk: true,
    metrics: 10,
    tickP99: 2,
    overruns: 0,
    backpressure: 0,
    malformed: 0,
    rateDrops: 0,
    ackP99: 55,
    healthP99: 20,
    rssMax: 150,
    rssGrowth: null,
    loopP99: 30,
    cpuMean: 5,
    remote: false,
  };
  it("accepts a healthy fully exercised run", () => {
    expect(Object.values(hostingGates(good)).every((g) => g.passed)).toBe(true);
  });
  it.each([
    { acks: 399 },
    { aoiChecks: 0 },
    { aoiFailures: 1 },
    { exercise: false },
    { auditOk: false },
    { coverageOk: false },
    { metrics: 0 },
    { ackP99: null },
    { healthP99: null },
    { connected: 39 },
    { resumes: 39 },
    { errors: 1 },
    { rateDrops: 1 },
    { overruns: 1 },
    { rssGrowth: 200 },
    { cpuMean: null },
  ])("does not pass missing/failed measurements %j", (bad) => {
    expect(
      Object.values(hostingGates({ ...good, ...bad })).every((g) => g.passed),
    ).toBe(false);
  });
});
