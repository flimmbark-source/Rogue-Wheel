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
export type ChallengeKind = "win_matches" | "coop_victories";
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
  completedAt?: number;
  claimedAt?: number;
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
const DAILY_SLOTS = 2;
const WEEKLY_SLOTS = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = DAY_MS * 7;

const DEFAULT_CURRENCIES: CurrencyLedger = { gold: 0, sigils: 0 };
const DEFAULT_UNLOCKS: UnlockState = {
  wheels: { bandit: true, sorcerer: true, beast: true, guardian: false, chaos: false },
  modes: { coop: false, leaderboard: false },
};
const DEFAULT_COSMETICS: string[] = [];
const DEFAULT_SHARED: SharedStats = {
  coopWins: 0,
  coopLosses: 0,
  objectivesCompleted: 0,
  leaderboardRating: 1000,
  lastUpdated: 0,
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

// ===== Seed data (keep numbers only to match Card { type:'normal', number:n }) =====
const SEED_INVENTORY: InventoryItem[] = [];

const SEED_DECK: Deck = {
  id: uid("deck"),
  name: "Starter Deck",
  isActive: true,
  cards: Array.from({ length: 10 }, (_, n) => ({ cardId: `basic_${n}`, qty: 1 })),
};

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

function computeExpiry(frequency: ChallengeFrequency, now: number, periodOverride?: number) {
  const period = periodOverride ?? (frequency === "daily" ? DAY_MS : WEEK_MS);
  const bucket = Math.floor(now / period) * period;
  return bucket + period;
}

function makeChallenge(template: ChallengeTemplate, frequency: ChallengeFrequency, now: number): Challenge {
  return {
    id: uid(frequency === "daily" ? "day" : "week"),
    frequency,
    kind: template.kind,
    title: template.title,
    description: template.description,
    target: template.target,
    progress: 0,
    reward: template.reward,
    expiresAt: computeExpiry(frequency, now),
  };
}

function ensureChallengeBoard(data: unknown, profile: Profile, now: number): ChallengeBoard {
  const base: ChallengeBoard = {
    daily: [],
    weekly: [],
    generatedAt: { daily: 0, weekly: 0 },
  };
  if (data && typeof data === "object") {
    const board = data as Partial<ChallengeBoard>;
    const normalizeList = (list: unknown, frequency: ChallengeFrequency): Challenge[] => {
      if (!Array.isArray(list)) return [];
      return list
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const raw = entry as Challenge;
          return {
            id: typeof raw.id === "string" ? raw.id : uid(frequency === "daily" ? "day" : "week"),
            frequency,
            kind: (raw.kind as ChallengeKind) ?? "win_matches",
            title: typeof raw.title === "string" ? raw.title : "Daily Challenge",
            description: typeof raw.description === "string" ? raw.description : "Complete matches.",
            target: typeof raw.target === "number" && raw.target > 0 ? Math.floor(raw.target) : 1,
            progress: typeof raw.progress === "number" && raw.progress >= 0 ? Math.floor(raw.progress) : 0,
            reward: raw.reward ?? { type: "currency", currency: "gold", amount: 50 },
            expiresAt: typeof raw.expiresAt === "number" ? raw.expiresAt : computeExpiry(frequency, now),
            completedAt: typeof raw.completedAt === "number" ? raw.completedAt : undefined,
            claimedAt: typeof raw.claimedAt === "number" ? raw.claimedAt : undefined,
          } satisfies Challenge;
        })
        .filter(Boolean) as Challenge[];
    };
    base.daily = normalizeList(board.daily, "daily");
    base.weekly = normalizeList(board.weekly, "weekly");
    base.generatedAt = {
      daily: typeof board.generatedAt?.daily === "number" ? board.generatedAt.daily : 0,
      weekly: typeof board.generatedAt?.weekly === "number" ? board.generatedAt.weekly : 0,
    };
  }

  refreshChallengeLists(base, profile, now);
  return base;
}

function seedChallengeBoard(profile: Profile, now: number): ChallengeBoard {
  return ensureChallengeBoard(undefined, profile, now);
}

function ensureSharedStats(stats: unknown): SharedStats {
  const base = { ...DEFAULT_SHARED, lastUpdated: Date.now() };
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
      completedAt: typeof (entry as any)?.completedAt === "number" ? (entry as any).completedAt : undefined,
      claimedAt: typeof (entry as any)?.claimedAt === "number" ? (entry as any).claimedAt : undefined,
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

function refreshChallengeLists(board: ChallengeBoard, profile: Profile, now: number) {
  const trim = (list: Challenge[]) => list.filter((ch) => ch.expiresAt > now);
  board.daily = trim(board.daily);
  board.weekly = trim(board.weekly);

  const ensureSlots = (frequency: ChallengeFrequency, slots: number) => {
    const templates = CHALLENGE_TEMPLATES[frequency];
    const list = frequency === "daily" ? board.daily : board.weekly;
    let i = 0;
    while (list.length < slots && templates.length > 0) {
      const template = templates[(Math.floor(now / (frequency === "daily" ? DAY_MS : WEEK_MS)) + list.length + i) % templates.length];
      const minLevel = template.minLevel ?? 0;
      if (profile.level >= minLevel) {
        list.push(makeChallenge(template, frequency, now));
      }
      i++;
      if (i > templates.length * 2) break;
    }
  };

  ensureSlots("daily", DAILY_SLOTS);
  ensureSlots("weekly", WEEKLY_SLOTS);
  board.generatedAt.daily = now;
  board.generatedAt.weekly = now;
}

function refreshChallengeBoard(state: LocalState, now = Date.now()) {
  refreshChallengeLists(state.challenges, state.profile, now);
}

function cloneChallenge(ch: Challenge): Challenge {
  const reward: ChallengeReward =
    ch.reward.type === "inventory"
      ? { type: "inventory", items: ch.reward.items.map((item) => ({ ...item })) }
      : { ...ch.reward };
  return { ...ch, reward };
}

function cloneObjective(obj: CoopObjective): CoopObjective {
  return {
    ...obj,
    reward:
      obj.reward?.type === "inventory"
        ? { type: "inventory", items: obj.reward.items.map((item) => ({ ...item })) }
        : obj.reward
        ? { ...obj.reward }
        : undefined,
  };
}

function addInventoryEntries(state: LocalState, items: SwapItem[]) {
  for (const item of items) {
    const existing = state.inventory.find((entry) => entry.cardId === item.cardId);
    if (existing) existing.qty += item.qty;
    else state.inventory.push({ cardId: item.cardId, qty: item.qty });
  }
}

function awardChallengeReward(state: LocalState, reward: ChallengeReward) {
  if (reward.type === "currency") {
    const current = state.profile.currencies[reward.currency] ?? 0;
    state.profile.currencies[reward.currency] = Math.max(0, current + Math.floor(reward.amount));
    return;
  }
  if (reward.type === "inventory") {
    addInventoryEntries(state, reward.items);
    return;
  }
  if (reward.type === "cosmetic") {
    if (!state.profile.cosmetics.includes(reward.cosmeticId)) {
      state.profile.cosmetics.push(reward.cosmeticId);
    }
  }
}

function applyChallengeProgress(state: LocalState, kind: ChallengeKind, delta: number, now: number) {
  if (delta <= 0) return;
  const apply = (list: Challenge[]) => {
    for (const challenge of list) {
      if (challenge.kind !== kind) continue;
      if (challenge.expiresAt <= now) continue;
      if (challenge.completedAt) continue;
      challenge.progress = Math.min(challenge.target, challenge.progress + delta);
      if (challenge.progress >= challenge.target) {
        challenge.completedAt = now;
      }
    }
  };
  apply(state.challenges.daily);
  apply(state.challenges.weekly);
}

function applySharedStats(state: LocalState, input: MatchRecordInput, now: number) {
  const stats = state.sharedStats;
  const mode = input.mode ?? "solo";
  if (mode === "coop") {
    if (input.didWin) stats.coopWins += 1;
    else stats.coopLosses += 1;
  }
  if (mode === "versus") {
    const entry = state.leaderboard.find((e) => e.playerId === state.profile.id);
    if (entry) {
      const delta = input.didWin ? 25 : -15;
      entry.rating = Math.max(0, Math.floor(entry.rating + delta));
      if (input.didWin) entry.victories += 1;
      entry.updatedAt = now;
      stats.leaderboardRating = entry.rating;
    }
  }
  if (input.sharedStatsDelta) {
    const delta = input.sharedStatsDelta;
    if (typeof delta.coopWins === "number") stats.coopWins = Math.max(0, stats.coopWins + Math.floor(delta.coopWins));
    if (typeof delta.coopLosses === "number")
      stats.coopLosses = Math.max(0, stats.coopLosses + Math.floor(delta.coopLosses));
    if (typeof delta.objectivesCompleted === "number")
      stats.objectivesCompleted = Math.max(0, stats.objectivesCompleted + Math.floor(delta.objectivesCompleted));
    if (typeof delta.leaderboardRating === "number")
      stats.leaderboardRating = Math.max(0, Math.floor(delta.leaderboardRating));
  }
  stats.lastUpdated = now;
}

function applyProgressUnlocks(state: LocalState) {
  const { profile, sharedStats } = state;
  if (!profile.unlocks.wheels.guardian && profile.level >= 3) profile.unlocks.wheels.guardian = true;
  if (!profile.unlocks.wheels.chaos && profile.level >= 6) profile.unlocks.wheels.chaos = true;
  if (!profile.unlocks.modes.coop && sharedStats.coopWins > 0) profile.unlocks.modes.coop = true;
  if (!profile.unlocks.modes.leaderboard && sharedStats.leaderboardRating >= 1100) {
    profile.unlocks.modes.leaderboard = true;
  }
}

function updateCoopObjectives(state: LocalState, increment: number, now: number) {
  if (increment <= 0) return;
  for (const objective of state.coopObjectives) {
    if (objective.expiresAt <= now) continue;
    if (objective.completedAt) continue;
    objective.progress = Math.min(objective.target, objective.progress + increment);
    if (objective.progress >= objective.target) {
      objective.completedAt = now;
      if (objective.reward && !objective.claimedAt) {
        awardChallengeReward(state, objective.reward);
        objective.claimedAt = now;
      }
      state.sharedStats.objectivesCompleted += 1;
    }
  }
  state.coopObjectives = generateObjectives(state.coopObjectives, now);
}

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
      title: "Warmup Win",
      description: "Win a match in any mode.",
      target: 1,
      reward: { type: "inventory", items: [{ cardId: "neg_-1", qty: 1 }] },
    },
    {
      kind: "win_matches",
      title: "Gold Rush",
      description: "Secure two victories today.",
      target: 2,
      reward: { type: "currency", currency: "gold", amount: 120 },
      minLevel: 3,
    },
  ],
  weekly: [
    {
      kind: "win_matches",
      title: "Wheel Champion",
      description: "Win ten matches before the week ends.",
      target: 10,
      reward: { type: "inventory", items: [{ cardId: "neg_-2", qty: 1 }] },
    },
    {
      kind: "coop_victories",
      title: "Allied Triumphs",
      description: "Win three cooperative matches this week.",
      target: 3,
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
    description: "Finish 5 cooperative rounds without losses.",
    target: 5,
    reward: { type: "inventory", items: [{ cardId: "basic_7", qty: 1 }] },
  },
  {
    description: "Complete 4 cooperative objectives with perfect spins.",
    target: 4,
    reward: { type: "cosmetic", cosmeticId: "trail_radiant", name: "Radiant Trail" },
  },
];

function seed(): LocalState {
  const now = Date.now();
  const profile: Profile = {
    id: uid("user"),
    displayName: "Local Player",
    mmr: 1000,
    createdAt: now,
    level: 1,
    exp: 0,
    winStreak: 0,
    currencies: { ...DEFAULT_CURRENCIES },
    unlocks: {
      wheels: { ...DEFAULT_UNLOCKS.wheels },
      modes: { ...DEFAULT_UNLOCKS.modes },
    },
    cosmetics: [...DEFAULT_COSMETICS],
  };

  const challenges = seedChallengeBoard(profile, now);
  const sharedStats: SharedStats = { ...DEFAULT_SHARED, lastUpdated: now };
  const coopObjectives = generateObjectives([], now);
  const leaderboard = ensureLeaderboard([], profile);

  return {
    version: VERSION,
    profile,
    inventory: SEED_INVENTORY,
    decks: [SEED_DECK],
    challenges,
    sharedStats,
    coopObjectives,
    leaderboard,
  };
}

// ===== Load/save =====
function migrateState(raw: any): LocalState {
  const fallback = seed();
  const now = Date.now();

  const state: LocalState = {
    version: VERSION,
    profile: fallback.profile,
    inventory: fallback.inventory.map((item) => ({ ...item })),
    decks: fallback.decks.map((deck) => ({ ...deck, cards: deck.cards.map((c) => ({ ...c })) })),
    challenges: fallback.challenges,
    sharedStats: fallback.sharedStats,
    coopObjectives: fallback.coopObjectives,
    leaderboard: fallback.leaderboard,
  };

  if (raw && typeof raw === "object") {
    const source: any = raw;
    if (source.profile && typeof source.profile === "object") {
      const profile = source.profile as Partial<Profile> & Record<string, unknown>;
      state.profile = {
        id: typeof profile.id === "string" ? profile.id : state.profile.id,
        displayName: typeof profile.displayName === "string" ? profile.displayName : state.profile.displayName,
        mmr: typeof profile.mmr === "number" && Number.isFinite(profile.mmr) ? profile.mmr : state.profile.mmr,
        createdAt: typeof profile.createdAt === "number" ? profile.createdAt : state.profile.createdAt,
        level: typeof profile.level === "number" ? Math.max(1, Math.floor(profile.level)) : state.profile.level,
        exp: typeof profile.exp === "number" && profile.exp >= 0 ? Math.floor(profile.exp) : state.profile.exp,
        winStreak:
          typeof profile.winStreak === "number" && profile.winStreak >= 0
            ? Math.floor(profile.winStreak)
            : state.profile.winStreak,
        currencies: normalizeCurrencies(profile.currencies as Partial<CurrencyLedger> | null | undefined),
        unlocks: normalizeUnlocks(profile.unlocks as Partial<UnlockState> | null | undefined),
        cosmetics: ensureCosmetics(profile.cosmetics),
      };
    }

    if (Array.isArray(source.inventory)) {
      const inv: InventoryItem[] = source.inventory
        .map((entry: any) => {
          if (!entry || typeof entry !== "object") return null;
          const cardId = typeof entry.cardId === "string" ? entry.cardId : null;
          const qty = typeof entry.qty === "number" && Number.isFinite(entry.qty) ? Math.max(0, Math.floor(entry.qty)) : 0;
          if (!cardId || qty <= 0) return null;
          return { cardId, qty };
        })
        .filter(Boolean) as InventoryItem[];
      state.inventory = inv;
    }

    if (Array.isArray(source.decks) && source.decks.length > 0) {
      const decks: Deck[] = source.decks
        .map((deck: any, idx: number) => {
          if (!deck || typeof deck !== "object") return null;
          const id = typeof deck.id === "string" ? deck.id : uid("deck");
          const name = typeof deck.name === "string" ? deck.name : `Deck ${idx + 1}`;
          const isActive = Boolean(deck.isActive);
          const cards: DeckCard[] = Array.isArray(deck.cards)
            ? deck.cards
                .map((card: any) => {
                  if (!card || typeof card !== "object") return null;
                  const cardId = typeof card.cardId === "string" ? card.cardId : null;
                  const qty = typeof card.qty === "number" && Number.isFinite(card.qty) ? Math.max(0, Math.floor(card.qty)) : 0;
                  if (!cardId || qty <= 0) return null;
                  return { cardId, qty };
                })
                .filter(Boolean) as DeckCard[]
            : [];
          return { id, name, isActive, cards };
        })
        .filter(Boolean) as Deck[];
      if (decks.length > 0) {
        if (!decks.some((d) => d.isActive)) decks[0].isActive = true;
        state.decks = decks;
      }
    }

    state.challenges = ensureChallengeBoard(source.challenges, state.profile, now);
    state.sharedStats = ensureSharedStats(source.sharedStats);
    state.coopObjectives = ensureObjectives(source.coopObjectives, now);
    state.leaderboard = ensureLeaderboard(source.leaderboard, state.profile);
  }

  refreshChallengeLists(state.challenges, state.profile, now);
  state.coopObjectives = generateObjectives(state.coopObjectives, now);
  state.sharedStats.lastUpdated = now;
  state.version = VERSION;
  return state;
}

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
    const migrated = migrateState(parsed);
    saveState(migrated);
    return migrated;
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
const findActive = (s: LocalState) => s.decks.find(d => d.isActive) ?? s.decks[0];
const sum = (cards: DeckCard[]) => cards.reduce((a, c) => a + c.qty, 0);
const qtyInDeck = (d: Deck, id: string) => d.cards.find(c => c.cardId === id)?.qty ?? 0;
const setQty = (d: Deck, id: string, q: number) => {
  const i = d.cards.findIndex(c => c.cardId === id);
  if (q <= 0) { if (i >= 0) d.cards.splice(i, 1); return; }
  if (i >= 0) d.cards[i].qty = q; else d.cards.push({ cardId: id, qty: q });
};
const ownAtLeast = (inv: InventoryItem[], id: string, need: number) =>
  (inv.find(i => i.cardId === id)?.qty ?? 0) >= need;

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

export type MatchResultSummary = {
  didWin: boolean;
  expGained: number;
  streak: number;
  before: LevelProgress;
  after: LevelProgress;
  segments: LevelProgressSegment[];
  levelUps: number;
};
export type MatchRecordInput = {
  didWin: boolean;
  mode?: "solo" | "coop" | "versus";
  cardsPlayed?: number;
  sharedStatsDelta?: Partial<Pick<SharedStats, "coopWins" | "coopLosses" | "objectivesCompleted" | "leaderboardRating">>;
};

export function recordMatchResult({ didWin, mode = "solo", sharedStatsDelta }: MatchRecordInput): MatchResultSummary {
  const state = loadStateRaw();
  const profile = state.profile;
  const before = toLevelProgress(profile);
  const now = Date.now();

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
  } else {
    profile.winStreak = 0;
  }

  const after = toLevelProgress(profile);

  if (didWin) {
    applyChallengeProgress(state, "win_matches", 1, now);
  }
  if (didWin && mode === "coop") {
    applyChallengeProgress(state, "coop_victories", 1, now);
  }

  applySharedStats(state, { didWin, mode, sharedStatsDelta }, now);
  if (mode === "coop" && didWin) {
    updateCoopObjectives(state, 1, now);
  } else if (mode === "coop") {
    updateCoopObjectives(state, 0, now);
  }

  refreshChallengeBoard(state, now);
  applyProgressUnlocks(state);
  saveState(state);

  return {
    didWin,
    expGained,
    streak: profile.winStreak,
    before,
    after,
    segments,
    levelUps,
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
  applyProgressUnlocks(s);
  saveState(s);

  const profile: Profile = {
    ...s.profile,
    currencies: { ...s.profile.currencies },
    unlocks: {
      wheels: { ...s.profile.unlocks.wheels },
      modes: { ...s.profile.unlocks.modes },
    },
    cosmetics: [...s.profile.cosmetics],
  };
  const inventory = s.inventory.map((item) => ({ ...item }));
  const decks = s.decks.map((deck) => ({
    ...deck,
    cards: deck.cards.map((card) => ({ ...card })),
  }));
  const activeId = findActive(s)?.id;
  const active = activeId ? decks.find((d) => d.id === activeId) : undefined;
  const challenges: ChallengeBoard = {
    daily: s.challenges.daily.map(cloneChallenge),
    weekly: s.challenges.weekly.map(cloneChallenge),
    generatedAt: { ...s.challenges.generatedAt },
  };
  const sharedStats: SharedStats = { ...s.sharedStats };
  const coopObjectives = s.coopObjectives.map(cloneObjective);
  const leaderboard = s.leaderboard.map((entry) => ({ ...entry }));

  return { profile, inventory, decks, active, challenges, sharedStats, coopObjectives, leaderboard };
}
export function createDeck(name = "New Deck") {
  const s = loadStateRaw();
  const d: Deck = { id: uid("deck"), name, isActive: false, cards: [] };
  s.decks.push(d); saveState(s); return d;
}
export function setActiveDeck(id: string) {
  const s = loadStateRaw();
  s.decks = s.decks.map(d => ({ ...d, isActive: d.id === id }));
  saveState(s);
}
export function renameDeck(id: string, name: string) {
  const s = loadStateRaw();
  const d = s.decks.find(x => x.id === id);
  if (d) d.name = name || "Deck";
  saveState(s);
}
export function deleteDeck(id: string) {
  const s = loadStateRaw();
  s.decks = s.decks.filter(d => d.id !== id);
  if (!s.decks.some(d => d.isActive) && s.decks[0]) s.decks[0].isActive = true;
  saveState(s);
}
export function swapDeckCards(deckId: string, remove: SwapItem[], add: SwapItem[]) {
  const s = loadStateRaw();
  const deck = s.decks.find(d => d.id === deckId);
  if (!deck) throw new Error("Deck not found");

  const next: DeckCard[] = deck.cards.map(c => ({ ...c }));
  const tmp: Deck = { ...deck, cards: next };

  for (const r of remove) setQty(tmp, r.cardId, Math.max(0, qtyInDeck(tmp, r.cardId) - r.qty));
  for (const a of add) setQty(tmp, a.cardId, qtyInDeck(tmp, a.cardId) + a.qty);

  if (sum(tmp.cards) > MAX_DECK_SIZE) throw new Error(`Deck too large (max ${MAX_DECK_SIZE})`);
  for (const c of tmp.cards) {
    if (!c.cardId.startsWith("basic_") && c.qty > MAX_COPIES_PER_DECK)
      throw new Error(`Too many copies of ${c.cardId} (max ${MAX_COPIES_PER_DECK})`);
    if (!ownAtLeast(s.inventory, c.cardId, 1))
      throw new Error(`You don't own ${c.cardId}`);
  }

  deck.cards = tmp.cards;
  saveState(s);
  return deck;
}
export function addToInventory(items: SwapItem[]) {
  const s = loadStateRaw();
  addInventoryEntries(s, items);
  saveState(s);
}

export function getUnlockedWheelArchetypes(): WheelArchetype[] {
  const state = loadStateRaw();
  applyProgressUnlocks(state);
  saveState(state);
  return (Object.keys(state.profile.unlocks.wheels) as WheelArchetype[]).filter(
    (arch) => state.profile.unlocks.wheels[arch]
  );
}

export function getWheelLoadout(): WheelArchetype[] {
  const unlocked = getUnlockedWheelArchetypes();
  if (unlocked.length === 0) {
    return ["bandit", "sorcerer", "beast"];
  }

  const base: WheelArchetype[] = [];
  if (unlocked.includes("bandit")) base.push("bandit");
  if (unlocked.includes("sorcerer")) base.push("sorcerer");
  const remaining = unlocked.filter((arch) => !base.includes(arch));
  const extras = shuffle([...remaining]);
  const ordered = [...base, ...extras];

  const chosen: WheelArchetype[] = [];
  for (const arch of ordered) {
    if (!chosen.includes(arch)) {
      chosen.push(arch);
    }
    if (chosen.length === 3) break;
  }

  const fallback: WheelArchetype[] = ["bandit", "sorcerer", "beast"];
  for (const arch of fallback) {
    if (chosen.length >= 3) break;
    if (unlocked.includes(arch) && !chosen.includes(arch)) chosen.push(arch);
  }

  const limit = Math.min(3, Math.max(1, unlocked.length));
  return chosen.slice(0, limit);
}

export type MultiplayerSnapshot = {
  sharedStats: SharedStats;
  coopObjectives: CoopObjective[];
  leaderboard: LeaderboardEntry[];
};

export function getMultiplayerSnapshot(): MultiplayerSnapshot {
  const state = loadStateRaw();
  refreshChallengeBoard(state);
  applyProgressUnlocks(state);
  saveState(state);
  return {
    sharedStats: { ...state.sharedStats },
    coopObjectives: state.coopObjectives.map(cloneObjective),
    leaderboard: state.leaderboard.map((entry) => ({ ...entry })),
  };
}

export function syncMultiplayerSnapshot(snapshot: MultiplayerSnapshot) {
  const state = loadStateRaw();
  const now = Date.now();

  state.sharedStats = {
    ...state.sharedStats,
    coopWins: Math.max(state.sharedStats.coopWins, snapshot.sharedStats.coopWins),
    coopLosses: Math.max(state.sharedStats.coopLosses, snapshot.sharedStats.coopLosses),
    objectivesCompleted: Math.max(state.sharedStats.objectivesCompleted, snapshot.sharedStats.objectivesCompleted),
    leaderboardRating: Math.max(state.sharedStats.leaderboardRating, snapshot.sharedStats.leaderboardRating),
    lastUpdated: now,
  };

  const incomingObjectives = ensureObjectives(snapshot.coopObjectives, now);
  const existingObjectives = state.coopObjectives;
  const mergedObjectives: CoopObjective[] = incomingObjectives.map((incoming) => {
    const existing = existingObjectives.find((obj) => obj.id === incoming.id);
    if (!existing) return incoming;
    return {
      ...incoming,
      progress: Math.max(existing.progress, incoming.progress),
      completedAt: existing.completedAt ?? incoming.completedAt,
      claimedAt: existing.claimedAt ?? incoming.claimedAt,
    };
  });
  const preserved = existingObjectives.filter(
    (obj) => !mergedObjectives.some((incoming) => incoming.id === obj.id)
  );
  state.coopObjectives = generateObjectives([...mergedObjectives, ...preserved], now);

  const merged = new Map<string, LeaderboardEntry>();
  for (const entry of state.leaderboard) {
    merged.set(entry.playerId, { ...entry });
  }
  for (const entry of snapshot.leaderboard) {
    if (!entry) continue;
    const existing = merged.get(entry.playerId);
    const sanitized: LeaderboardEntry = {
      playerId: typeof entry.playerId === "string" ? entry.playerId : uid("lb"),
      name: typeof entry.name === "string" ? entry.name : existing?.name ?? state.profile.displayName,
      rating: typeof entry.rating === "number" && Number.isFinite(entry.rating) ? Math.max(0, Math.floor(entry.rating)) : 0,
      victories:
        typeof entry.victories === "number" && Number.isFinite(entry.victories)
          ? Math.max(0, Math.floor(entry.victories))
          : existing?.victories ?? 0,
      updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : now,
    };
    if (!existing) {
      merged.set(sanitized.playerId, sanitized);
    } else {
      merged.set(sanitized.playerId, {
        ...existing,
        name: sanitized.name,
        rating: Math.max(existing.rating, sanitized.rating),
        victories: Math.max(existing.victories, sanitized.victories),
        updatedAt: Math.max(existing.updatedAt, sanitized.updatedAt),
      });
    }
  }
  state.leaderboard = ensureLeaderboard(Array.from(merged.values()), state.profile);

  applyProgressUnlocks(state);
  saveState(state);
}

export function claimChallengeReward(id: string): Challenge | undefined {
  const state = loadStateRaw();
  const now = Date.now();
  refreshChallengeBoard(state, now);
  const all = [...state.challenges.daily, ...state.challenges.weekly];
  const found = all.find((ch) => ch.id === id);
  if (!found || !found.completedAt || found.claimedAt) {
    saveState(state);
    return undefined;
  }
  found.claimedAt = now;
  awardChallengeReward(state, found.reward);
  applyProgressUnlocks(state);
  saveState(state);
  return cloneChallenge(found);
}

// ====== CARD FACTORY to map profile cardIds -> real game Card ======

// sequential card ids for the runtime deck
const nextCardId = (() => { let i = 1; return () => `C${i++}`; })();

/**
 * Supported cardId formats:
 *  - "basic_N" where N is 0..9  → normal card with number N
 *  - "neg_X" where X is a number (e.g., -2) → normal card with number X
 *  - "num_X" explicit number alias
 * Anything else falls back to number 0.
 */
function cardFromId(cardId: string): Card {
  let num = 0;
  const mBasic = /^basic_(\d+)$/.exec(cardId);
  const mNeg   = /^neg_(-?\d+)$/.exec(cardId);
  const mNum   = /^num_(-?\d+)$/.exec(cardId);

  if (mBasic) num = parseInt(mBasic[1], 10);
  else if (mNeg) num = parseInt(mNeg[1], 10);
  else if (mNum) num = parseInt(mNum[1], 10);

  return {
    id: nextCardId(),
    name: `${num}`,
    type: "normal",
    number: num,
    tags: [],
  };
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
