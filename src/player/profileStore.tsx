// Local profile + deck store (single-device) that ALSO builds real Card[] decks
// to match your existing game types/functions.

import { shuffle } from "../game/math";
import type { Card, Fighter } from "../game/types";

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

// ===== Seed data (keep numbers only to match Card { type:'normal', number:n }) =====
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
