/** All event money and timing settings. Change prize settings only before a new event. */
export const MINUTE = 60_000;
export const EVENT_RULES = {
  durationMinutes: 180,
  total: 400_000,
  homeCount: 90,
  // Funds the Starter pool at starterPay x maxPlayers. Raised to 60 to match the
  // event's player target; the extra Rs 200 comes from the Black Ledger seed
  // below, not from the Treasury, which the organizer needs for live corrections.
  maxPlayers: 60,
  cap: 80_000,
  reactivate: 60_000,
  starterPay: 1000,
  standardPay: 2000,
  expertPay: 8000,
  standardSlots: 8,
  bankMax: 20_000,
  bankOpen: 10,
  bankFeeNumerator: 1,
  bankFeeDenominator: 1000,
  checkoutOpen: 150,
  minimumSolveMs: 5000,
  withdrawal: 5 * MINUTE,
  offline: 10 * MINUTE,
  lateJoin: 120,
  answerInterval: 5000,
  wrongLimit: 3,
  wrongWait: MINUTE,
  trainingLimit: 6,
  standardLock: 6 * MINUTE,
  expertLock: 10 * MINUTE,
  queueAccept: 30_000,
  queueLimit: 2,
  burglaryOpen: 40,
  burglaryClose: 175,
  homeMinimum: 2000,
  homeFloor: 500,
  homeCooldown: 10 * MINUTE,
  thiefCooldown: 30 * MINUTE,
  burglaryFee: 300,
  jail: 3 * MINUTE,
  bounty: 2000,
  burglaryLevels: [
    { share: 5, max: 1000, duration: 3 * MINUTE, clears: 0 },
    { share: 10, max: 2500, duration: 5 * MINUTE, clears: 5 },
    { share: 20, max: 5000, duration: 8 * MINUTE, clears: 12 },
  ],
  raidQuestions: 5,
  raidGate: 2,
  raidCrew: 10,
  smallRaidCrew: 8,
  smallRaidThreshold: 36,
  raidPass: 5,
  raidDuration: 15 * MINUTE,
  raidStand: MINUTE,
  raidDepositPercent: 10,
  raidQuestionMax: 16000,
  raidWindows: [
    { open: 45, close: 90, crewDeadline: 90 },
    { open: 90, close: 135, crewDeadline: 135 },
    { open: 150, close: 175, crewDeadline: 160 },
  ],
  raceDuration: 10 * MINUTE,
  raceNotice: 5 * MINUTE,
  raceRewards: [5000, 3000, 2000],
  eventDurations: [8 * MINUTE, 10 * MINUTE, 5 * MINUTE],
  eventChallengeDurations: [MINUTE, 3 * MINUTE, 3 * MINUTE],
  eventRewards: [
    [2000, 2000, 2000, 2000, 2000],
    [10000],
    [4000, 2500, 1500, 1000, 1000],
  ],
  waveTimes: [0, 20, 50, 80, 120],
  waveTemplates: [
    ["SD-01", "SD-02"],
    ["SD-04", "SD-06"],
    ["SD-03", "SD-08"],
    ["SD-05", "SD-09"],
    ["SD-07", "SD-10"],
  ],
  expertTimes: [30, 60, 90, 120, 140],
  expertTemplates: ["EX-01", "EX-04", "EX-02", "EX-05", "EX-03"],
  // Organizer schedule controls. An interval of 0 keeps the authored waveTimes
  // and expertTimes above; a positive interval generates an evenly spaced
  // schedule of `count` releases instead (see settings.ts `schedule`).
  // Minimum time between two paid Standard/Expert claims by one operator.
  // 0 disables it. Pairs with the organizer's "unlock all" control.
  claimCooldown: 0,
  waveCount: 5,
  waveInterval: 0,
  expertCount: 5,
  expertFirst: 30,
  expertInterval: 0,
  raceTimes: [30, 90, 135],
  goldenTimes: [70, 115, 165],
};
export const INITIAL_POOLS: Record<string, number> = {
  POOL_STARTER: 60000,
  POOL_STANDARD: 80000,
  POOL_EXPERT: 40000,
  POOL_RACE: 30000,
  POOL_EVENT: 30000,
  BANK_SEED_1: 40000,
  BANK_SEED_2: 40000,
  // Funds the 20 extra Starter slots that raising maxPlayers to 60 requires.
  // The bank seeds hold the largest share of the world and only pay out when a
  // raid crew fills and clears its gate, so they carry the most slack; the
  // Treasury is left whole because it backs the organizer's live corrections.
  BANK_SEED_FINAL: 50000,
  TREASURY: 30000,
  BANK_FEE_VAULT: 0,
  PAYOUT: 0,
};
export const LEGACY_INITIAL_POOLS: Record<string, number> = {
  ...INITIAL_POOLS,
  POOL_STARTER: 45000,
  POOL_STANDARD: 45000,
  // Pinned, not inherited. These are the opening balances a pre-rulesVersion
  // world was actually created with, so they must stay at those values however
  // the current plan is rebalanced, or a legacy world stops reconciling.
  BANK_SEED_FINAL: 70000,
  TREASURY: 60000,
};
export function validatePrizePlan() {
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0),
    r = EVENT_RULES,
    p = INITIAL_POOLS;
  if (
    sum(Object.values(p)) !== r.total ||
    r.starterPay * r.maxPlayers !== p.POOL_STARTER ||
    r.standardPay * r.standardSlots * r.waveTimes.length !== p.POOL_STANDARD ||
    r.expertPay * r.expertTimes.length !== p.POOL_EXPERT ||
    sum(r.raceRewards) * r.raceTimes.length !== p.POOL_RACE ||
    sum(r.eventRewards.flat()) !== p.POOL_EVENT
  )
    throw new Error(
      "Prize settings do not reconcile to the documented pool plan.",
    );
}
