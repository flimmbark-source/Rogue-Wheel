// Local profile + deck store (single-device) that ALSO builds real Card[] decks
// to match your existing game types/functions.

import { shuffle } from "../game/math";
import type { Card, Fighter, WheelArchetype } from "../game/types";

// ===== Local persistence types (module-scoped) =====
type CardId = string;
export type InventoryItem = { cardId: CardId; qty: number };
export type DeckCard = { cardId: CardId; qty: number };
export type Deck = { id: string; name: string; isActive: boolean; cards: DeckCard[] };
export type SwapItem = { cardId: string; qty: number };
export type CurrencyId = "gold" | "sigils";
export type CurrencyLedger = Record<CurrencyId, number>;
export type UnlockState = {
  wheels: Record<WheelArchetype, boolean>;
  modes: { coop: boolean; leaderboard: boolean };
};
export type Profile = {
  id: string;
  displayName: string;
  mmr: number;
  createdAt: number;
  level: number;
  exp: number;
  winStreak: number;
  currencies: CurrencyLedger;
  unlocks: UnlockState;
  cosmetics: string[];
};

export type ChallengeFrequency = "daily" | "weekly";
export type ChallengeKind = "win_matches" | "play_cards" | "coop_victories";
export type ChallengeReward =
  | { type: "currency"; currency: CurrencyId; amount: number }
  | { type: "inventory"; items: SwapItem[] }
  | { type: "cosmetic"; cosmeticId: string; name: string };
export type Challenge = {
  id: string;
  frequency: ChallengeFrequency;
  kind: ChallengeKind;
  title: string;
  description: string;
  target: number;
  progress: number;
  reward: ChallengeReward;
  expiresAt: number;
  completedAt?: number;
  claimedAt?: number;
};
export type ChallengeBoard = {
  daily: Challenge[];
  weekly: Challenge[];
  generatedAt: { daily: number; weekly: number };
};
export type ChallengeProgressSnapshot = {
  id: string;
  kind: ChallengeKind;
  progress: number;
  target: number;
  completed: boolean;
  claimed: boolean;
};

export type SharedStats = {
  coopWins: number;
  coopLosses: number;
  objectivesCompleted: number;
  leaderboardRating: number;
  lastUpdated: number;
};
export type CoopObjective = {
  id: string;
  description: string;
  target: number;
  progress: number;
  reward?: ChallengeReward;
  expiresAt: number;
};
export type LeaderboardEntry = {
  playerId: string;
  name: string;
  rating: number;
  victories: number;
  updatedAt: number;
};

type LocalState = {
  version: number;
  profile: Profile;
  inventory: InventoryItem[];
  decks: Deck[];
  challenges: ChallengeBoard;
  sharedStats: SharedStats;
  coopObjectives: CoopObjective[];
  leaderboard: LeaderboardEntry[];
};

// ===== Storage/config =====
const KEY = "rw:single:state";
const VERSION = 3;
const MAX_DECK_SIZE = 10;
const MAX_COPIES_PER_DECK = 2;
const WHEEL_LOADOUT_SIZE = 3;
const DAILY_SLOTS = 2;
const WEEKLY_SLOTS = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = DAY_MS * 7;

const DEFAULT_CURRENCIES: CurrencyLedger = { gold: 0, sigils: 0 };
const DEFAULT_UNLOCKS: UnlockState = {
  wheels: { bandit: true, sorcerer: true, beast: true, guardian: false, chaos: false },
  modes: { coop: false, leaderboard: false },
};
const DEFAULT_SHARED: SharedStats = {
  coopWins: 0,
  coopLosses: 0,
  objectivesCompleted: 0,
  leaderboardRating: 1000,
  lastUpdated: Date.now(),
};

const COOP_OBJECTIVE_PERIOD_MS = WEEK_MS;

type SafeStorage = Pick<Storage, "getItem" | "setItem"> | null;

function resolveStorage(): SafeStorage {
  try {
    if (typeof window === "undefined") return null;
    if (!("localStorage" in window)) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

const storage: SafeStorage = resolveStorage();
let memoryState: LocalState | null = null;

// Node/browser-safe UID (no imports)
function uid(prefix = "id") {
  if (typeof globalThis.crypto !== "undefined" && "randomUUID" in globalThis.crypto) {
    // @ts-ignore
    return `${prefix}_${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

const DEFAULT_COSMETICS: string[] = [];

// ===== Seed data (keep numbers only to match Card { type:'normal', number:n }) =====
const SEED_INVENTORY: InventoryItem[] = [];

const SEED_DECK: Deck = {
  id: uid("deck"),
  name: "Starter Deck",
  isActive: true,
  cards: Array.from({ length: 10 }, (_, n) => ({ cardId: `basic_${n}`, qty: 1 })),
};

// Challenge + objective templates

type ChallengeTemplate = {
  kind: ChallengeKind;
  title: string;
  description: string;
  target: number;
  reward: ChallengeReward;
  minLevel?: number;
};

const CHALLENGE_TEMPLATES: Record<ChallengeFrequency, ChallengeTemplate[]> = {
  daily: [
    {
      kind: "win_matches",
      title: "Morning Warmup",
      description: "Win two matches in any mode.",
      target: 2,
      reward: { type: "inventory", items: [{ cardId: "neg_-1", qty: 1 }] },
    },
    {
      kind: "play_cards",
      title: "Card Slinger",
      description: "Play 12 cards across matches today.",
      target: 12,
      reward: { type: "cosmetic", cosmeticId: "banner_ember", name: "Ember Pennant" },
    },
    {
      kind: "coop_victories",
      title: "Team Spirit",
      description: "Win a cooperative round with an ally.",
      target: 1,
      reward: { type: "currency", currency: "gold", amount: 150 },
      minLevel: 3,
    },
  ],
  weekly: [
    {
      kind: "win_matches",
      title: "Wheel Champion",
      description: "Win ten matches before the week ends.",
      target: 10,
      reward: { type: "inventory", items: [{ cardId: "neg_-2", qty: 1 }, { cardId: "neg_-3", qty: 1 }] },
    },
    {
      kind: "coop_victories",
      title: "Allied Triumphs",
      description: "Earn five cooperative victories this week.",
      target: 5,
      reward: { type: "cosmetic", cosmeticId: "sigil_starlit", name: "Starlit Sigil" },
    },
  ],
};

type ObjectiveTemplate = {
  description: string;
  target: number;
  reward?: ChallengeReward;
};

const COOP_OBJECTIVE_TEMPLATES: ObjectiveTemplate[] = [
  {
    description: "Win 3 cooperative matches with any ally.",
    target: 3,
    reward: { type: "currency", currency: "sigils", amount: 40 },
  },
  {
    description: "Spin the guardian wheel 8 times in cooperative play.",
    target: 8,
    reward: { type: "inventory", items: [{ cardId: "basic_7", qty: 1 }] },
  },
  {
    description: "Complete 4 cooperative objectives with perfect rounds.",
    target: 4,
    reward: { type: "cosmetic", cosmeticId: "trail_radiant", name: "Radiant Trail" },
  },
];

function normalizeCurrencies(input?: Partial<CurrencyLedger> | null): CurrencyLedger {
  const next: CurrencyLedger = { ...DEFAULT_CURRENCIES };
  if (input) {
    for (const key of Object.keys(DEFAULT_CURRENCIES) as CurrencyId[]) {
      const raw = input[key];
      next[key] = typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : DEFAULT_CURRENCIES[key];
    }
  }
  return next;
}

function normalizeUnlocks(input?: Partial<UnlockState> | null): UnlockState {
  const wheels: Record<WheelArchetype, boolean> = { ...DEFAULT_UNLOCKS.wheels };
  const modes = { ...DEFAULT_UNLOCKS.modes };
  if (input?.wheels) {
    for (const key of Object.keys(wheels) as WheelArchetype[]) {
      const raw = (input.wheels as Record<string, unknown>)[key];
      wheels[key] = Boolean(raw);
    }
  }
  if (input?.modes) {
    modes.coop = Boolean((input.modes as any).coop);
    modes.leaderboard = Boolean((input.modes as any).leaderboard);
  }
  return { wheels, modes };
}

function ensureCosmetics(list: unknown): string[] {
  if (!Array.isArray(list)) return [...DEFAULT_COSMETICS];
  const out = new Set<string>();
  for (const entry of list) {
    const str = typeof entry === "string" ? entry : null;
    if (str) out.add(str);
  }
  return Array.from(out);
}

function ensureLeaderboard(entries: unknown, profile: Profile): LeaderboardEntry[] {
  const list: LeaderboardEntry[] = Array.isArray(entries)
    ? entries
        .map((entry) => ({
          playerId: typeof entry?.playerId === "string" ? entry.playerId : uid("lb"),
          name: typeof entry?.name === "string" ? entry.name : "Player",
          rating: typeof entry?.rating === "number" && Number.isFinite(entry.rating) ? entry.rating : 1000,
          victories: typeof entry?.victories === "number" && Number.isFinite(entry.victories) ? Math.max(0, Math.floor(entry.victories)) : 0,
          updatedAt: typeof entry?.updatedAt === "number" ? entry.updatedAt : Date.now(),
        }))
    : [];

  const existing = list.find((e) => e.playerId === profile.id);
  if (!existing) {
    list.push({
      playerId: profile.id,
      name: profile.displayName,
      rating: DEFAULT_SHARED.leaderboardRating,
      victories: 0,
      updatedAt: Date.now(),
    });
  }
  return list.sort((a, b) => b.rating - a.rating);
}

function ensureSharedStats(stats: unknown): SharedStats {
  const base = { ...DEFAULT_SHARED };
  if (!stats || typeof stats !== "object") return base;
  const obj = stats as Partial<SharedStats>;
  base.coopWins = typeof obj.coopWins === "number" ? Math.max(0, Math.floor(obj.coopWins)) : base.coopWins;
  base.coopLosses = typeof obj.coopLosses === "number" ? Math.max(0, Math.floor(obj.coopLosses)) : base.coopLosses;
  base.objectivesCompleted =
    typeof obj.objectivesCompleted === "number" ? Math.max(0, Math.floor(obj.objectivesCompleted)) : base.objectivesCompleted;
  base.leaderboardRating =
    typeof obj.leaderboardRating === "number" && Number.isFinite(obj.leaderboardRating)
      ? Math.max(0, Math.floor(obj.leaderboardRating))
      : base.leaderboardRating;
  base.lastUpdated = typeof obj.lastUpdated === "number" ? obj.lastUpdated : Date.now();
  return base;
}

function ensureObjectives(entries: unknown, now: number): CoopObjective[] {
  if (!Array.isArray(entries)) {
    return generateObjectives([], now);
  }
  const sanitized: CoopObjective[] = entries
    .map((entry) => ({
      id: typeof entry?.id === "string" ? entry.id : uid("coop"),
      description: typeof entry?.description === "string" ? entry.description : "Cooperative goal",
      target: typeof entry?.target === "number" && entry.target > 0 ? Math.floor(entry.target) : 1,
      progress: typeof entry?.progress === "number" && entry.progress >= 0 ? Math.floor(entry.progress) : 0,
      reward: entry?.reward as ChallengeReward | undefined,
      expiresAt: typeof entry?.expiresAt === "number" ? entry.expiresAt : now + COOP_OBJECTIVE_PERIOD_MS,
    }))
    .filter(Boolean);
  return generateObjectives(sanitized, now);
}

function generateObjectives(existing: CoopObjective[], now: number): CoopObjective[] {
  const filtered = existing.filter((obj) => obj.expiresAt > now);
  const needed = Math.max(0, 2 - filtered.length);
  const out = [...filtered];
  for (let i = 0; i < needed; i++) {
    const template = COOP_OBJECTIVE_TEMPLATES[(filtered.length + i) % COOP_OBJECTIVE_TEMPLATES.length];
    const expiresAt = computeExpiry("weekly", now, COOP_OBJECTIVE_PERIOD_MS);
    out.push({
      id: uid("coop"),
      description: template.description,
      target: template.target,
      progress: 0,
      reward: template.reward,
      expiresAt,
    });
  }
  return out;
}

function computeExpiry(frequency: ChallengeFrequency, now: number, periodOverride?: number) {
  const period = periodOverride ?? (frequency === "daily" ? DAY_MS : WEEK_MS);
  const bucket = Math.floor(now / period) * period;
  return bucket + period;
}

function refreshChallengeBoard(state: LocalState, now = Date.now()) {
  const board = state.challenges;
  const trim = (list: Challenge[]) => list.filter((ch) => ch.expiresAt > now);
  board.daily = trim(board.daily);
  board.weekly = trim(board.weekly);

  const ensure = (frequency: ChallengeFrequency, slots: number) => {
    const templates = CHALLENGE_TEMPLATES[frequency];
    const list = frequency === "daily" ? board.daily : board.weekly;
    let i = 0;
    while (list.length < slots && templates.length > 0) {
      const template = templates[(Math.floor(now / (frequency === "daily" ? DAY_MS : WEEK_MS)) + list.length + i) % templates.length];
      const minLevel = template.minLevel ?? 0;
      if (state.profile.level >= minLevel) {
        list.push({
          id: uid(frequency === "daily" ? "day" : "week"),
          frequency,
          kind: template.kind,
          title: template.title,
          description: template.description,
          target: template.target,
          progress: 0,
          reward: template.reward,
          expiresAt: computeExpiry(frequency, now),
        });
      }
      i++;
      if (i > templates.length * 2) break;
    }
  };

  ensure("daily", DAILY_SLOTS);
  ensure("weekly", WEEKLY_SLOTS);
  board.generatedAt.daily = now;
  board.generatedAt.weekly = now;
}

function cloneChallenge(ch: Challenge): Challenge {
  return { ...ch, reward: { ...ch.reward } };
}

function applyChallengeProgress(state: LocalState, kind: ChallengeKind, delta: number, now: number) {
  if (delta <= 0) return;
  const apply = (ch: Challenge) => {
    if (ch.kind !== kind || ch.completedAt) return false;
    const before = ch.progress;
    ch.progress = Math.min(ch.target, ch.progress + delta);
    if (ch.progress >= ch.target) {
      ch.completedAt = now;
    }
    return ch.progress !== before;
  };
  let changed = false;
  for (const ch of state.challenges.daily) changed = apply(ch) || changed;
  for (const ch of state.challenges.weekly) changed = apply(ch) || changed;
  if (changed) state.challenges.generatedAt.daily = now;
}

function objectiveProgress(state: LocalState, amount: number, now: number) {
  if (amount <= 0) return;
  let completed = 0;
  for (const obj of state.coopObjectives) {
    if (obj.progress >= obj.target) continue;
    const before = obj.progress;
    obj.progress = Math.min(obj.target, obj.progress + amount);
    if (obj.progress >= obj.target) {
      state.sharedStats.objectivesCompleted += 1;
      if (obj.reward) {
        applyReward(state, obj.reward, now, false);
      }
    }
    if (obj.progress !== before && obj.progress >= obj.target) completed++;
  }
  if (completed > 0) {
    state.sharedStats.lastUpdated = now;
  }
}

function applyReward(state: LocalState, reward: ChallengeReward, now: number, markShared = true) {
  if (reward.type === "currency") {
    state.profile.currencies[reward.currency] =
      (state.profile.currencies[reward.currency] ?? 0) + Math.max(0, Math.floor(reward.amount));
  } else if (reward.type === "inventory") {
    for (const item of reward.items) {
      const existing = state.inventory.find((i) => i.cardId === item.cardId);
      if (existing) existing.qty += item.qty;
      else state.inventory.push({ cardId: item.cardId, qty: item.qty });
    }
  } else if (reward.type === "cosmetic") {
    if (!state.profile.cosmetics.includes(reward.cosmeticId)) {
      state.profile.cosmetics.push(reward.cosmeticId);
    }
  }
  if (markShared) state.sharedStats.lastUpdated = now;
}

function migrateState(raw: any): LocalState {
  const seedState = seed();
  if (!raw || typeof raw !== "object") {
    return seedState;
  }

  const profileRaw = raw.profile ?? {};
  const profile: Profile = {
    ...seedState.profile,
    ...profileRaw,
    level: typeof profileRaw.level === "number" ? profileRaw.level : seedState.profile.level,
    exp: typeof profileRaw.exp === "number" ? profileRaw.exp : seedState.profile.exp,
    winStreak: typeof profileRaw.winStreak === "number" ? profileRaw.winStreak : seedState.profile.winStreak,
    currencies: normalizeCurrencies(profileRaw.currencies),
    unlocks: normalizeUnlocks(profileRaw.unlocks),
    cosmetics: ensureCosmetics(profileRaw.cosmetics),
  };

  const state: LocalState = {
    version: VERSION,
    profile,
    inventory: Array.isArray(raw.inventory) ? raw.inventory.map((i: any) => ({ cardId: String(i.cardId), qty: Math.max(0, Number(i.qty) || 0) })) : seedState.inventory,
    decks: Array.isArray(raw.decks)
      ? raw.decks.map((d: any) => ({
          id: typeof d.id === "string" ? d.id : uid("deck"),
          name: typeof d.name === "string" ? d.name : "Deck",
          isActive: Boolean(d.isActive),
          cards: Array.isArray(d.cards)
            ? d.cards.map((c: any) => ({ cardId: String(c.cardId), qty: Math.max(0, Number(c.qty) || 0) }))
            : [],
        }))
      : seedState.decks,
    challenges: {
      daily: Array.isArray(raw.challenges?.daily) ? raw.challenges.daily.map(cloneChallenge) : seedState.challenges.daily,
      weekly: Array.isArray(raw.challenges?.weekly) ? raw.challenges.weekly.map(cloneChallenge) : seedState.challenges.weekly,
      generatedAt: {
        daily: typeof raw.challenges?.generatedAt?.daily === "number" ? raw.challenges.generatedAt.daily : 0,
        weekly: typeof raw.challenges?.generatedAt?.weekly === "number" ? raw.challenges.generatedAt.weekly : 0,
      },
    },
    sharedStats: ensureSharedStats(raw.sharedStats),
    coopObjectives: ensureObjectives(raw.coopObjectives, Date.now()),
    leaderboard: ensureLeaderboard(raw.leaderboard, profile),
  };

  if (!state.decks.some((d) => d.isActive) && state.decks[0]) state.decks[0].isActive = true;
  refreshChallengeBoard(state);
  return state;
}

function seed(): LocalState {
  const now = Date.now();
  const base: LocalState = {
    version: VERSION,
    profile: {
      id: uid("user"),
      displayName: "Local Player",
      mmr: 1000,
      createdAt: now,
      level: 1,
      exp: 0,
      winStreak: 0,
      currencies: { ...DEFAULT_CURRENCIES },
      unlocks: { ...DEFAULT_UNLOCKS },
      cosmetics: [...DEFAULT_COSMETICS],
    },
    inventory: SEED_INVENTORY.map((i) => ({ ...i })),
    decks: [SEED_DECK],
    challenges: { daily: [], weekly: [], generatedAt: { daily: 0, weekly: 0 } },
    sharedStats: { ...DEFAULT_SHARED },
    coopObjectives: [],
    leaderboard: [],
  };
  base.leaderboard = ensureLeaderboard(base.leaderboard, base.profile);
  base.coopObjectives = generateObjectives(base.coopObjectives, now);
  refreshChallengeBoard(base, now);
  return base;
}

// ===== Load/save =====
function loadStateRaw(): LocalState {
  if (!storage) {
    if (!memoryState) memoryState = seed();
    return memoryState;
  }

  let raw: string | null = null;
  try {
    raw = storage.getItem(KEY);
  } catch {
    memoryState = memoryState ?? seed();
    return memoryState;
  }
  if (!raw) {
    const s = seed();
    try {
      storage.setItem(KEY, JSON.stringify(s));
    } catch {
      memoryState = s;
    }
    return s;
  }
  try {
    const parsed = JSON.parse(raw);
    const state = migrateState(parsed);
    saveState(state);
    return state;
  } catch {
    const s = seed();
    try {
      storage.setItem(KEY, JSON.stringify(s));
    } catch {
      memoryState = s;
    }
    return s;
  }
}
function saveState(state: LocalState) {
  state.version = VERSION;
  if (!storage) {
    memoryState = state;
    return;
  }
  try {
    storage.setItem(KEY, JSON.stringify(state));
  } catch {
    memoryState = state;
  }
}

// ===== Helpers =====
const findActive = (s: LocalState) => s.decks.find((d) => d.isActive) ?? s.decks[0];
const sum = (cards: DeckCard[]) => cards.reduce((a, c) => a + c.qty, 0);
const qtyInDeck = (d: Deck, id: string) => d.cards.find((c) => c.cardId === id)?.qty ?? 0;
const setQty = (d: Deck, id: string, q: number) => {
  const i = d.cards.findIndex((c) => c.cardId === id);
  if (q <= 0) {
    if (i >= 0) d.cards.splice(i, 1);
    return;
  }
  if (i >= 0) d.cards[i].qty = q;
  else d.cards.push({ cardId: id, qty: q });
};
const ownAtLeast = (inv: InventoryItem[], id: string, need: number) => (inv.find((i) => i.cardId === id)?.qty ?? 0) >= need;

const EXP_BASE = 100;

export type LevelProgress = { level: number; exp: number; expToNext: number; percent: number };
export type LevelProgressSegment = LevelProgress & { leveledUp?: boolean };

export function expRequiredForLevel(level: number): number {
  return (level + 1) * EXP_BASE;
}

const toLevelProgress = (profile: Profile): LevelProgress => {
  const expToNext = expRequiredForLevel(profile.level);
  const percent = expToNext > 0 ? Math.min(1, profile.exp / expToNext) : 0;
  return { level: profile.level, exp: profile.exp, expToNext, percent };
};

export type MatchContext = {
  didWin: boolean;
  mode?: "solo" | "multiplayer" | "coop";
  wheelArchetypes?: WheelArchetype[];
  cooperativeObjectiveProgress?: number;
};

export type MatchResultSummary = {
  didWin: boolean;
  expGained: number;
  streak: number;
  before: LevelProgress;
  after: LevelProgress;
  segments: LevelProgressSegment[];
  levelUps: number;
  challengeProgress?: ChallengeProgressSnapshot[];
  unlockedArchetypes?: WheelArchetype[];
  currencies?: CurrencyLedger;
  sharedStats?: SharedStats;
  coopObjectives?: CoopObjective[];
  leaderboard?: LeaderboardEntry[];
};

export function recordMatchResult({ didWin, mode = "solo", wheelArchetypes = [], cooperativeObjectiveProgress = 0 }: MatchContext): MatchResultSummary {
  const state = loadStateRaw();
  const profile = state.profile;
  const before = toLevelProgress(profile);
  const now = Date.now();

  refreshChallengeBoard(state, now);

  let expGained = 0;
  let levelUps = 0;
  const segments: LevelProgressSegment[] = [];

  if (didWin) {
    const streakBefore = typeof profile.winStreak === "number" ? profile.winStreak : 0;
    const streakAfter = streakBefore + 1;
    profile.winStreak = streakAfter;

    expGained = 50 + 25 * Math.max(0, streakAfter - 1);

    let remaining = expGained;
    let curLevel = profile.level;
    let curExp = profile.exp;

    while (remaining > 0) {
      const needForLevel = expRequiredForLevel(curLevel) - curExp;
      if (remaining >= needForLevel) {
        curExp += needForLevel;
        segments.push({ level: curLevel, exp: curExp, expToNext: expRequiredForLevel(curLevel), percent: 1, leveledUp: true });
        remaining -= needForLevel;
        curLevel += 1;
        curExp = 0;
        levelUps += 1;
        segments.push({ level: curLevel, exp: curExp, expToNext: expRequiredForLevel(curLevel), percent: 0 });
      } else {
        curExp += remaining;
        const expToNext = expRequiredForLevel(curLevel);
        segments.push({ level: curLevel, exp: curExp, expToNext, percent: expToNext > 0 ? Math.min(1, curExp / expToNext) : 0 });
        remaining = 0;
      }
    }

    profile.level = curLevel;
    profile.exp = curExp;

    applyChallengeProgress(state, "win_matches", 1, now);
    if (mode === "coop" || mode === "multiplayer") {
      applyChallengeProgress(state, "coop_victories", 1, now);
    }
  } else {
    profile.winStreak = 0;
  }

  applyChallengeProgress(state, "play_cards", 3, now);
  if (cooperativeObjectiveProgress > 0) {
    objectiveProgress(state, cooperativeObjectiveProgress, now);
  }

  // Shared stats + leaderboard persistence
  if (mode !== "solo") {
    state.sharedStats.lastUpdated = now;
    if (didWin) state.sharedStats.coopWins += 1;
    else state.sharedStats.coopLosses += 1;

    const localEntry = state.leaderboard.find((entry) => entry.playerId === profile.id);
    if (localEntry) {
      const delta = didWin ? 15 : -10;
      localEntry.rating = Math.max(0, localEntry.rating + delta);
      if (didWin) localEntry.victories += 1;
      localEntry.updatedAt = now;
      state.sharedStats.leaderboardRating = localEntry.rating;
    }
  }

  if (mode === "coop" && cooperativeObjectiveProgress <= 0 && didWin) {
    objectiveProgress(state, 1, now);
  }

  // Level-based unlocks
  const unlocked: WheelArchetype[] = [];
  if (!state.profile.unlocks.wheels.guardian && profile.level >= 5) {
    state.profile.unlocks.wheels.guardian = true;
    unlocked.push("guardian");
  }
  if (!state.profile.unlocks.wheels.chaos && profile.level >= 12) {
    state.profile.unlocks.wheels.chaos = true;
    unlocked.push("chaos");
  }

  const after = toLevelProgress(profile);

  const challengeProgress: ChallengeProgressSnapshot[] = [
    ...state.challenges.daily,
    ...state.challenges.weekly,
  ].map((ch) => ({
    id: ch.id,
    kind: ch.kind,
    progress: ch.progress,
    target: ch.target,
    completed: !!ch.completedAt,
    claimed: !!ch.claimedAt,
  }));

  saveState(state);

  return {
    didWin,
    expGained,
    streak: profile.winStreak,
    before,
    after,
    segments,
    levelUps,
    challengeProgress,
    unlockedArchetypes: unlocked.length ? unlocked : undefined,
    currencies: { ...state.profile.currencies },
    sharedStats: { ...state.sharedStats },
    coopObjectives: state.coopObjectives.map((o) => ({ ...o })),
    leaderboard: state.leaderboard.map((l) => ({ ...l })),
  };
}

// ===== Public profile/deck management API (used by UI) =====
export type ProfileBundle = {
  profile: Profile;
  inventory: InventoryItem[];
  decks: Deck[];
  active: Deck | undefined;
  challenges: ChallengeBoard;
  sharedStats: SharedStats;
  coopObjectives: CoopObjective[];
  leaderboard: LeaderboardEntry[];
};

export function getProfileBundle(): ProfileBundle {
  const s = loadStateRaw();
  refreshChallengeBoard(s);
  saveState(s);
  return {
    profile: s.profile,
    inventory: s.inventory,
    decks: s.decks,
    active: findActive(s),
    challenges: s.challenges,
    sharedStats: s.sharedStats,
    coopObjectives: s.coopObjectives,
    leaderboard: s.leaderboard,
  };
}
export function createDeck(name = "New Deck") {
  const s = loadStateRaw();
  const d: Deck = { id: uid("deck"), name, isActive: false, cards: [] };
  s.decks.push(d);
  saveState(s);
  return d;
}
export function setActiveDeck(id: string) {
  const s = loadStateRaw();
  s.decks = s.decks.map((d) => ({ ...d, isActive: d.id === id }));
  saveState(s);
}
export function renameDeck(id: string, name: string) {
  const s = loadStateRaw();
  const d = s.decks.find((x) => x.id === id);
  if (d) d.name = name || "Deck";
  saveState(s);
}
export function deleteDeck(id: string) {
  const s = loadStateRaw();
  s.decks = s.decks.filter((d) => d.id !== id);
  if (!s.decks.some((d) => d.isActive) && s.decks[0]) s.decks[0].isActive = true;
  saveState(s);
}
export function swapDeckCards(deckId: string, remove: SwapItem[], add: SwapItem[]) {
  const s = loadStateRaw();
  const deck = s.decks.find((d) => d.id === deckId);
  if (!deck) throw new Error("Deck not found");

  const next: DeckCard[] = deck.cards.map((c) => ({ ...c }));
  const tmp: Deck = { ...deck, cards: next };

  for (const r of remove) setQty(tmp, r.cardId, Math.max(0, qtyInDeck(tmp, r.cardId) - r.qty));
  for (const a of add) setQty(tmp, a.cardId, qtyInDeck(tmp, a.cardId) + a.qty);

  if (sum(tmp.cards) > MAX_DECK_SIZE) throw new Error(`Deck too large (max ${MAX_DECK_SIZE})`);
  for (const c of tmp.cards) {
    if (!c.cardId.startsWith("basic_") && c.qty > MAX_COPIES_PER_DECK)
      throw new Error(`Too many copies of ${c.cardId} (max ${MAX_COPIES_PER_DECK})`);
    if (!ownAtLeast(s.inventory, c.cardId, 1)) throw new Error(`You don't own ${c.cardId}`);
  }

  deck.cards = tmp.cards;
  saveState(s);
  return deck;
}
export function addToInventory(items: SwapItem[]) {
  const s = loadStateRaw();
  for (const it of items) {
    const i = s.inventory.findIndex((x) => x.cardId === it.cardId);
    if (i >= 0) s.inventory[i].qty += it.qty;
    else s.inventory.push({ cardId: it.cardId, qty: it.qty });
  }
  saveState(s);
}

export function adjustCurrency(currency: CurrencyId, delta: number): number {
  const s = loadStateRaw();
  const current = s.profile.currencies[currency] ?? 0;
  const next = Math.max(0, current + Math.floor(delta));
  s.profile.currencies[currency] = next;
  saveState(s);
  return next;
}

export function unlockWheel(archetype: WheelArchetype) {
  const s = loadStateRaw();
  if (!s.profile.unlocks.wheels[archetype]) {
    s.profile.unlocks.wheels[archetype] = true;
    saveState(s);
  }
}

export function getUnlockedWheelArchetypes(): WheelArchetype[] {
  const s = loadStateRaw();
  return (Object.keys(s.profile.unlocks.wheels) as WheelArchetype[]).filter((key) => s.profile.unlocks.wheels[key]);
}

export function getWheelLoadout(): WheelArchetype[] {
  return normalizeWheelLoadout(getUnlockedWheelArchetypes());
}

export function getChallengeBoard(): ChallengeBoard {
  const s = loadStateRaw();
  refreshChallengeBoard(s);
  saveState(s);
  return {
    daily: s.challenges.daily.map(cloneChallenge),
    weekly: s.challenges.weekly.map(cloneChallenge),
    generatedAt: { ...s.challenges.generatedAt },
  };
}

export function claimChallengeReward(id: string): Challenge | null {
  const s = loadStateRaw();
  refreshChallengeBoard(s);
  const all = [...s.challenges.daily, ...s.challenges.weekly];
  const target = all.find((ch) => ch.id === id);
  if (!target || !target.completedAt || target.claimedAt) return null;
  const now = Date.now();
  target.claimedAt = now;
  applyReward(s, target.reward, now);
  saveState(s);
  return cloneChallenge(target);
}

export function getSharedStats(): SharedStats {
  const s = loadStateRaw();
  return { ...s.sharedStats };
}

export function applySharedStatsFromNetwork(snapshot: SharedStats): SharedStats {
  const s = loadStateRaw();
  s.sharedStats = {
    coopWins: Math.max(s.sharedStats.coopWins, snapshot.coopWins),
    coopLosses: Math.max(s.sharedStats.coopLosses, snapshot.coopLosses),
    objectivesCompleted: Math.max(s.sharedStats.objectivesCompleted, snapshot.objectivesCompleted),
    leaderboardRating: Math.max(s.sharedStats.leaderboardRating, snapshot.leaderboardRating),
    lastUpdated: Math.max(s.sharedStats.lastUpdated, snapshot.lastUpdated),
  };
  saveState(s);
  return { ...s.sharedStats };
}

export function getCoopObjectives(): CoopObjective[] {
  const s = loadStateRaw();
  s.coopObjectives = generateObjectives(s.coopObjectives, Date.now());
  saveState(s);
  return s.coopObjectives.map((o) => ({ ...o }));
}

export function applyCoopObjectivesSnapshot(list: CoopObjective[]): CoopObjective[] {
  const s = loadStateRaw();
  const now = Date.now();
  const merged = generateObjectives(list.map((o) => ({ ...o })), now);
  s.coopObjectives = merged;
  saveState(s);
  return merged.map((o) => ({ ...o }));
}

export function getLeaderboard(): LeaderboardEntry[] {
  const s = loadStateRaw();
  return s.leaderboard.map((entry) => ({ ...entry }));
}

export function applyLeaderboardSnapshot(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  const s = loadStateRaw();
  const map = new Map<string, LeaderboardEntry>();
  for (const entry of [...s.leaderboard, ...entries]) {
    const existing = map.get(entry.playerId);
    if (!existing || existing.rating < entry.rating) {
      map.set(entry.playerId, { ...entry });
    }
  }
  s.leaderboard = Array.from(map.values()).sort((a, b) => b.rating - a.rating);
  saveState(s);
  return s.leaderboard.map((entry) => ({ ...entry }));
}

// ====== CARD FACTORY to map profile cardIds -> real game Card ======

// sequential card ids for the runtime deck
const nextCardId = (() => {
  let i = 1;
  return () => `C${i++}`;
})();

/**
 * Supported cardId formats:
 *  - "basic_N" where N is 0..9  → normal card with number N
 *  - "neg_X" where X is a number (e.g., -2) → normal card with number X
 *  - "num_X" explicit number alias
 * Anything else falls back to number 0.
 */
export function cardNumberFromId(cardId: string): number {
  if (typeof cardId !== "string") return 0;
  const mBasic = /^basic_(\d+)$/.exec(cardId);
  if (mBasic) return parseInt(mBasic[1], 10);
  const mNeg = /^neg_(-?\d+)$/.exec(cardId);
  if (mNeg) return parseInt(mNeg[1], 10);
  const mNum = /^num_(-?\d+)$/.exec(cardId);
  if (mNum) return parseInt(mNum[1], 10);
  return 0;
}

function cardFromId(cardId: string): Card {
  const num = cardNumberFromId(cardId);
  return {
    id: nextCardId(),
    name: `${num}`,
    type: "normal",
    number: num,
    tags: [],
  };
}

function normalizeWheelLoadout(list: WheelArchetype[]): WheelArchetype[] {
  const source = list.length ? [...list] : ["bandit"];
  const out: WheelArchetype[] = [];
  for (const arch of source) {
    if (out.length >= WHEEL_LOADOUT_SIZE) break;
    out.push(arch);
  }
  while (out.length < WHEEL_LOADOUT_SIZE) {
    out.push(out[out.length - 1] ?? "bandit");
  }
  return out.slice(0, WHEEL_LOADOUT_SIZE);
}

// ====== Build a runtime deck (Card[]) from the ACTIVE profile deck ======
export function buildActiveDeckAsCards(): Card[] {
  const { active } = getProfileBundle();
  if (!active || !active.cards?.length) return starterDeck(); // fallback

  const pool: Card[] = [];
  for (const entry of active.cards) {
    for (let i = 0; i < entry.qty; i++) pool.push(cardFromId(entry.cardId));
  }
  return shuffle(pool);
}

// ====== Runtime helpers (folded from your src/game/decks.ts) ======
export function starterDeck(): Card[] {
  const base: Card[] = Array.from({ length: 10 }, (_, n) => ({
    id: nextCardId(),
    name: `${n}`,
    type: "normal",
    number: n,
    tags: [],
  }));
  return shuffle(base);
}

export function drawOne(f: Fighter): Fighter {
  const next = { ...f, deck: [...f.deck], hand: [...f.hand], discard: [...f.discard] };
  if (next.deck.length === 0 && next.discard.length > 0) {
    next.deck = shuffle(next.discard);
    next.discard = [];
  }
  if (next.deck.length) next.hand.push(next.deck.shift()!);
  return next;
}

export function refillTo(f: Fighter, target: number): Fighter {
  let cur = { ...f };
  while (cur.hand.length < target) {
    const before = cur.hand.length;
    cur = drawOne(cur);
    if (cur.hand.length === before) break;
  }
  return cur;
}

export function freshFive(f: Fighter): Fighter {
  const pool = shuffle([...f.deck, ...f.hand, ...f.discard]);
  const hand = pool.slice(0, 5);
  const deck = pool.slice(5);
  return { name: f.name, hand, deck, discard: [] };
}

/** Make a fighter using the ACTIVE profile deck (draw 5 to start). */
export function makeFighter(name: string): Fighter {
  const deck = buildActiveDeckAsCards();
  return refillTo({ name, deck, hand: [], discard: [] }, 5);
}
