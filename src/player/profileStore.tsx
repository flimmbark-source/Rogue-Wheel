// Local profile + deck store (single-device) that ALSO builds real Card[] decks
// to match your existing game types/functions.

import { shuffle } from "../game/math";
import type { Card, Fighter } from "../game/types";

// ===== Local persistence types (module-scoped) =====
type CardId = string;
export type InventoryItem = { cardId: CardId; qty: number };
export type DeckCard = { cardId: CardId; qty: number };
export type Deck = { id: string; name: string; isActive: boolean; cards: DeckCard[] };
export type Profile = {
  id: string;
  displayName: string;
  mmr: number;
  createdAt: number;
  level: number;
  exp: number;
  winStreak: number;
};
type LocalState = { version: number; profile: Profile; inventory: InventoryItem[]; decks: Deck[] };

// ===== Storage/config =====
const KEY = "rw:single:state";
const VERSION = 2;
const MAX_DECK_SIZE = 10;
const MAX_COPIES_PER_DECK = 2;

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
  };
}

// ===== Load/save =====
function loadStateRaw(): LocalState {
  const raw = localStorage.getItem(KEY);
  if (!raw) {
    const s = seed(); localStorage.setItem(KEY, JSON.stringify(s)); return s;
  }
  try {
    const s = JSON.parse(raw) as LocalState;
    if (!(s as any).version) (s as any).version = VERSION;
    if (s.version < 2) {
      s.version = 2;
      if (!s.profile) {
        s.profile = seed().profile;
      } else {
        if (typeof s.profile.level !== "number") s.profile.level = 1;
        if (typeof s.profile.exp !== "number") s.profile.exp = 0;
        if (typeof s.profile.winStreak !== "number") s.profile.winStreak = 0;
      }
      saveState(s);
    }
    return s;
  } catch {
    const s = seed(); localStorage.setItem(KEY, JSON.stringify(s)); return s;
  }
}
function saveState(state: LocalState) { localStorage.setItem(KEY, JSON.stringify(state)); }

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

// ===== Public profile/deck management API (used by UI) =====
export type ProfileBundle = { profile: Profile; inventory: InventoryItem[]; decks: Deck[]; active: Deck | undefined };

export function getProfileBundle(): ProfileBundle {
  const s = loadStateRaw();
  return { profile: s.profile, inventory: s.inventory, decks: s.decks, active: findActive(s) };
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
