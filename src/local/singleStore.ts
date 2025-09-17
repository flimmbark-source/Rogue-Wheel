import type { LocalState, InventoryItem, Deck } from "../types/profile";

const KEY = "rw:single:state";
const VERSION = 1;

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

const SEED_INVENTORY: InventoryItem[] = [
  ...Array.from({ length: 10 }, (_, n) => ({ cardId: `basic_${n}`, qty: 4 })),
  { cardId: "split_-1|+2", qty: 2 },
  { cardId: "neg_-2", qty: 2 },
];

const SEED_DECK: Deck = {
  id: uid("deck"),
  name: "Starter Deck",
  isActive: true,
  cards: Array.from({ length: 10 }, (_, n) => ({ cardId: `basic_${n}`, qty: 1 })),
};

function seed(): LocalState {
  return {
    version: VERSION,
    profile: { id: uid("user"), displayName: "Local Player", mmr: 1000, createdAt: Date.now() },
    inventory: SEED_INVENTORY,
    decks: [SEED_DECK],
  };
}

export function loadState(): LocalState {
  if (typeof localStorage === "undefined") {
    return seed();
  }
  const raw = localStorage.getItem(KEY);
  if (!raw) {
    const s = seed();
    localStorage.setItem(KEY, JSON.stringify(s));
    return s;
  }
  try {
    const s = JSON.parse(raw) as LocalState;
    if (!("version" in s)) (s as any).version = VERSION;
    return s;
  } catch {
    const s = seed();
    localStorage.setItem(KEY, JSON.stringify(s));
    return s;
  }
}

export function saveState(state: LocalState) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(state));
}
export function resetState() {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(KEY);
}
