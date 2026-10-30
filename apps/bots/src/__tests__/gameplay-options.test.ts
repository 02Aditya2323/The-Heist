import { expect, it } from "vitest";
import { gameplayOptions } from "../gameplay-options.js";
it("defaults to a complete condensed local event", () => {
  expect(gameplayOptions([])).toEqual({
    bots: 40,
    seconds: 620,
    eventMinutes: 10,
    seed: 42,
  });
});
it("supports a bounded normal-timeline run", () => {
  expect(
    gameplayOptions(["--event-minutes=180", "--seconds=900", "--bots=40"]),
  ).toMatchObject({ eventMinutes: 180, seconds: 900, bots: 40 });
});
it.each([
  "--url=http://localhost:8080",
  "--bots=41",
  "--bots=7",
  "--seconds=NaN",
  "--seconds=149",
  "--event-minutes=1",
  "--seed=-1",
  "--bots=8junk",
  "--unknown=1",
])("refuses unsafe/invalid input %s", (arg) => {
  expect(() => gameplayOptions([arg])).toThrow();
});
it("rejects duplicate options", () => {
  expect(() => gameplayOptions(["--bots=8", "--bots=40"])).toThrow();
});
