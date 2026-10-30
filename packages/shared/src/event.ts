/** Public event contract. Answers, variant seeds and ledger authority stay on the server. */
export type WorkbenchKind =
  | "code"
  | "debug"
  | "cipher"
  | "deduction"
  | "logs"
  | "machine"
  | "portal"
  | "maze"
  | "tree"
  | "order"
  | "ring"
  | "lights"
  | "statements"
  | "oracle"
  | "circuit"
  | "courier"
  | "constraints";
export interface ChallengeWorkbench {
  kind: WorkbenchKind;
  code?: string;
  language?: string;
  languages?: Record<string, string>;
  variables?: string[];
  fixes?: { line: number; options: string[] }[];
  initialOutput?: string;
  ciphertext?: string;
  clues?: string[];
  candidates?: string[];
  logs?: string[];
  steps?: { multiply: number; add: number; divide: number }[];
  target?: number;
  notices?: string[];
  grid?: string[];
  shortest?: boolean;
  nodes?: string[];
  edges?: [string, string][];
  selected?: string[];
  lights?: number[];
  switches?: string[];
  maxGuesses?: number;
}
/**
 * The structured brief shown above every challenge.
 *
 * Challenges previously carried only a free-text `prompt` plus a one-line
 * `objective`, and the two could disagree: a prompt could read like a
 * calculation to perform while the objective said to read a program instead.
 * Worse, nothing stated the exact shape the answer had to take, so a player who
 * had solved the puzzle correctly could still lose a paid contract by typing
 * "82, 1" where the server wanted "Peak 82 at 1".
 *
 * Every field here is presentation only. None of it reaches the validator, and
 * none of it reveals the answer.
 */
export interface ChallengeBrief {
  /** Who is asking, and why. One or two sentences of fiction. */
  scenario: string;
  /** Precisely what to produce. Imperative, no story. */
  task: string;
  /** Where the evidence is on screen, when that is not obvious. */
  data?: string;
  /** The exact required shape of the answer. */
  answerFormat: string;
  /**
   * A correctly shaped answer that is NOT this challenge's answer, so the
   * format is unambiguous without giving the puzzle away.
   */
  example?: string;
  /** Progressive nudges. Never a solution. */
  hints?: string[];
}
export interface ChallengeView {
  id: string;
  title: string;
  topic: string;
  prompt: string;
  reward: number;
  expiresAt: number;
  solved: boolean;
  client?: string;
  objective?: string;
  difficulty?: number;
  workbench?: ChallengeWorkbench;
  brief?: ChallengeBrief;
  blockedUntil?: number;
  openedAt?: number;
  minimumSolveMs?: number;
  /** Earliest next answer, calculated by the authoritative server. */
  answerReadyAt?: number;
  feedback?: string;
  testRuns?: number;
}
export interface EventPlayerView {
  name: string;
  homeId: string;
  home: number;
  bank: number;
  transit: number;
  completed: number;
  training: number;
  capped: boolean;
  jailedUntil: number;
  checkedOut: boolean;
  payout: number;
  insideHome: boolean;
  bankFeePerMinute?: number;
  lastBankFee?: number;
}
export interface EventView {
  /** Compact, server-confirmed history for the current round (no puzzle solutions). */
  completedChallenges?: CompletedChallengeView[];
  role?: import('./access.js').AccountRole;
  type: "event_state";
  serverTime: number;
  startedAt: number;
  durationMs: number;
  phase: "lobby" | "live" | "frozen";
  player: EventPlayerView;
  checkoutOpensAt?: number;
  stationStates?: {
    id: string;
    type: string;
    difficulty: number;
    state: "open" | "busy" | "locked" | "cleared" | "training";
    until: number;
  }[];
  challenges: ChallengeView[];
  queues: { id: string; position: number; offerUntil: number }[];
  jobs: {
    id: string;
    title: string;
    topic: string;
    district: string;
    tier: string;
    reward: number;
    station?: string;
    language?: string;
    available: boolean;
    remaining: number;
    /**
     * Why a paid claim is unavailable, in words a player can act on. Absent
     * when the contract is claimable. Without it the card said only "0
     * eligible paid slots", which players read as a broken or locked game.
     */
    lockedReason?: string;
  }[];
  announcements: { at: number; text: string }[];
  messages: { at: number; text: string }[];
  leaderboard: {
    name: string;
    score: number;
    completed: number;
    capped: boolean;
  }[];
  homes: { id: string; owner: string; ownerId: string; capped: boolean }[];
  raid: {
    window: number;
    crew: number;
    required: number;
    standingSince: number;
    endsAt: number;
    joined: boolean;
    solved: number;
  };
  activities: {
    id: string;
    name: string;
    startsAt: number;
    endsAt: number;
    description: string;
  }[];
  markers: { id: string; name: string; x: number; y: number }[];
}
export interface CompletedChallengeView {
  id: string;
  template: string;
  title: string;
  mode: string;
  completedAt: number;
  location: string;
  station?: string;
  district?: string;
}
export interface EventRequest {
  type: "game_action";
  action: string;
  id?: string;
  answer?: string;
  amount?: number;
  level?: number;
  training?: boolean;
  confirm?: boolean;
  input?: string;
}
