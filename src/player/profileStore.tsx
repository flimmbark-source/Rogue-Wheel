// Local profile + deck store (single-device) that ALSO builds real Card[] decks
// to match your existing game types/functions.

import { shuffle } from "../game/math";
import type {
  ActivationAbility,
  Card,
  CardRarity,
  CardSplit,
  CardSplitFace,
  Fighter,
  ReserveBehavior,
  TagId,
} from "../game/types";

// ===== Local persistence types (module-scoped) =====
type CardId = string;
export type InventoryItem = { cardId: CardId; qty: number };
export type DeckCard = { cardId: CardId; qty: number };
export type Deck = { id: string; name: string; isActive: boolean; cards: DeckCard[] };
export type GauntletRun = {
  id: string;
  startedAt: number;
  round: number;
  gold: number;
  deck: DeckCard[];
  flags: Record<string, boolean>;
};
export type Profile = {
  id: string;
  displayName: string;
  mmr: number;
  createdAt: number;
  level: number;
  exp: number;
  winStreak: number;
};
type LocalState = {
  version: number;
  profile: Profile;
  inventory: InventoryItem[];
  decks: Deck[];
  gauntlet: GauntletRun | null;
};

// ===== Storage/config =====
const KEY = "rw:single:state";
const VERSION = 3;
const MAX_DECK_SIZE = 10;
const MAX_COPIES_PER_DECK = 2;
const GAUNTLET_MAX_DECK_SIZE = 30; // Gauntlet runs can expand the deck slightly beyond the standard limit.

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

// ===== Card catalog & factory =====
export type CardBlueprint = {
  id: string;
  name: string;
  type?: Card["type"];
  number?: number;
  split?: CardSplit;
  activation?: ActivationAbility[];
  reserve?: ReserveBehavior;
  tags?: TagId[];
  cost: number;
  rarity: CardRarity;
  effectSummary?: string;
};

const cloneActivation = (ability: ActivationAbility): ActivationAbility => ({
  ...ability,
  effects: ability.effects.map((effect) => ({ ...effect })),
});

const cloneSplitFace = (face: CardSplitFace): CardSplitFace => ({
  ...face,
  activation: face.activation ? face.activation.map(cloneActivation) : undefined,
});

const cloneSplit = (split: CardSplit): CardSplit => ({
  defaultFace: split.defaultFace,
  faces: {
    left: cloneSplitFace(split.faces.left),
    right: cloneSplitFace(split.faces.right),
  },
});

const instantiateCard = (blueprint: CardBlueprint): Card => ({
  id: nextCardId(),
  name: blueprint.name,
  type: blueprint.type ?? "normal",
  number: blueprint.number,
  split: blueprint.split ? cloneSplit(blueprint.split) : undefined,
  activation: blueprint.activation ? blueprint.activation.map(cloneActivation) : undefined,
  reserve: blueprint.reserve ? { ...blueprint.reserve } : undefined,
  tags: blueprint.tags ? [...blueprint.tags] : [],
  cost: blueprint.cost,
  rarity: blueprint.rarity,
  effectSummary: blueprint.effectSummary,
});

const ABILITIES = {
  feintBoost: {
    id: "feint_boost",
    name: "Feint Setup",
    timing: "onPlay" as const,
    summary: "+2 when you reveal the Feint face.",
    effects: [{ type: "selfValue", amount: 2 }],
  },
  chargeUp: {
    id: "charge_up",
    name: "Charge Up",
    timing: "onPlay" as const,
    summary: "+3 when this card is played.",
    effects: [{ type: "selfValue", amount: 3 }],
  },
  echoReserve: {
    id: "echo_reserve",
    name: "Echo Chamber",
    timing: "reserve" as const,
    summary: "Reserve gains +3 then doubles.",
    effects: [
      { type: "reserveBonus", amount: 3 },
      { type: "reserveMultiplier", multiplier: 2 },
    ],
  },
  stashReserve: {
    id: "stash_reserve",
    name: "Hidden Stash",
    timing: "reserve" as const,
    summary: "+2 reserve while held.",
    effects: [{ type: "reserveBonus", amount: 2 }],
  },
  omenBoost: {
    id: "omen_boost",
    name: "Omensight",
    timing: "onPlay" as const,
    summary: "+1 when you reveal the Predict face.",
    effects: [{ type: "selfValue", amount: 1 }],
  },
  omenReserve: {
    id: "omen_reserve",
    name: "Foretold Future",
    timing: "reserve" as const,
    summary: "Reserve doubles the stored omen.",
    effects: [{ type: "reserveMultiplier", multiplier: 2 }],
  },
  chronoReserve: {
    id: "chrono_reserve",
    name: "Chrono Vault",
    timing: "reserve" as const,
    summary: "Reserve gains +4 then doubles.",
    effects: [
      { type: "reserveBonus", amount: 4 },
      { type: "reserveMultiplier", multiplier: 2 },
    ],
  },
  dragField: {
    id: "drag_field",
    name: "Temporal Drag",
    timing: "onPlay" as const,
    summary: "+4 when you slow the foe.",
    effects: [{ type: "selfValue", amount: 4 }],
  },
  vaultReserve: {
    id: "vault_reserve",
    name: "Vaulted Spoils",
    timing: "reserve" as const,
    summary: "Reserve adds +2 then doubles.",
    effects: [
      { type: "reserveBonus", amount: 2 },
      { type: "reserveMultiplier", multiplier: 2 },
    ],
  },
} satisfies Record<string, ActivationAbility>;

const BASIC_BLUEPRINTS: CardBlueprint[] = Array.from({ length: 10 }, (_, n) => ({
  id: `basic_${n}`,
  name: `${n}`,
  type: "normal",
  number: n,
  tags: [],
  cost: 10,
  rarity: "common",
  effectSummary: `A simple value ${n} card.`,
}));

const NEGATIVE_BLUEPRINTS: CardBlueprint[] = [
  {
    id: "cursed_pebble",
    name: "Cursed Pebble",
    type: "normal",
    number: -1,
    tags: ["oddshift"],
    cost: 20,
    rarity: "uncommon",
    effectSummary: "−1 power that helps win the weakest slices.",
  },
  {
    id: "void_lantern",
    name: "Void Lantern",
    type: "normal",
    number: -2,
    tags: ["parityflip"],
    cost: 25,
    rarity: "rare",
    effectSummary: "−2 power. Perfect bait for Weakest or parity twists.",
  },
  {
    id: "entropy_fragment",
    name: "Entropy Fragment",
    type: "normal",
    number: -3,
    tags: ["echoreserve"],
    cost: 30,
    rarity: "rare",
    effectSummary: "−3 power shard that supercharges reserve-based plans.",
  },
];

const ADVANCED_BLUEPRINTS: CardBlueprint[] = [
  {
    id: "charged_lancer",
    name: "Charged Lancer",
    type: "normal",
    number: 4,
    activation: [ABILITIES.chargeUp],
    reserve: { type: "bonus", amount: 1, summary: "+1 reserve from stored energy." },
    tags: ["oddshift"],
    cost: 25,
    rarity: "uncommon",
    effectSummary: "4 base, +3 when played. Reserve stores +1 charge.",
  },
  {
    id: "echo_savant",
    name: "Echo Savant",
    type: "normal",
    number: 3,
    activation: [ABILITIES.echoReserve],
    reserve: { type: "default", summary: "Echo stash builds momentum." },
    tags: ["echoreserve"],
    cost: 30,
    rarity: "rare",
    effectSummary: "3 power. Reserve gains +3 then doubles while held.",
  },
  {
    id: "vault_keeper",
    name: "Vault Keeper",
    type: "normal",
    number: 5,
    activation: [ABILITIES.vaultReserve],
    reserve: { type: "default", summary: "Reserve fortifies into a vault." },
    tags: ["parityflip"],
    cost: 35,
    rarity: "uncommon",
    effectSummary: "5 power. Reserve adds +2 then doubles in the vault.",
  },
  {
    id: "duelist_edge",
    name: "Duelist's Edge",
    type: "split",
    split: {
      defaultFace: "right",
      faces: {
        left: { id: "left", label: "Feint", value: 2, activation: [ABILITIES.feintBoost] },
        right: { id: "right", label: "Strike", value: 7 },
      },
    },
    reserve: {
      type: "bonus",
      amount: 2,
      summary: "+2 reserve when the Feint is kept ready.",
      preferredFace: "left",
    },
    tags: ["oddshift"],
    cost: 40,
    rarity: "uncommon",
    effectSummary: "Feint (2+2) or Strike 7. Reserve favors the hidden Feint.",
  },
  {
    id: "oracle_sigil",
    name: "Oracle Sigil",
    type: "split",
    split: {
      defaultFace: "left",
      faces: {
        left: { id: "left", label: "Predict", value: 1, activation: [ABILITIES.omenBoost] },
        right: { id: "right", label: "Claim", value: 6 },
      },
    },
    activation: [ABILITIES.omenReserve],
    reserve: {
      type: "bonus",
      amount: 2,
      summary: "+2 reserve charged with foresight.",
      preferredFace: "left",
    },
    tags: ["echoreserve"],
    cost: 45,
    rarity: "rare",
    effectSummary: "Predict (1+1) or Claim 6. Reserve gains +2 then doubles from omens.",
  },
  {
    id: "time_fragment",
    name: "Time Fragment",
    type: "split",
    split: {
      defaultFace: "right",
      faces: {
        left: { id: "left", label: "Drag", value: -1, activation: [ABILITIES.dragField] },
        right: { id: "right", label: "Surge", value: 9 },
      },
    },
    activation: [ABILITIES.chronoReserve],
    reserve: {
      type: "default",
      summary: "Chrono charge resonates while held.",
      preferredFace: "left",
    },
    tags: ["parityflip", "echoreserve"],
    cost: 50,
    rarity: "legendary",
    effectSummary: "Drag (-1+4) or Surge 9. Reserve adds +4 then doubles in stasis.",
  },
];

const CARD_BLUEPRINTS: CardBlueprint[] = [
  ...BASIC_BLUEPRINTS,
  ...NEGATIVE_BLUEPRINTS,
  ...ADVANCED_BLUEPRINTS,
];

const NEGATIVE_BLUEPRINT_IDS = new Set(NEGATIVE_BLUEPRINTS.map((entry) => entry.id));

const CARD_BLUEPRINT_MAP = new Map<string, CardBlueprint>(
  CARD_BLUEPRINTS.map((entry) => [entry.id, entry]),
);

export const CARD_CATALOG: readonly CardBlueprint[] = CARD_BLUEPRINTS;

const RARITY_WEIGHTS: Record<CardRarity, number> = {
  common: 8,
  uncommon: 4,
  rare: 2,
  legendary: 1,
};

const pickWeightedIndex = (entries: CardBlueprint[], rng: () => number) => {
  const total = entries.reduce(
    (sum, entry) => sum + (RARITY_WEIGHTS[entry.rarity] ?? 1),
    0,
  );
  if (total <= 0) return Math.floor(rng() * entries.length);
  let roll = rng() * total;
  for (let i = 0; i < entries.length; i++) {
    roll -= RARITY_WEIGHTS[entries[i].rarity] ?? 1;
    if (roll <= 0) return i;
  }
  return entries.length - 1;
};

export type StoreOffering = {
  id: string;
  rarity: CardRarity;
  cost: number;
  summary: string;
  card: Card;
};

export function rollStoreOfferings(
  count = 4,
  rng: () => number = Math.random,
): StoreOffering[] {
  const pool = [...CARD_BLUEPRINTS];
  const offers: StoreOffering[] = [];

  const makeOffer = (blueprint: CardBlueprint) => ({
    id: blueprint.id,
    rarity: blueprint.rarity,
    cost: blueprint.cost,
    summary: blueprint.effectSummary ?? blueprint.name,
    card: instantiateCard(blueprint),
  });

  if (count > 0) {
    const negativePool = pool.filter((entry) => NEGATIVE_BLUEPRINT_IDS.has(entry.id));
    if (negativePool.length > 0) {
      const forced = negativePool[pickWeightedIndex(negativePool, rng)];
      if (forced) {
        const forcedIndex = pool.findIndex((entry) => entry.id === forced.id);
        const [blueprint] = forcedIndex >= 0 ? pool.splice(forcedIndex, 1) : [forced];
        if (blueprint) {
          offers.push(makeOffer(blueprint));
        }
      }
    }
  }

  while (offers.length < count && pool.length) {
    const index = pickWeightedIndex(pool, rng);
    const blueprint = pool.splice(index, 1)[0];
    if (!blueprint) break;
    offers.push(makeOffer(blueprint));
  }

  return offers;
}

const numberBlueprintFromId = (cardId: string): CardBlueprint | null => {
  const mBasic = /^basic_(\d+)$/.exec(cardId);
  const mNeg = /^neg_(-?\d+)$/.exec(cardId);
  const mNum = /^num_(-?\d+)$/.exec(cardId);
  const match = mBasic ?? mNeg ?? mNum;
  if (!match) return null;
  const value = parseInt(match[1], 10);
  return {
    id: cardId,
    name: `${value}`,
    type: "normal",
    number: value,
    tags: [],
    cost: value < 0 ? 30 : 10,
    rarity: value < 0 ? "uncommon" : "common",
    effectSummary: `Straight value ${value}.`,
  };
};

// ===== Seed data =====
const SEED_INVENTORY: InventoryItem[] = [];

const SEED_DECK: Deck = {
  id: uid("deck"),
  name: "Starter Deck",
  isActive: true,
  cards: Array.from({ length: 10 }, (_, n) => ({ cardId: `basic_${n}`, qty: 1 })),
};

function seed(): LocalState {
  return {
    version: VERSION,
    profile: {
      id: uid("user"),
      displayName: "Local Player",
      mmr: 1000,
      createdAt: Date.now(),
      level: 1,
      exp: 0,
      winStreak: 0,
    },
    inventory: SEED_INVENTORY,
    decks: [SEED_DECK],
    gauntlet: null,
  };
}

const cloneDeckCards = (cards: DeckCard[]): DeckCard[] => cards.map(c => ({ ...c }));

function migrateState(raw: unknown): { state: LocalState; changed: boolean } {
  const seeded = seed();
  const s = (raw && typeof raw === "object" ? raw : {}) as Partial<LocalState> & { [key: string]: any };
  let changed = false;

  if (typeof s.version !== "number") {
    s.version = 1;
    changed = true;
  }

  if (!s.profile || typeof s.profile !== "object") {
    s.profile = { ...seeded.profile };
    changed = true;
  }

  const profile = s.profile as Profile;
  if (typeof profile.level !== "number") { profile.level = 1; changed = true; }
  if (typeof profile.exp !== "number") { profile.exp = 0; changed = true; }
  if (typeof profile.winStreak !== "number") { profile.winStreak = 0; changed = true; }

  if (!Array.isArray(s.inventory)) {
    s.inventory = [];
    changed = true;
  }

  if (!Array.isArray(s.decks) || s.decks.length === 0) {
    s.decks = [{ ...seeded.decks[0], cards: cloneDeckCards(seeded.decks[0].cards) }];
    changed = true;
  }

  if (s.version < 2) {
    s.version = 2;
    changed = true;
  }

  if (!("gauntlet" in s)) {
    s.gauntlet = null;
    changed = true;
  }

  if ((s.version ?? VERSION) < 3) {
    s.gauntlet = s.gauntlet ?? null;
    s.version = 3;
    changed = true;
  }

  if (s.gauntlet && typeof s.gauntlet === "object") {
    const run = s.gauntlet as GauntletRun & { [key: string]: any };
    if (!Array.isArray(run.deck)) { run.deck = []; changed = true; }
    if (typeof run.gold !== "number") { run.gold = 0; changed = true; }
    if (typeof run.round !== "number") { run.round = 0; changed = true; }
    if (typeof run.startedAt !== "number") { run.startedAt = Date.now(); changed = true; }
    if (!run.flags || typeof run.flags !== "object") { run.flags = {}; changed = true; }
  }

  if (s.version !== VERSION) {
    s.version = VERSION;
    changed = true;
  }

  return { state: s as LocalState, changed };
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
    const parsed = JSON.parse(raw) as unknown;
    const { state, changed } = migrateState(parsed);
    if (changed) saveState(state);
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

function mutateGauntletRun(mutator: (run: GauntletRun) => void): GauntletRun {
  const state = loadStateRaw();
  const run = ensureGauntletRun(state);
  mutator(run);
  saveState(state);
  return { ...run, deck: cloneDeckCards(run.deck), flags: { ...run.flags } };
}

export type GauntletDeckMutation = { remove?: SwapItem[]; add?: SwapItem[] };

function applyGauntletDeckMutation(existing: DeckCard[], mutation: GauntletDeckMutation): DeckCard[] {
  const next = cloneDeckCards(existing);
  const tmp: Deck = { id: "gauntlet", name: "Gauntlet Deck", isActive: true, cards: next };

  for (const r of mutation.remove ?? []) {
    setQty(tmp, r.cardId, Math.max(0, qtyInDeck(tmp, r.cardId) - r.qty));
  }
  for (const a of mutation.add ?? []) {
    setQty(tmp, a.cardId, qtyInDeck(tmp, a.cardId) + a.qty);
  }

  validateGauntletDeck(tmp.cards);
  return tmp.cards;
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
const ensureGauntletRun = (s: LocalState): GauntletRun => {
  if (!s.gauntlet) throw new Error("No active Gauntlet run");
  return s.gauntlet;
};
const validateGauntletDeck = (cards: DeckCard[]) => {
  if (Number.isFinite(GAUNTLET_MAX_DECK_SIZE) && sum(cards) > GAUNTLET_MAX_DECK_SIZE) {
    throw new Error(`Gauntlet deck too large (max ${GAUNTLET_MAX_DECK_SIZE})`);
  }
  for (const c of cards) {
    if (!c.cardId.startsWith("basic_") && c.qty > MAX_COPIES_PER_DECK)
      throw new Error(`Too many copies of ${c.cardId} (max ${MAX_COPIES_PER_DECK})`);
  }
};

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

export function recordMatchResult({ didWin }: { didWin: boolean }): MatchResultSummary {
  const state = loadStateRaw();
  const profile = state.profile;
  const before = toLevelProgress(profile);

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

// ===== Gauntlet API =====
export type GauntletInitOptions = {
  deckId?: string;
  startingDeckCards?: DeckCard[];
  startingGold?: number;
  startingRound?: number;
  flags?: Record<string, boolean>;
};

export function startGauntletRun(options: GauntletInitOptions = {}): GauntletRun {
  const state = loadStateRaw();
  const deckSource = options.startingDeckCards
    ? { cards: options.startingDeckCards }
    : options.deckId
      ? state.decks.find(d => d.id === options.deckId)
      : findActive(state) ?? state.decks[0];

  const baseCards = deckSource?.cards ? cloneDeckCards(deckSource.cards) : cloneDeckCards(SEED_DECK.cards);
  validateGauntletDeck(baseCards);

  const run: GauntletRun = {
    id: uid("gauntlet"),
    startedAt: Date.now(),
    round: Math.max(0, Math.trunc(options.startingRound ?? 0)),
    gold: Math.max(0, Math.trunc(options.startingGold ?? 0)),
    deck: baseCards,
    flags: { ...(options.flags ?? {}) },
  };

  state.gauntlet = run;
  saveState(state);
  return { ...run, deck: cloneDeckCards(run.deck), flags: { ...run.flags } };
}

export function endGauntletRun() {
  const state = loadStateRaw();
  if (!state.gauntlet) return;
  state.gauntlet = null;
  saveState(state);
}

export function getGauntletRun(): GauntletRun | null {
  const run = loadStateRaw().gauntlet;
  if (!run) return null;
  return { ...run, deck: cloneDeckCards(run.deck), flags: { ...run.flags } };
}

export function earnGauntletGold(amount: number): GauntletRun {
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Gold to add must be a positive number");
  return mutateGauntletRun(run => {
    run.gold += Math.trunc(amount);
  });
}

export function spendGauntletGold(amount: number): GauntletRun {
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Gold to spend must be a positive number");
  return mutateGauntletRun(run => {
    const spend = Math.trunc(amount);
    if (run.gold < spend) throw new Error("Not enough gold");
    run.gold -= spend;
  });
}

export function setGauntletGold(total: number): GauntletRun {
  if (!Number.isFinite(total) || total < 0) throw new Error("Total gold must be a non-negative number");
  return mutateGauntletRun(run => {
    run.gold = Math.trunc(total);
  });
}

export function advanceGauntletRound(delta = 1): GauntletRun {
  if (!Number.isFinite(delta)) throw new Error("Round delta must be numeric");
  return mutateGauntletRun(run => {
    run.round = Math.max(0, run.round + Math.trunc(delta));
  });
}

export function setGauntletRound(round: number): GauntletRun {
  if (!Number.isFinite(round) || round < 0) throw new Error("Round must be a non-negative number");
  return mutateGauntletRun(run => {
    run.round = Math.trunc(round);
  });
}

export function setGauntletFlag(flag: string, value: boolean): GauntletRun {
  if (!flag) throw new Error("Flag key is required");
  return mutateGauntletRun(run => {
    if (!value) delete run.flags[flag];
    else run.flags[flag] = true;
  });
}

export function mutateGauntletDeck(mutation: GauntletDeckMutation): GauntletRun {
  return mutateGauntletRun(run => {
    run.deck = applyGauntletDeckMutation(run.deck, mutation);
  });
}

export type GauntletPurchase = GauntletDeckMutation & { cost?: number };

export function applyGauntletPurchase(purchase: GauntletPurchase): GauntletRun {
  return mutateGauntletRun(run => {
    const cost = Math.trunc(purchase.cost ?? 0);
    if (cost < 0) throw new Error("Purchase cost cannot be negative");
    if (cost > 0) {
      if (run.gold < cost) throw new Error("Not enough gold to complete purchase");
      run.gold -= cost;
    }
    run.deck = applyGauntletDeckMutation(run.deck, purchase);
  });
}

// ===== Public profile/deck management API (used by UI) =====
export type ProfileBundle = {
  profile: Profile;
  inventory: InventoryItem[];
  decks: Deck[];
  active: Deck | undefined;
  gauntlet: GauntletRun | null;
};

export function getProfileBundle(): ProfileBundle {
  const s = loadStateRaw();
  const gauntlet = s.gauntlet ? { ...s.gauntlet, deck: cloneDeckCards(s.gauntlet.deck), flags: { ...s.gauntlet.flags } } : null;
  return { profile: s.profile, inventory: s.inventory, decks: s.decks, active: findActive(s), gauntlet };
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
export type SwapItem = { cardId: string; qty: number };
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
  for (const it of items) {
    const i = s.inventory.findIndex(x => x.cardId === it.cardId);
    if (i >= 0) s.inventory[i].qty += it.qty;
    else s.inventory.push({ cardId: it.cardId, qty: it.qty });
  }
  saveState(s);
}

// ====== CARD FACTORY to map profile cardIds -> real game Card ======

// sequential card ids for the runtime deck
const nextCardId = (() => { let i = 1; return () => `C${i++}`; })();

/**
 * Convert a profile cardId into a runtime Card instance using the catalog.
 * Falls back to generating a simple numeric card when unknown.
 */
function cardFromId(cardId: string): Card {
  const blueprint =
    CARD_BLUEPRINT_MAP.get(cardId) ?? numberBlueprintFromId(cardId) ?? CARD_BLUEPRINT_MAP.get("basic_0");

  if (!blueprint) {
    return {
      id: nextCardId(),
      name: "0",
      type: "normal",
      number: 0,
      tags: [],
    };
  }

  return instantiateCard(blueprint);
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
  const ids = Array.from({ length: 10 }, (_, n) => `basic_${n}`);
  const base = ids.map((id) => cardFromId(id));
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
