/**
 * Live, operator-editable event settings.
 *
 * `EVENT_RULES` in rules.ts is the documented default plan. Every one of its 90
 * read sites accesses a property at call time rather than destructuring at module
 * load, so applying an override by mutating that object in place takes effect
 * everywhere immediately with no call-site changes. That is the whole mechanism;
 * this module is the schema, the validation and the audit around it.
 *
 * Two invariants are enforced on every change and are not negotiable:
 *
 *  1. The world's net money is always exactly TOTAL_PAISE (Rs 4,000). The prize
 *     pools are *derived* from the per-prize settings, and TREASURY absorbs the
 *     remainder so the sum is arithmetically forced to reconcile. A change that
 *     would need a negative Treasury is rejected rather than silently rebalanced.
 *
 *  2. Anything that determines how much money exists, or how it was distributed
 *     into pools, is editable only while the event is still in the lobby. Once
 *     money has moved, retroactively changing a pool would contradict the ledger.
 *     Those fields are marked `preStart`. Everything else is `live`.
 *
 * Fields carry their own label, help text, unit and bounds so the operator
 * console can render a usable form for a non-technical organizer without
 * duplicating any of this knowledge in the client.
 */
import { EVENT_RULES, INITIAL_POOLS, MINUTE } from "./rules.js";

/** The conserved size of the world economy, in paise. Rs 4,000. */
export const TOTAL_PAISE = 400_000;

export type SettingUnit = "paise" | "minutes" | "ms" | "count" | "permille";
export type SettingPhase = "live" | "preStart";

export type SettingField = {
  key: string;
  label: string;
  group: string;
  unit: SettingUnit;
  phase: SettingPhase;
  min: number;
  max: number;
  help: string;
};

/**
 * The editable surface. Deliberately a curated list rather than "every key in
 * EVENT_RULES": exposing the derived pools or the wave template arrays as free
 * numbers would let an operator produce a state the engine cannot satisfy.
 */
export const SETTING_FIELDS: SettingField[] = [
  // Participation
  {
    key: "maxPlayers",
    label: "Maximum operators",
    group: "Participation",
    unit: "count",
    phase: "preStart",
    min: 1,
    max: 200,
    help: "How many players may enrol. Raising this raises the Starter pool, which is taken from the Treasury.",
  },
  {
    key: "lateJoin",
    label: "Late enrolment cutoff",
    group: "Participation",
    unit: "minutes",
    phase: "live",
    min: 0,
    max: 180,
    help: "Schedule minute after which nobody new may enrol.",
  },
  // Prize money
  {
    key: "starterPay",
    label: "Starter prize",
    group: "Prize money",
    unit: "paise",
    phase: "preStart",
    min: 0,
    max: 100_000,
    help: "Paid once per operator for their single Starter claim.",
  },
  {
    key: "standardPay",
    label: "Standard prize",
    group: "Prize money",
    unit: "paise",
    phase: "preStart",
    min: 0,
    max: 100_000,
    help: "Paid per solved Standard contract.",
  },
  {
    key: "expertPay",
    label: "Expert prize",
    group: "Prize money",
    unit: "paise",
    phase: "preStart",
    min: 0,
    max: 100_000,
    help: "Paid per solved Expert contract.",
  },
  {
    key: "standardSlots",
    label: "Standard slots per wave",
    group: "Prize money",
    unit: "count",
    phase: "preStart",
    min: 1,
    max: 60,
    help: "Paid Standard slots released in each wave, split across that wave's two templates.",
  },
  // Wealth limits
  {
    key: "cap",
    label: "Wealth cap",
    group: "Wealth limits",
    unit: "paise",
    phase: "live",
    min: 1_000,
    max: TOTAL_PAISE,
    help: "Total wealth at which an operator stops earning. Must stay above the reactivation threshold.",
  },
  {
    key: "reactivate",
    label: "Reactivation threshold",
    group: "Wealth limits",
    unit: "paise",
    phase: "live",
    min: 0,
    max: TOTAL_PAISE,
    help: "A capped operator may earn again once their wealth falls below this.",
  },
  // Bank
  {
    key: "bankOpen",
    label: "Bank opens at minute",
    group: "Bank",
    unit: "minutes",
    phase: "live",
    min: 0,
    max: 180,
    help: "Schedule minute when deposits become available.",
  },
  {
    key: "bankMax",
    label: "Bank deposit limit",
    group: "Bank",
    unit: "paise",
    phase: "live",
    min: 0,
    max: TOTAL_PAISE,
    help: "Maximum an operator may hold in the Bank.",
  },
  {
    key: "bankFeeNumerator",
    label: "Bank fee per minute",
    group: "Bank",
    unit: "permille",
    phase: "live",
    min: 0,
    max: 100,
    help: "Storage fee charged per real minute, in tenths of a percent. 1 means 0.1 percent. Fees move to the raid fee vault; they never leave the economy.",
  },
  {
    key: "withdrawal",
    label: "Withdrawal delay",
    group: "Bank",
    unit: "ms",
    phase: "live",
    min: 0,
    max: 30 * MINUTE,
    help: "How long a withdrawal stays in transit before it lands.",
  },
  // Contracts
  {
    key: "standardLock",
    label: "Standard hold",
    group: "Contracts",
    unit: "ms",
    phase: "live",
    min: 30_000,
    max: 60 * MINUTE,
    help: "How long an operator holds a Standard contract before it returns to the queue.",
  },
  {
    key: "expertLock",
    label: "Expert hold",
    group: "Contracts",
    unit: "ms",
    phase: "live",
    min: 30_000,
    max: 60 * MINUTE,
    help: "How long an operator holds an Expert contract before it returns to the queue.",
  },
  {
    key: "queueAccept",
    label: "Queue offer window",
    group: "Contracts",
    unit: "ms",
    phase: "live",
    min: 5_000,
    max: 10 * MINUTE,
    help: "How long the next operator in a FIFO queue has to accept a released slot.",
  },
  {
    key: "queueLimit",
    label: "Queues per operator",
    group: "Contracts",
    unit: "count",
    phase: "live",
    min: 1,
    max: 10,
    help: "How many FIFO queues one operator may wait in at once.",
  },
  {
    key: "minimumSolveMs",
    label: "Minimum time before first answer",
    group: "Contracts",
    unit: "ms",
    phase: "live",
    min: 0,
    max: 5 * MINUTE,
    help: "Guard against instant submissions. Lower this for a demo, raise it to slow guessing.",
  },
  {
    key: "answerInterval",
    label: "Gap between answers",
    group: "Contracts",
    unit: "ms",
    phase: "live",
    min: 0,
    max: 5 * MINUTE,
    help: "Enforced wait between two ordinary answer submissions.",
  },
  {
    key: "wrongLimit",
    label: "Wrong answers before lockout",
    group: "Contracts",
    unit: "count",
    phase: "live",
    min: 1,
    max: 20,
    help: "How many wrong answers trigger the lockout.",
  },
  {
    key: "wrongWait",
    label: "Lockout duration",
    group: "Contracts",
    unit: "ms",
    phase: "live",
    min: 0,
    max: 30 * MINUTE,
    help: "How long an operator is locked out after too many wrong answers.",
  },
  // Schedule
  {
    key: "checkoutOpen",
    label: "Checkout opens at minute",
    group: "Schedule",
    unit: "minutes",
    phase: "live",
    min: 0,
    max: 180,
    help: "Schedule minute when voluntary Checkout becomes available.",
  },
  {
    key: "offline",
    label: "Economic offline grace",
    group: "Schedule",
    unit: "ms",
    phase: "live",
    min: 0,
    max: 60 * MINUTE,
    help: "How long a disconnected operator keeps their economic position. Separate from the 30-second network ghost window.",
  },
  // Raids
  {
    key: "raidCrew",
    label: "Raid crew size",
    group: "Raids",
    unit: "count",
    phase: "preStart",
    min: 1,
    max: 40,
    help: "Crew size when enrolment is at or above the small-raid threshold. Fixed when the event starts.",
  },
  {
    key: "smallRaidCrew",
    label: "Small raid crew size",
    group: "Raids",
    unit: "count",
    phase: "preStart",
    min: 1,
    max: 40,
    help: "Crew size used when fewer operators than the threshold are enrolled.",
  },
  {
    key: "smallRaidThreshold",
    label: "Small raid threshold",
    group: "Raids",
    unit: "count",
    phase: "preStart",
    min: 1,
    max: 200,
    help: "Enrolment below this uses the small crew size.",
  },
  {
    key: "raidQuestions",
    label: "Questions per crew member",
    group: "Raids",
    unit: "count",
    phase: "live",
    min: 1,
    max: 20,
    help: "Private questions each crew member receives.",
  },
  {
    key: "raidGate",
    label: "Clears to pass the gate",
    group: "Raids",
    unit: "count",
    phase: "live",
    min: 1,
    max: 20,
    help: "How many of their questions a crew member must clear to pass.",
  },
  {
    key: "raidPass",
    label: "Passing members needed",
    group: "Raids",
    unit: "count",
    phase: "live",
    min: 1,
    max: 40,
    help: "How many crew members must pass for the raid to succeed.",
  },
  {
    key: "raidStand",
    label: "Circle hold time",
    group: "Raids",
    unit: "ms",
    phase: "live",
    min: 0,
    max: 10 * MINUTE,
    help: "How long a qualifying operator must hold the Raid Circle.",
  },
  // Burglary
  {
    key: "claimCooldown",
    label: "Cooldown between paid claims",
    group: "Contracts",
    unit: "ms",
    phase: "live",
    min: 0,
    max: 30 * 60_000,
    help: "After claiming a paid Standard or Expert contract, how long an operator waits before claiming the next one. 0 means no cooldown. Use with Unlock all contracts to pace play without waves.",
  },
  {
    key: "waveCount",
    label: "Standard waves",
    group: "Release schedule",
    unit: "count",
    phase: "preStart",
    min: 1,
    max: 30,
    help: "How many Standard waves the event releases. Only used when the wave interval is above 0.",
  },
  {
    key: "waveInterval",
    label: "Minutes between Standard waves",
    group: "Release schedule",
    unit: "minutes",
    phase: "preStart",
    min: 0,
    max: 60,
    help: "0 keeps the authored schedule (minutes 0, 20, 50, 80, 120). Any other value releases a wave at minute 0 and then every this many minutes. Smaller means less waiting between paid work.",
  },
  {
    key: "expertCount",
    label: "Expert releases",
    group: "Release schedule",
    unit: "count",
    phase: "preStart",
    min: 1,
    max: 20,
    help: "How many Expert contracts are released, one slot each. Only used when the Expert interval is above 0.",
  },
  {
    key: "expertFirst",
    label: "First Expert release at minute",
    group: "Release schedule",
    unit: "minutes",
    phase: "preStart",
    min: 0,
    max: 170,
    help: "Event minute of the first Expert release. Only used when the Expert interval is above 0.",
  },
  {
    key: "expertInterval",
    label: "Minutes between Expert releases",
    group: "Release schedule",
    unit: "minutes",
    phase: "preStart",
    min: 0,
    max: 60,
    help: "0 keeps the authored schedule (minutes 30, 60, 90, 120, 140). Any other value releases an Expert contract every this many minutes from the first release.",
  },
  {
    key: "burglaryOpen",
    label: "Burglary opens at minute",
    group: "Burglary",
    unit: "minutes",
    phase: "live",
    min: 0,
    max: 180,
    help: "Schedule minute when burglary becomes available.",
  },
  {
    key: "burglaryClose",
    label: "Burglary closes at minute",
    group: "Burglary",
    unit: "minutes",
    phase: "live",
    min: 0,
    max: 180,
    help: "Schedule minute when burglary stops.",
  },
  {
    key: "jail",
    label: "Jail time",
    group: "Burglary",
    unit: "ms",
    phase: "live",
    min: 0,
    max: 30 * MINUTE,
    help: "How long a caught burglar is held.",
  },
  {
    key: "homeCooldown",
    label: "Home cooldown after a burglary",
    group: "Burglary",
    unit: "ms",
    phase: "live",
    min: 0,
    max: 60 * MINUTE,
    help: "How long a burgled Home is protected from the next attempt.",
  },
  {
    key: "thiefCooldown",
    label: "Burglar cooldown",
    group: "Burglary",
    unit: "ms",
    phase: "live",
    min: 0,
    max: 120 * MINUTE,
    help: "How long before the same operator may attempt another burglary.",
  },
];

export const SETTING_BY_KEY = new Map(SETTING_FIELDS.map((f) => [f.key, f]));

export type SettingsOverrides = Record<string, number>;

/** The documented defaults, captured once before anything mutates them. */
const DEFAULTS: Record<string, number> = Object.fromEntries(
  SETTING_FIELDS.map((f) => [
    f.key,
    (EVENT_RULES as unknown as Record<string, number>)[f.key],
  ]),
);
const DEFAULT_POOLS: Record<string, number> = { ...INITIAL_POOLS };

export function settingDefaults(): Record<string, number> {
  return { ...DEFAULTS };
}

/**
 * Derive the prize pools from the current prize settings.
 *
 * The first five pools are forced to equal exactly what the schedule can pay
 * out, which is the same arithmetic `validatePrizePlan` asserts. TREASURY then
 * takes whatever is left of the Rs 4,000, which is what makes the total
 * conserved by construction instead of by hope.
 */
const AUTHORED = {
  waveTimes: [...EVENT_RULES.waveTimes],
  waveTemplates: EVENT_RULES.waveTemplates.map((w) => [...w]),
  expertTimes: [...EVENT_RULES.expertTimes],
  expertTemplates: [...EVENT_RULES.expertTemplates],
};
const SD = ["SD-01", "SD-02", "SD-04", "SD-06", "SD-03", "SD-08", "SD-05", "SD-09", "SD-07", "SD-10"];
const EX = ["EX-01", "EX-04", "EX-02", "EX-05", "EX-03"];

/**
 * The release schedule a set of values produces. Interval 0 keeps the authored
 * arrays exactly, so defaults behave as before. A positive interval spaces the
 * releases evenly and cycles through the templates in their authored order,
 * two Standard templates per wave, never past minute 170 so the last release
 * still has time to be played before the seal.
 */
export function schedule(values: Record<string, number>) {
  const waveTimes =
    values.waveInterval > 0
      ? Array.from({ length: values.waveCount }, (_, i) => i * values.waveInterval).filter((m) => m <= 170)
      : [...AUTHORED.waveTimes];
  const waveTemplates =
    values.waveInterval > 0
      ? waveTimes.map((_, i) => [SD[(2 * i) % SD.length], SD[(2 * i + 1) % SD.length]])
      : AUTHORED.waveTemplates.map((w) => [...w]);
  const expertTimes =
    values.expertInterval > 0
      ? Array.from({ length: values.expertCount }, (_, i) => values.expertFirst + i * values.expertInterval).filter((m) => m <= 170)
      : [...AUTHORED.expertTimes];
  const expertTemplates =
    values.expertInterval > 0
      ? expertTimes.map((_, i) => EX[i % EX.length])
      : [...AUTHORED.expertTemplates];
  return { waveTimes, waveTemplates, expertTimes, expertTemplates };
}

export function derivePools(values: Record<string, number>) {
  const plan = schedule(values);
  const waves = plan.waveTimes.length,
    experts = plan.expertTimes.length,
    races = EVENT_RULES.raceTimes.length,
    raceReward = EVENT_RULES.raceRewards.reduce((a, b) => a + b, 0),
    eventReward = EVENT_RULES.eventRewards.flat().reduce((a, b) => a + b, 0);
  const pools: Record<string, number> = {
    POOL_STARTER: values.starterPay * values.maxPlayers,
    POOL_STANDARD: values.standardPay * values.standardSlots * waves,
    POOL_EXPERT: values.expertPay * experts,
    POOL_RACE: raceReward * races,
    POOL_EVENT: eventReward,
    BANK_SEED_1: DEFAULT_POOLS.BANK_SEED_1,
    BANK_SEED_2: DEFAULT_POOLS.BANK_SEED_2,
    BANK_SEED_FINAL: DEFAULT_POOLS.BANK_SEED_FINAL,
    BANK_FEE_VAULT: 0,
    PAYOUT: 0,
  };
  const committed = Object.values(pools).reduce((a, b) => a + b, 0);
  pools.TREASURY = TOTAL_PAISE - committed;
  return pools;
}

export class SettingsError extends Error {}

/**
 * Validate a proposed override set and return the resulting rule values and
 * pools. Pure: nothing is mutated, so a rejected change leaves no trace.
 */
export function planSettings(
  overrides: SettingsOverrides,
  options: {
    started: boolean;
    /**
     * The overrides in force when the event started. A pre-start field may be
     * re-sent after the start as long as it keeps that value. Comparing against
     * the documented default instead made every save after the start fail as
     * soon as any pre-start field had been customised (the console re-sends all
     * non-default values), and made a restart silently drop every override.
     */
    locked?: SettingsOverrides;
    /** The crew size this event fixed at its start, once started. */
    crewSize?: number;
  },
) {
  const next: Record<string, number> = { ...DEFAULTS, ...overrides };
  for (const [key, value] of Object.entries(overrides)) {
    const field = SETTING_BY_KEY.get(key);
    if (!field) throw new SettingsError(`Unknown setting: ${key}`);
    if (!Number.isInteger(value))
      throw new SettingsError(`${field.label} must be a whole number.`);
    if (value < field.min || value > field.max)
      throw new SettingsError(
        `${field.label} must be between ${field.min} and ${field.max}.`,
      );
    if (
      field.phase === "preStart" &&
      options.started &&
      value !== (options.locked?.[key] ?? DEFAULTS[key])
    )
      // Changing how much money exists, after money has already moved, would
      // contradict the ledger. Refuse rather than produce an unauditable event.
      throw new SettingsError(
        `${field.label} can only be changed before the event starts.`,
      );
  }
  if (next.cap <= next.reactivate)
    throw new SettingsError(
      "Wealth cap must be greater than the reactivation threshold.",
    );
  if (next.burglaryClose <= next.burglaryOpen)
    throw new SettingsError("Burglary must close after it opens.");
  if (next.raidGate > next.raidQuestions)
    throw new SettingsError(
      "Clears required cannot exceed the number of questions per crew member.",
    );
  if (next.raidPass > next.raidCrew)
    throw new SettingsError(
      "Passing members needed cannot exceed the raid crew size.",
    );
  if (next.smallRaidCrew > next.raidCrew)
    throw new SettingsError(
      "Small raid crew cannot be larger than the full raid crew.",
    );
  // A small event forms the smaller crew, so the pass requirement must fit it
  // too; otherwise every raid fails no matter how well the crew plays.
  if (next.raidPass > next.smallRaidCrew)
    throw new SettingsError(
      "Passing members needed cannot exceed the small raid crew size.",
    );
  if (options.crewSize && next.raidPass > options.crewSize)
    throw new SettingsError(
      `This event's raid crew is ${options.crewSize}, so at most ${options.crewSize} members can be required to pass.`,
    );

  const pools = derivePools(next);
  if (pools.TREASURY < 0)
    throw new SettingsError(
      `These prize settings commit Rs ${((TOTAL_PAISE - pools.TREASURY) / 100).toFixed(2)}, which is more than the Rs ${(TOTAL_PAISE / 100).toFixed(2)} the world contains. Reduce a prize amount, the number of operators, or the Standard slots per wave.`,
    );
  const total = Object.values(pools).reduce((a, b) => a + b, 0);
  if (total !== TOTAL_PAISE)
    // Unreachable by construction; retained because a silent breach here would
    // mint or destroy money, which is the one failure this system must not have.
    throw new SettingsError(
      `Internal pool arithmetic produced ${total} paise instead of ${TOTAL_PAISE}.`,
    );
  return { values: next, pools };
}

/**
 * Apply validated values onto EVENT_RULES in place. Property reads elsewhere
 * resolve at call time, so this is immediately effective everywhere.
 */
export function applySettings(values: Record<string, number>) {
  const target = EVENT_RULES as unknown as Record<string, number>;
  for (const field of SETTING_FIELDS) target[field.key] = values[field.key];
  // The arrays are replaced in place on the shared rules object, like every
  // other rule, so the engine reads the organizer's schedule at start.
  const plan = schedule(values);
  EVENT_RULES.waveTimes.splice(0, Infinity, ...plan.waveTimes);
  EVENT_RULES.waveTemplates.splice(0, Infinity, ...plan.waveTemplates);
  EVENT_RULES.expertTimes.splice(0, Infinity, ...plan.expertTimes);
  EVENT_RULES.expertTemplates.splice(0, Infinity, ...plan.expertTemplates);
  return values;
}

/** Restore the documented defaults. Used on reset and by the console. */
export function resetSettings() {
  return applySettings({ ...DEFAULTS });
}

/** Describe the editable surface for the operator console. */
export function describeSettings(current: Record<string, number>) {
  const values = { ...DEFAULTS, ...current };
  return {
    totalPaise: TOTAL_PAISE,
    groups: [...new Set(SETTING_FIELDS.map((f) => f.group))],
    fields: SETTING_FIELDS.map((f) => ({
      ...f,
      value: values[f.key],
      default: DEFAULTS[f.key],
    })),
    pools: derivePools(values),
  };
}
